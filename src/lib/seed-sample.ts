import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestBatch, type IngestInput } from "@/lib/ingest";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { normalizeTicker } from "@/lib/sec/ticker";
import { addDays } from "@/lib/signals/dates";
import { upsertCompany } from "@/lib/store/companies";

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const DAY_MS = 86_400_000;
const DATE = /\d{4}-\d{2}-\d{2}/g;
const PERIOD = /<periodOfReport>(\d{4}-\d{2}-\d{2})/;

interface Entry {
  file: string;
  accession: string;
  issuerCik?: string;
  /** Calendar days from the period of report to the filing date (default 1). */
  filedAfterDays?: number;
}

const periodOf = (xml: string) => PERIOD.exec(xml)?.[1] ?? null;

/** Whole weeks that move the newest fixture filing to the last week before `today`; weekdays are kept. */
function weekShiftDays(items: { period: string | null; after: number }[], today: string): number {
  const newest = Math.max(
    ...items.filter((i) => i.period).map((i) => Date.parse(addDays(i.period!, i.after))),
  );
  return Math.floor((Date.parse(today) - newest) / (7 * DAY_MS)) * 7;
}

/**
 * Seed the sample stack from the fixtures with every date shifted by whole weeks, so the data looks recent.
 * Lag is recomputed from the shifted dates; holiday effects move with the shift and are not asserted.
 * Does nothing when filings already exist.
 */
export function seedSample(db: Database.Database, today: string): void {
  if (db.prepare("SELECT count(*) FROM filing").pluck().get() !== 0) return;
  const manifest: Entry[] = JSON.parse(readFileSync(join(FIXTURES, "sample", "manifest.json"), "utf8"));
  const raw = manifest.map((e) => ({ e, xml: readFileSync(join(FIXTURES, "form4", e.file), "utf8") }));
  const shift = weekShiftDays(
    raw.map(({ e, xml }) => ({ period: periodOf(xml), after: e.filedAfterDays ?? 1 })),
    today,
  );

  const inputs: IngestInput[] = raw.map(({ e, xml }) => {
    const shifted = xml.replace(DATE, (d) => addDays(d, shift));
    const parsed = parseForm4(shifted);
    const cik = parsed.ok ? parsed.form4.issuerCik : e.issuerCik!;
    const period = periodOf(shifted);
    if (parsed.ok) {
      const ticker = normalizeTicker(parsed.form4.tickerRaw, cik);
      if (ticker) {
        upsertCompany(db, { cik, ticker, name: parsed.form4.issuerName, source: "in_manual" }, today);
      }
    }
    return {
      accession: e.accession,
      issuerCik: cik,
      filedAt: period ? addDays(period, e.filedAfterDays ?? 1) : today,
      xml: shifted,
    };
  });
  ingestBatch(db, inputs);
}
