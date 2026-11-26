import type Database from "better-sqlite3";
import { SecPaused, type SecClient } from "@/lib/sec/client";
import { pollCompany, type PollCounts, type SecUrls } from "./poll-company";

export interface PollStatus {
  lastRun: { started_at: string; finished_at: string | null; requests: number; filings_new: number; signals_new: number; errors: number } | null;
  /** ISO time SEC polling is paused until, or null. Shown as a banner. */
  pausedUntil: string | null;
}

export function getPollStatus(db: Database.Database, now: Date): PollStatus {
  const lastRun = db
    .prepare("SELECT started_at, finished_at, requests, filings_new, signals_new, errors FROM poll_run ORDER BY id DESC LIMIT 1")
    .get() as PollStatus["lastRun"] | undefined;
  const until = db.prepare("SELECT max(backoff_until) FROM poll_run").pluck().get() as string | null;
  return { lastRun: lastRun ?? null, pausedUntil: until && Date.parse(until) > now.getTime() ? until : null };
}

/** One pass over every active company. Skipped while paused; stops at once when SEC pauses us. */
export async function pollAll(
  db: Database.Database,
  client: SecClient,
  urls: SecUrls,
  now: Date,
): Promise<PollCounts | "paused"> {
  if (getPollStatus(db, now).pausedUntil) return "paused";
  const run = db.prepare("INSERT INTO poll_run (started_at) VALUES (?)").run(now.toISOString()).lastInsertRowid;
  const total: PollCounts = { filingsNew: 0, signalsNew: 0, errors: 0 };
  const startRequests = client.requests;
  let backoffUntil: string | null = null;

  const companies = db.prepare("SELECT cik FROM company WHERE active = 1 ORDER BY cik").pluck().all() as string[];
  for (const cik of companies) {
    try {
      const c = await pollCompany(db, client, urls, cik, now);
      total.filingsNew += c.filingsNew;
      total.signalsNew += c.signalsNew;
      total.errors += c.errors;
    } catch (e) {
      total.errors++;
      if (e instanceof SecPaused) {
        backoffUntil = new Date(e.until).toISOString();
        break;
      }
    }
  }
  db.prepare(
    `UPDATE poll_run SET finished_at = ?, requests = ?, filings_new = ?, signals_new = ?, errors = ?, backoff_until = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), client.requests - startRequests, total.filingsNew, total.signalsNew, total.errors, backoffUntil, run);
  return total;
}
