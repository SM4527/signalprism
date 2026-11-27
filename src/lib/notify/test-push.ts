import type Database from "better-sqlite3";
import type { Alert } from "./format";
import type { Sender } from "./pushover";

const TEST_ALERT: Alert = {
  title: "SignalPrism test push",
  body: "If you can read this, Pushover is set up. Nothing else was sent.",
  url: null,
  priority: 0,
};

/**
 * Send one test message now, ignoring quiet hours, the cap and the "enabled" switch (so it can be tried before
 * turning Pushover on). With no sender (sample stack, or no credentials) nothing is sent and the would-be message
 * is only recorded. The row is `kind = test`; returns the message for the page.
 */
export async function sendTestPush(
  db: Database.Database,
  sender: Sender | null,
  now: Date,
  logContent?: (msg: string) => void,
): Promise<string> {
  const at = now.toISOString();
  const record = (status: "sent" | "logged" | "failed", error: string | null = null) =>
    db
      .prepare(
        `INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at, sent_at, error)
         VALUES ('test', ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(`test:${at}`, status, JSON.stringify(TEST_ALERT), at, status === "failed" ? null : at, error);

  if (!sender) {
    logContent?.(`would send: ${TEST_ALERT.title} | ${TEST_ALERT.body}`);
    record("logged");
    return "Test push logged only: Pushover is not configured here (no request was made).";
  }
  const result = await sender.send(TEST_ALERT);
  if (result.kind === "sent") {
    if (result.usage) {
      db.prepare("UPDATE notification_config SET usage_limit = ?, usage_remaining = ?, usage_reset_at = ?, usage_seen_at = ? WHERE id = 1").run(
        result.usage.limit, result.usage.remaining, result.usage.resetAt, at,
      );
    }
    record("sent");
    return "Test push sent.";
  }
  const error = result.kind === "rejected" ? `HTTP ${result.status}` : result.error;
  record("failed", error);
  return `Test push failed (${error}).`;
}
