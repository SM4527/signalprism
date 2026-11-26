import type Database from "better-sqlite3";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { recomputeIssuer } from "@/lib/signals/recompute";
import { persistSignals } from "@/lib/signals/persist";
import { buildSignals } from "@/lib/signals/signal-builder";
import { repushOnAmendment } from "@/lib/signals/supersede";
import { saveFiling, saveParseError } from "@/lib/store/filings";

export interface IngestInput {
  accession: string;
  /** Known from the submissions list; used when the XML cannot be parsed. */
  issuerCik: string;
  /** `YYYY-MM-DD`, from the submissions JSON (the XML does not carry it). */
  filedAt: string;
  xml: string;
}

export interface IngestResult {
  status: "ok" | "duplicate" | "parse_error";
  signalIds: number[];
  /** Amending signals that should push again (value moved more than 20% or was unknown). */
  repushIds: number[];
}

/** Parse, store, build signals, then recompute the issuer, all in one transaction. */
export function ingestFiling(db: Database.Database, input: IngestInput): IngestResult {
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

    const signalIds = persistSignals(db, saved.filingId, form.issuerCik, saved.ownerIds, signals);
    const anchor = signals.map((s) => s.txnDate).sort().at(-1) ?? form.periodOfReport ?? input.filedAt;
    const { replaced, rows } = recomputeIssuer(db, form.issuerCik, anchor);
    const repushIds = signalIds.filter((id) => {
      const before = replaced.get(id);
      const after = rows.find((r) => r.id === id)!;
      return replaced.has(id) && repushOnAmendment(before, after);
    });
    return { status: "ok", signalIds, repushIds };
  })();
}

/** Ingest in ascending filing order (oldest first), so every run sees history before the present. */
export function ingestBatch(db: Database.Database, inputs: IngestInput[]): IngestResult[] {
  return [...inputs]
    .sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.accession.localeCompare(b.accession))
    .map((i) => ingestFiling(db, i));
}
