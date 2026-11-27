import type Database from "better-sqlite3";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { recomputeIssuer } from "@/lib/signals/recompute";
import { persistSignals } from "@/lib/signals/persist";
import { buildSignals } from "@/lib/signals/signal-builder";
import { repushOnAmendment } from "@/lib/signals/supersede";
import { saveFiling, saveParseError } from "@/lib/store/filings";
import { formatEt } from "@/lib/format";
import { evaluateAlerts } from "@/lib/notify/evaluate";
import { addDays } from "@/lib/signals/dates";

export interface IngestInput {
  accession: string;
  /** Known from the submissions list; used when the XML cannot be parsed. */
  issuerCik: string;
  /** `YYYY-MM-DD`, from the submissions JSON (the XML does not carry it). */
  filedAt: string;
  xml: string;
  /** Set during a company's first poll: its signals are historical whatever the filing date. */
  historical?: boolean;
}

export interface IngestContext {
  /** The clock for the age rule (default: the real time). */
  now?: Date;
  /** A filing older than this many ET days at ingest is historical (default 3). */
  maxAgeDays?: number;
}

export const DEFAULT_MAX_AGE_DAYS = 3;

/** Historical signals are recorded but never alerted. */
export function isHistorical(input: IngestInput, ctx: IngestContext): boolean {
  const today = formatEt((ctx.now ?? new Date()).toISOString()).slice(0, 10);
  return !!input.historical || input.filedAt < addDays(today, -(ctx.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS));
}

export interface IngestResult {
  status: "ok" | "duplicate" | "parse_error";
  signalIds: number[];
  /** Amending signals that should push again (value moved more than 20% or was unknown). */
  repushIds: number[];
}

/** Parse, store, build signals, then recompute the issuer, all in one transaction. */
export function ingestFiling(db: Database.Database, input: IngestInput, ctx: IngestContext = {}): IngestResult {
  return db.transaction((): IngestResult => {
    const none = { signalIds: [], repushIds: [] };
    if (db.prepare("SELECT 1 FROM filing WHERE accession_no = ?").get(input.accession)) {
      return { status: "duplicate", ...none };
    }
    const parsed = parseForm4(input.xml);
    if (!parsed.ok) {
      saveParseError(db, input.accession, input.issuerCik, input.filedAt, parsed.error);
      return { status: "parse_error", ...none };
    }
    const form = parsed.form4;
    const saved = saveFiling(db, input.accession, input.filedAt, form);
    const signals = buildSignals(form, input.filedAt);
    if (signals.length === 0 && form.formType !== "4/A") return { status: "ok", ...none };

    const signalIds = persistSignals(db, saved.filingId, form.issuerCik, saved.ownerIds, signals, isHistorical(input, ctx));
    const anchor = signals.map((s) => s.txnDate).sort().at(-1) ?? form.periodOfReport ?? input.filedAt;
    const { replaced, rows } = recomputeIssuer(db, form.issuerCik, anchor);
    const repushIds = signalIds.filter((id) => {
      const before = replaced.get(id);
      const after = rows.find((r) => r.id === id)!;
      return replaced.has(id) && repushOnAmendment(before, after);
    });
    evaluateAlerts(db, { issuerCik: form.issuerCik, newSignalIds: signalIds, replaced, repushIds, now: ctx.now ?? new Date() });
    return { status: "ok", signalIds, repushIds };
  })();
}

/** Ingest in ascending filing order (oldest first), so every run sees history before the present. */
export function ingestBatch(db: Database.Database, inputs: IngestInput[], ctx: IngestContext = {}): IngestResult[] {
  return [...inputs]
    .sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.accession.localeCompare(b.accession))
    .map((i) => ingestFiling(db, i, ctx));
}
