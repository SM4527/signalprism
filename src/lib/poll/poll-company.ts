import type Database from "better-sqlite3";
import { ingestFiling } from "@/lib/ingest";
import { SecPaused, type SecClient } from "@/lib/sec/client";
import { form4Entries, form4Url, submissionsUrl } from "@/lib/sec/submissions";
import { monthsBefore } from "@/lib/signals/dates";
import { saveParseError } from "@/lib/store/filings";

/** Window long enough that "first buy in 12 months" is complete for every signal in range. */
export const HISTORY_MONTHS = 13;
export const MAX_FETCH_FAILURES = 3;

export interface SecUrls {
  dataUrl: string;
  archivesUrl: string;
}

export interface PollCounts {
  filingsNew: number;
  signalsNew: number;
  errors: number;
}

function recordFetchFailure(db: Database.Database, accession: string): number {
  return db
    .prepare(
      `INSERT INTO fetch_failure (accession_no, failures) VALUES (?, 1)
       ON CONFLICT (accession_no) DO UPDATE SET failures = failures + 1 RETURNING failures`,
    )
    .pluck()
    .get(accession) as number;
}

function setCursor(db: Database.Database, cik: string, now: string, lastAccession: string | null, error: string | null) {
  db.prepare(
    `INSERT INTO company_cursor (cik, last_accession, last_polled_at, last_error) VALUES (?, ?, ?, ?)
     ON CONFLICT (cik) DO UPDATE SET last_accession = coalesce(excluded.last_accession, last_accession),
       last_polled_at = excluded.last_polled_at, last_error = excluded.last_error`,
  ).run(cik, lastAccession, now, error);
}

/**
 * Poll one company: one submissions request, then the XML of each unseen Form 4 or 4/A of the last 13 months,
 * oldest first. A first run and a later poll are the same code. A paused client (SecPaused) propagates.
 */
export async function pollCompany(
  db: Database.Database,
  client: SecClient,
  urls: SecUrls,
  cik: string,
  now: Date,
): Promise<PollCounts> {
  const counts: PollCounts = { filingsNew: 0, signalsNew: 0, errors: 0 };
  const stamp = now.toISOString();
  let lastAccession: string | null = null;
  let lastError: string | null = null;

  let entries;
  try {
    const body = await client.get(submissionsUrl(urls.dataUrl, cik));
    const seen = db.prepare("SELECT 1 FROM filing WHERE accession_no = ?");
    entries = form4Entries(body, monthsBefore(stamp.slice(0, 10), HISTORY_MONTHS))
      .filter((e) => !seen.get(e.accession))
      .sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.accession.localeCompare(b.accession));
  } catch (e) {
    if (e instanceof SecPaused) throw e;
    setCursor(db, cik, stamp, null, `submissions: ${(e as Error).message}`);
    return { ...counts, errors: 1 };
  }

  for (const entry of entries) {
    let xml: string;
    try {
      if (!entry.doc) throw new Error("no XML document");
      xml = await client.get(form4Url(urls.archivesUrl, cik, entry.accession, entry.doc));
    } catch (e) {
      if (e instanceof SecPaused) throw e;
      counts.errors++;
      lastError = `fetch: ${(e as Error).message}`;
      if (recordFetchFailure(db, entry.accession) >= MAX_FETCH_FAILURES) {
        saveParseError(db, entry.accession, cik, entry.filedAt, "fetch_failed");
      }
      continue;
    }
    const result = ingestFiling(db, { accession: entry.accession, issuerCik: cik, filedAt: entry.filedAt, xml });
    counts.filingsNew++;
    counts.signalsNew += result.signalIds.length;
    lastAccession = entry.accession;
  }
  setCursor(db, cik, stamp, lastAccession, lastError);
  return counts;
}
