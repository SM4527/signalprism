import type Database from "better-sqlite3";

export interface PollRunRow {
  startedAt: string;
  finishedAt: string | null;
  requests: number;
  filingsNew: number;
  signalsNew: number;
  errors: number;
  backoffUntil: string | null;
}

export interface ParseErrorRow {
  accession: string;
  issuerCik: string;
  filedAt: string;
  error: string;
}

export function recentPollRuns(db: Database.Database, limit = 10): PollRunRow[] {
  const rows = db
    .prepare(
      `SELECT started_at, finished_at, requests, filings_new, signals_new, errors, backoff_until
       FROM poll_run ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    startedAt: r.started_at as string,
    finishedAt: r.finished_at as string | null,
    requests: r.requests as number,
    filingsNew: r.filings_new as number,
    signalsNew: r.signals_new as number,
    errors: r.errors as number,
    backoffUntil: r.backoff_until as string | null,
  }));
}

export function parseErrors(db: Database.Database, limit = 50): ParseErrorRow[] {
  const rows = db
    .prepare(
      `SELECT accession_no, issuer_cik, filed_at, parse_error FROM filing
       WHERE parse_error IS NOT NULL ORDER BY filed_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as { accession_no: string; issuer_cik: string; filed_at: string; parse_error: string }[];
  return rows.map((r) => ({ accession: r.accession_no, issuerCik: r.issuer_cik, filedAt: r.filed_at, error: r.parse_error }));
}

/** Filings that were stored but had something unreadable that did not matter (for example in Table II). */
export function parseWarnings(db: Database.Database, limit = 50): ParseErrorRow[] {
  const rows = db
    .prepare(
      `SELECT accession_no, issuer_cik, filed_at, parse_warning FROM filing
       WHERE parse_warning IS NOT NULL ORDER BY filed_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as { accession_no: string; issuer_cik: string; filed_at: string; parse_warning: string }[];
  return rows.map((r) => ({ accession: r.accession_no, issuerCik: r.issuer_cik, filedAt: r.filed_at, error: r.parse_warning }));
}

/** Accessions with at least one failed XML fetch that are not yet given up on. */
export const pendingFetchFailures = (db: Database.Database): number =>
  db
    .prepare(
      `SELECT count(*) FROM fetch_failure x
       WHERE NOT EXISTS (SELECT 1 FROM filing f WHERE f.accession_no = x.accession_no)`,
    )
    .pluck()
    .get() as number;
