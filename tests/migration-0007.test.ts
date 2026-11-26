import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { tickerMapStale } from "@/lib/sec/ticker-map";

const sql = (name: string) => readFileSync(join(process.cwd(), "migrations", name), "utf8");

it("0007 keys ticker_map by ticker, keeps rows, normalizes dots and marks the map stale", () => {
  const db = new Database(":memory:");
  for (const f of readdirSync("migrations").filter((f) => f < "0007").sort()) db.exec(sql(f));
  db.exec(`
    INSERT INTO ticker_map VALUES ('0000000001', 'ABC.B', 'Abc', '2026-11-26T00:00:00Z');
    INSERT INTO ticker_map VALUES ('0000000002', 'XYZ', 'Xyz', '2026-11-26T00:00:00Z');`);
  db.exec(sql("0007_ticker_map_by_ticker.sql"));

  expect(db.prepare("SELECT ticker, cik FROM ticker_map ORDER BY ticker").all()).toEqual([
    { ticker: "ABC-B", cik: "0000000001" },
    { ticker: "XYZ", cik: "0000000002" },
  ]);
  db.exec("INSERT INTO ticker_map VALUES ('0000000001', 'ABC-A', 'Abc', '2026-11-26T00:00:00Z')");
  expect(db.prepare("SELECT count(*) FROM ticker_map WHERE cik = '0000000001'").pluck().get()).toBe(2);
});

it("0007 leaves an upgraded map stale so the full map loads at the next start", () => {
  const db = new Database(":memory:");
  for (const f of readdirSync("migrations").filter((f) => f < "0007").sort()) db.exec(sql(f));
  db.exec("INSERT INTO ticker_map VALUES ('0000000001', 'ABC', 'Abc', '2026-11-26T00:00:00Z')");
  db.exec(sql("0007_ticker_map_by_ticker.sql"));
  expect(tickerMapStale(db, new Date("2026-11-26T12:00:00Z"))).toBe(true);
});
