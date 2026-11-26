import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sql = (name: string) => readFileSync(join(process.cwd(), "migrations", name), "utf8");

it("0005 removes parse-error filings and fetch failures so the next poll fetches them again", () => {
  const db = new Database(":memory:");
  for (const f of ["0001_init.sql", "0002_unique_keys.sql", "0003_fetch_failure.sql", "0004_poll_request.sql"]) db.exec(sql(f));
  db.exec(`
    INSERT INTO filing (accession_no, form_type, issuer_cik, filed_at, parse_error) VALUES ('bad', '4', '1', '2026-01-01', 'x');
    INSERT INTO filing (accession_no, form_type, issuer_cik, filed_at) VALUES ('good', '4', '1', '2026-01-01');
    INSERT INTO fetch_failure VALUES ('gone', 3);`);
  db.exec(sql("0005_parse_warning.sql"));
  expect(db.prepare("SELECT accession_no FROM filing").pluck().all()).toEqual(["good"]);
  expect(db.prepare("SELECT count(*) FROM fetch_failure").pluck().get()).toBe(0);
});
