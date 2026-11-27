import type Database from "better-sqlite3";
import { loadNotificationConfig, type NotificationConfig } from "@/lib/queries/rules";
import { dueAfter, etTime, inQuietHours } from "./clock";
import { formatDigest, type Alert } from "./format";
import type { PushoverUsage, Sender } from "./pushover";

export const MAX_ATTEMPTS = 3;
const DEFAULT_DIGEST_TIME = "08:00";

export interface DeliverDeps {
  db: Database.Database;
  now: () => Date;
  /** Null (mock mode, or no Pushover credentials): rows are marked `logged` and nothing is sent. */
  sender: Sender | null;
  /** Write would-be messages to this log. Only for the sample stack: a personal log must not name tickers. */
  logContent?: (msg: string) => void;
  /** Checked before each row: false when this process no longer holds the scheduler lock. */
  canSend?: () => boolean;
  /** Test hook: runs after the request succeeded and before the row is marked (simulates a crash). */
  afterSend?: () => void;
}

export interface DeliverResult {
  sent: number;
  logged: number;
  failed: number;
}

interface Row {
  id: number;
  kind: "signal" | "cluster" | "digest" | "test";
  priority: 0 | 1;
  attempts: number;
  payload_json: string;
  created_at: string;
}

const alertOf = (r: Row): Alert => JSON.parse(r.payload_json) as Alert;

/** Rows stuck in `sending` (a crash, or a lost lock) go back to `held` and are retried: at-least-once delivery. */
export function releaseSending(db: Database.Database): number {
  return db.prepare("UPDATE notification_log SET status = 'held' WHERE status = 'sending'").run().changes;
}

function saveUsage(db: Database.Database, usage: PushoverUsage | null, now: Date): void {
  if (!usage) return;
  db.prepare("UPDATE notification_config SET usage_limit = ?, usage_remaining = ?, usage_reset_at = ?, usage_seen_at = ? WHERE id = 1").run(
    usage.limit, usage.remaining, usage.resetAt, now.toISOString(),
  );
}

/** Mark members of a digest row together with it. */
function finishMembers(db: Database.Database, digestId: number, status: "sent" | "logged" | "failed", at: string): void {
  db.prepare("UPDATE notification_log SET status = ?, sent_at = ? WHERE digested_in = ? AND status = 'held'").run(status, at, digestId);
}

/** When overflow and digest rows go out: the digest time, or the end of quiet hours, or 08:00 ET. */
const summaryTime = (c: NotificationConfig) => (c.digest ? c.digestTime : c.quietEnd ?? DEFAULT_DIGEST_TIME);

/** Digest mode: priority 0 alerts wait for the summary instead of going out at once. */
function markForDigest(db: Database.Database, c: NotificationConfig): void {
  if (!c.digest) return;
  db.prepare(
    "UPDATE notification_log SET digest = 1 WHERE status = 'held' AND digest = 0 AND digested_in IS NULL AND kind IN ('signal', 'cluster') AND priority = 0",
  ).run();
}

/** Gather the digest rows that are due into one summary row (held, sent like any other row). */
function compileDigest(db: Database.Database, c: NotificationConfig, now: Date): void {
  const at = summaryTime(c);
  const clock = etTime(now.toISOString());
  const due = (
    db
      .prepare("SELECT id, created_at, payload_json FROM notification_log WHERE status = 'held' AND digest = 1 AND digested_in IS NULL AND kind IN ('signal', 'cluster') ORDER BY id")
      .all() as { id: number; created_at: string; payload_json: string }[]
  ).filter((r) => dueAfter(r.created_at, at, clock));
  if (due.length === 0) return;

  const alert = formatDigest(due.map((r) => (JSON.parse(r.payload_json) as Alert).title));
  db.transaction(() => {
    const id = db
      .prepare(
        `INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at)
         VALUES ('digest', ?, 'held', 0, ?, ?)`,
      )
      .run(`digest:${now.toISOString()}:${due[0].id}`, JSON.stringify(alert), now.toISOString()).lastInsertRowid;
    const mark = db.prepare("UPDATE notification_log SET digested_in = ? WHERE id = ?");
    for (const r of due) mark.run(id, r.id);
  })();
}

function sentTodayCount(db: Database.Database, today: string, now: Date): number {
  const since = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  return (
    db
      .prepare("SELECT sent_at FROM notification_log WHERE status IN ('sent', 'logged') AND kind IN ('signal', 'cluster') AND digested_in IS NULL AND sent_at >= ?")
      .pluck()
      .all(since) as string[]
  ).filter((at) => etTime(at).date === today).length;
}

/**
 * Move held rows out: apply the digest mode, build due summaries, hold everything during quiet hours, cap the day's
 * individual alerts (the rest wait for the summary), then for each row claim it ('sending'), send, and mark it.
 * Call it only from the process holding the scheduler lock. A crash between the request and the mark leaves the row
 * in 'sending'; `releaseSending` puts it back, so a push can repeat but is never lost.
 */
export async function deliverPending(deps: DeliverDeps): Promise<DeliverResult> {
  const { db } = deps;
  const result: DeliverResult = { sent: 0, logged: 0, failed: 0 };
  const config = loadNotificationConfig(db);
  if (!config) return result;
  const now = deps.now();
  const clock = etTime(now.toISOString());

  markForDigest(db, config);
  compileDigest(db, config, now);
  if (inQuietHours(config.quietStart, config.quietEnd, clock.minutes)) return result;

  const logOnly = !deps.sender || !config.pushoverEnabled;
  let room = config.dailyCap - sentTodayCount(db, clock.date, now);
  const rows = db
    .prepare(
      `SELECT id, kind, priority, attempts, payload_json, created_at FROM notification_log
       WHERE status = 'held' AND digest = 0 AND digested_in IS NULL ORDER BY priority DESC, id`,
    )
    .all() as Row[];

  for (const row of rows) {
    if (deps.canSend && !deps.canSend()) break;
    const individual = row.kind === "signal" || row.kind === "cluster";
    if (individual && room <= 0) {
      // Over the daily cap: wait for the summary.
      db.prepare("UPDATE notification_log SET digest = 1 WHERE id = ?").run(row.id);
      continue;
    }
    const claimed = db.prepare("UPDATE notification_log SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'held'").run(row.id);
    if (claimed.changes !== 1) continue;

    const at = now.toISOString();
    if (logOnly) {
      deps.logContent?.(`would send: ${alertOf(row).title} | ${alertOf(row).body.replaceAll("\n", " / ")}`);
      db.prepare("UPDATE notification_log SET status = 'logged', sent_at = ? WHERE id = ?").run(at, row.id);
      if (row.kind === "digest") finishMembers(db, row.id, "logged", at);
      result.logged++;
      if (individual) room--;
      continue;
    }

    const sent = await deps.sender!.send(alertOf(row));
    deps.afterSend?.();
    if ("usage" in sent) saveUsage(db, sent.usage, now);
    if (sent.kind === "sent") {
      db.prepare("UPDATE notification_log SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(at, row.id);
      if (row.kind === "digest") finishMembers(db, row.id, "sent", at);
      result.sent++;
      if (individual) room--;
    } else if (sent.kind === "rejected" || row.attempts + 1 >= MAX_ATTEMPTS) {
      const error = sent.kind === "rejected" ? `HTTP ${sent.status}` : sent.error;
      db.prepare("UPDATE notification_log SET status = 'failed', error = ? WHERE id = ?").run(error, row.id);
      if (row.kind === "digest") finishMembers(db, row.id, "failed", at);
      result.failed++;
    } else {
      db.prepare("UPDATE notification_log SET status = 'held', error = ? WHERE id = ?").run(sent.error, row.id);
    }
  }
  return result;
}
