import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sql = (name: string) => readFileSync(join(process.cwd(), "migrations", name), "utf8");

it("0010 stamps existing failed fetches so they age from the upgrade", () => {
  const db = new Database(":memory:");
  for (const f of readdirSync("migrations").filter((f) => f < "0010").sort()) db.exec(sql(f));
  db.exec("INSERT INTO fetch_failure (accession_no, failures) VALUES ('y-1', 2)");
  db.exec(sql("0010_fetch_failure_age.sql"));
  expect(db.prepare("SELECT updated_at FROM fetch_failure").pluck().get()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
