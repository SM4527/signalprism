/**
 * Usage: npm run poll:now. Asks the running scheduler, which holds the lock, to poll now (it notices within
 * 30 s), waits for that run and prints its counts. It never polls SEC itself, so there is one limiter.
 */
import { loadConfig } from "../src/lib/config.ts";
import { openDb } from "../src/lib/db.ts";

const STALE_MS = 2 * 60_000;
const WAIT_MS = 10 * 60_000;

const db = openDb(loadConfig().DB_PATH);
const lock = db.prepare("SELECT owner, heartbeat_at FROM scheduler_lock WHERE id = 1").get() as {
  owner: string | null;
  heartbeat_at: string | null;
};
if (!lock.owner || !lock.heartbeat_at || Date.now() - Date.parse(lock.heartbeat_at) > STALE_MS) {
  console.error("No running scheduler holds the lock. Start the stack (live mode) and try again.");
  process.exit(1);
}

const requestedAt = new Date().toISOString();
db.prepare("UPDATE scheduler_lock SET poll_requested_at = ? WHERE id = 1").run(requestedAt);
console.log("poll requested; the scheduler picks it up within 30 s");

const find = db.prepare(
  `SELECT requests, filings_new, signals_new, errors FROM poll_run
   WHERE started_at >= ? AND finished_at IS NOT NULL ORDER BY id LIMIT 1`,
);
for (const deadline = Date.now() + WAIT_MS; Date.now() < deadline; ) {
  const run = find.get(requestedAt) as { requests: number; filings_new: number; signals_new: number; errors: number } | undefined;
  if (run) {
    console.log(`poll done: ${run.requests} requests, ${run.filings_new} new filings, ${run.signals_new} new signals, ${run.errors} errors`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.error("Still running after 10 minutes; check the Status page.");
process.exit(1);
