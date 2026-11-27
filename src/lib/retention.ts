import type Database from "better-sqlite3";
import type { Config } from "@/lib/config";
import { addDays } from "@/lib/signals/dates";

const WEEK_MS = 7 * 86_400_000;
const TASK = "retention-last-run";

export type RetentionConfig = Pick<
  Config,
  "RETENTION_POLL_RUN_DAYS" | "RETENTION_NOTIFICATION_DAYS" | "RETENTION_AUDIT_DAYS" | "RETENTION_INACTIVE_DAYS"
>;

export interface RetentionResult {
  pollRuns: number;
  notifications: number;
  fetchFailures: number;
  auditLines: number;
  companies: number;
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

/**
 * Delete what has aged out. Signals are never deleted.
 * - poll runs and notifications older than their periods, and failed fetches older than the poll-run period;
 * - audit lines (stored lines that did not become a signal) of filings filed more than the audit period ago;
 * - for each company inactive longer than the inactive period: all its stored lines, clusters, cursor, the filings
 *   and owners that have no signal, and the company row. Signals keep their filing and owner rows (foreign keys).
 */
export function runRetention(db: Database.Database, cfg: RetentionConfig, now: Date): RetentionResult {
  const today = now.toISOString().slice(0, 10);
  return db.transaction((): RetentionResult => {
    const pollRuns = db.prepare("DELETE FROM poll_run WHERE started_at < ?").run(daysAgo(now, cfg.RETENTION_POLL_RUN_DAYS)).changes;
    const notifications = db.prepare("DELETE FROM notification_log WHERE created_at < ?").run(daysAgo(now, cfg.RETENTION_NOTIFICATION_DAYS)).changes;
    const fetchFailures = db.prepare("DELETE FROM fetch_failure WHERE updated_at < ?").run(daysAgo(now, cfg.RETENTION_POLL_RUN_DAYS)).changes;
    const auditLines = db
      .prepare(
        `DELETE FROM transaction_line WHERE id IN (
           SELECT t.id FROM transaction_line t JOIN filing f ON f.id = t.filing_id
           WHERE f.filed_at < ? AND NOT (t.table_no = 1 AND t.code = 'P' AND t.shares IS NOT NULL AND t.price IS NOT NULL))`,
      )
      .run(addDays(today, -cfg.RETENTION_AUDIT_DAYS)).changes;

    const stale = db
      .prepare("SELECT cik FROM company WHERE active = 0 AND inactive_since IS NOT NULL AND inactive_since < ?")
      .pluck()
      .all(daysAgo(now, cfg.RETENTION_INACTIVE_DAYS)) as string[];
    for (const cik of stale) purgeCompany(db, cik);
    return { pollRuns, notifications, fetchFailures, auditLines, companies: stale.length };
  })();
}

function purgeCompany(db: Database.Database, cik: string): void {
  // A filing stays when a signal points at it, as its own filing or as the 4/A that removed the signal.
  const unsignaled = `SELECT id FROM filing WHERE issuer_cik = ?
    AND id NOT IN (SELECT filing_id FROM signal)
    AND id NOT IN (SELECT superseded_by_filing_id FROM signal WHERE superseded_by_filing_id IS NOT NULL)`;
  db.prepare("DELETE FROM transaction_line WHERE filing_id IN (SELECT id FROM filing WHERE issuer_cik = ?)").run(cik);
  db.prepare("DELETE FROM cluster_member WHERE cluster_id IN (SELECT id FROM cluster WHERE issuer_cik = ?)").run(cik);
  db.prepare("DELETE FROM cluster WHERE issuer_cik = ?").run(cik);
  db.prepare(`UPDATE filing SET amends_id = NULL WHERE amends_id IN (${unsignaled})`).run(cik);
  db.prepare(`DELETE FROM reporting_owner WHERE filing_id IN (${unsignaled})`).run(cik);
  db.prepare(`DELETE FROM filing WHERE id IN (${unsignaled})`).run(cik);
  db.prepare("DELETE FROM company_cursor WHERE cik = ?").run(cik);
  db.prepare("DELETE FROM company WHERE cik = ?").run(cik);
}

/** True when retention has never run or its last run is a week old. */
export function retentionDue(db: Database.Database, now: Date): boolean {
  const last = db.prepare("SELECT done_at FROM maintenance_done WHERE name = ?").pluck().get(TASK) as string | undefined;
  return !last || now.getTime() - Date.parse(last) >= WEEK_MS;
}

/** Weekly: run retention, then VACUUM (outside any transaction), and remember the time. Returns null when not due. */
export function runRetentionIfDue(db: Database.Database, cfg: RetentionConfig, now: Date): RetentionResult | null {
  if (!retentionDue(db, now)) return null;
  const result = runRetention(db, cfg, now);
  db.prepare(
    `INSERT INTO maintenance_done (name, done_at) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET done_at = excluded.done_at`,
  ).run(TASK, now.toISOString());
  db.exec("VACUUM");
  return result;
}
