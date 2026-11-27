import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sql = (name: string) => readFileSync(join(process.cwd(), "migrations", name), "utf8");
const upTo0008 = () => readdirSync("migrations").filter((f) => f < "0009").sort();

function populated() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const f of upTo0008()) db.exec(sql(f));
  db.exec(`
    INSERT INTO company (cik, ticker, name, active, added_at) VALUES ('1', 'AAA', 'A', 1, '2026-01-01'), ('2', 'BBB', 'B', 0, '2026-01-01');
    INSERT INTO company_cursor (cik, last_accession, last_polled_at, last_error) VALUES
      ('1', 'acc', '2026-11-01T00:00:00Z', NULL);
    INSERT INTO filing (id, accession_no, form_type, issuer_cik, filed_at) VALUES (1, 'x-1', '4', '1', '2026-11-01');
    INSERT INTO reporting_owner (id, filing_id, owner_name, role) VALUES (1, 1, 'Ann', 'CEO');
    INSERT INTO signal (filing_id, owner_id, issuer_cik, txn_date, shares, value, avg_price, lag_days) VALUES (1, 1, '1', '2026-11-01', '1', '1', '1', 0);
    INSERT INTO fetch_failure (accession_no, failures) VALUES ('y-1', 2);
    INSERT OR IGNORE INTO notification_config (id) VALUES (1);`);
  return db;
}

it("0009 marks stored signals historical, keeps cursors as polled, and starts the inactive clock", () => {
  const db = populated();
  db.exec(sql("0009_alerts.sql"));
  expect(db.prepare("SELECT historical FROM signal").pluck().all()).toEqual([1]);
  expect(db.prepare("SELECT first_polled_at FROM company_cursor WHERE cik = '1'").pluck().get()).toBe("2026-11-01T00:00:00Z");
  expect(db.prepare("SELECT historical FROM fetch_failure").pluck().get()).toBe(0);
  expect(db.prepare("SELECT inactive_since FROM company WHERE cik = '2'").pluck().get()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(db.prepare("SELECT inactive_since FROM company WHERE cik = '1'").pluck().get()).toBeNull();
});

it("0009 leaves a cursor whose first poll failed as a first poll", () => {
  const db = populated();
  db.exec("INSERT INTO company_cursor (cik, last_polled_at, last_error) VALUES ('2', '2026-11-02T00:00:00Z', 'submissions: 500')");
  db.exec(sql("0009_alerts.sql"));
  expect(db.prepare("SELECT first_polled_at FROM company_cursor WHERE cik = '2'").pluck().get()).toBeNull();
});

it("0009 gives notification_config its new columns and an outbox that rejects priority 2", () => {
  const db = populated();
  db.exec(sql("0009_alerts.sql"));
  expect(db.prepare("SELECT digest_time, usage_limit FROM notification_config").get()).toEqual({ digest_time: "08:00", usage_limit: null });
  const insert = (priority: number, status = "held") =>
    db.prepare("INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at) VALUES ('signal', ?, ?, ?, '{}', 'now')").run(`k${priority}${status}`, status, priority);
  expect(() => insert(1)).not.toThrow();
  expect(() => insert(2)).toThrow();
  expect(() => insert(0, "sending")).not.toThrow();
  expect(() => insert(0, "bogus")).toThrow();
});

it("0009 lets clusters be deleted while a notification still names them", () => {
  const db = populated();
  db.exec(sql("0009_alerts.sql"));
  db.exec("INSERT INTO cluster (id, issuer_cik, window_start, window_end, insider_count, total_value) VALUES (7, '1', '2026-11-01', '2026-11-02', 2, '1')");
  db.exec("INSERT INTO notification_log (kind, cluster_id, dedup_key, status, payload_json, created_at) VALUES ('cluster', 7, 'c', 'held', '{}', 'now')");
  expect(() => db.exec("DELETE FROM cluster WHERE id = 7")).not.toThrow();
});
