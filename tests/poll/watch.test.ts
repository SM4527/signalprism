import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { addTickers, removeTickers } from "@/lib/watchlist/watch";

function setup() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO ticker_map VALUES ('0009000001', 'ACMR', 'Acme Robotics', '2026-11-26')").run();
  db.prepare("INSERT INTO ticker_map VALUES ('0009000006', 'FLCN', 'Falcon Foods', '2026-11-26')").run();
  return db;
}
const company = (db: ReturnType<typeof setup>, ticker: string) =>
  db.prepare("SELECT cik, name, in_manual, in_direct, active FROM company WHERE ticker = ?").get(ticker);

describe("watch add and remove", () => {
  it("maps tickers through ticker_map, ignores case and duplicates, and reports unknown ones", () => {
    const db = setup();
    const r = addTickers(db, ["acmr", "ACMR", " flcn ", "NOPE"], "2026-11-26");
    expect(r).toEqual({ done: ["ACMR", "FLCN"], unknown: ["NOPE"] });
    expect(company(db, "ACMR")).toEqual({ cik: "0009000001", name: "Acme Robotics", in_manual: 1, in_direct: 0, active: 1 });
    expect(company(db, "NOPE")).toBeUndefined();
  });

  it("remove clears in_manual and deactivates a company with no other source", () => {
    const db = setup();
    addTickers(db, ["ACMR", "FLCN"], "2026-11-26");
    db.prepare("UPDATE company SET in_direct = 1 WHERE ticker = 'FLCN'").run();
    const r = removeTickers(db, ["ACMR", "FLCN", "ZZZ"]);
    expect(r).toEqual({ done: ["ACMR", "FLCN"], unknown: ["ZZZ"] });
    expect(company(db, "ACMR")).toMatchObject({ in_manual: 0, active: 0 });
    expect(company(db, "FLCN")).toMatchObject({ in_manual: 0, in_direct: 1, active: 1 });
  });

  it("adding again reactivates a removed company", () => {
    const db = setup();
    addTickers(db, ["ACMR"], "2026-11-26");
    removeTickers(db, ["ACMR"]);
    addTickers(db, ["ACMR"], "2026-11-27");
    expect(company(db, "ACMR")).toMatchObject({ in_manual: 1, active: 1 });
  });
});
