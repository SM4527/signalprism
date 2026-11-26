import { describe, expect, it } from "vitest";
import { scoreSignal, type ScoreInput } from "@/lib/signals/score";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { fixtureXml } from "../sec/fixtures";

const base: ScoreInput = {
  role: "OTHER_OFFICER", value: "1000", pctIncrease: null, newPosition: false, late: false,
  planSuspected: false, heldVia: null, inCluster: false, firstBuy: false,
};
const score = (o: Partial<ScoreInput>) => scoreSignal({ ...base, ...o }).score;

describe("scoreSignal", () => {
  it("scores the role", () => {
    expect(score({ role: "CEO" })).toBe(3);
    expect(score({ role: "CFO" })).toBe(3);
    expect(score({ role: "COO" })).toBe(2);
    expect(score({ role: "PRESIDENT" })).toBe(2);
    expect(score({ role: "DIRECTOR" })).toBe(1);
    expect(score({ role: "OTHER" })).toBe(0);
  });

  it.each([["99999.99", 0], ["100000", 1], ["500000", 2], ["1000000", 3]])("value %s gives +%i", (v, pts) => {
    expect(score({ role: "OTHER", value: v })).toBe(pts);
  });

  it("scores holdings increase and new position", () => {
    expect(score({ role: "OTHER", pctIncrease: "9.99" })).toBe(0);
    expect(score({ role: "OTHER", pctIncrease: "10" })).toBe(1);
    expect(score({ role: "OTHER", pctIncrease: "25" })).toBe(2);
    expect(score({ role: "OTHER", newPosition: true })).toBe(2);
  });

  it("scores first buy, cluster, holding, late and suspected plan", () => {
    expect(score({ role: "OTHER", firstBuy: true })).toBe(2);
    expect(score({ role: "OTHER", inCluster: true })).toBe(3);
    expect(score({ role: "OTHER", heldVia: "direct" })).toBe(1);
    expect(score({ role: "OTHER", heldVia: "funds" })).toBe(0);
    expect(score({ role: "OTHER", late: true })).toBe(-1);
    expect(score({ role: "OTHER", planSuspected: true })).toBe(-2);
  });

  it("matches the PLAN example: Score 9", () => {
    const r = scoreSignal({ ...base, role: "CEO", value: "1200000", firstBuy: true, heldVia: "direct" });
    expect(r.score).toBe(9);
    expect(r.parts.map((p) => p.label)).toEqual(["CEO", "$1.2M", "first buy in 12 months", "held directly"]);
  });
});

describe("first buy lookback", () => {
  const FILE = "synthetic_ceo_multi_p.xml";
  const withDate = (from: string, to: string) => fixtureXml(FILE).replaceAll(from, to);
  const partsOf = (db: ReturnType<typeof openDb>, acc: string) =>
    db.prepare("SELECT s.score_parts_json FROM signal s JOIN filing f ON f.id = s.filing_id WHERE accession_no = ?")
      .pluck().get(acc) as string;

  it("is relative to the signal's txn_date, not now()", () => {
    const db = openDb(":memory:");
    const run = (acc: string, date: string) =>
      ingestFiling(db, { accession: acc, issuerCik: "0009000001", filedAt: date, xml: withDate("2026-11-02", date).replace("2026-11-04", date) });
    run("P-1", "2024-03-04");
    run("P-2", "2024-09-02");
    run("P-3", "2025-10-06");
    expect(partsOf(db, "P-1")).toContain("first buy");
    expect(partsOf(db, "P-2")).not.toContain("first buy");
    expect(partsOf(db, "P-3")).toContain("first buy");
  });
});
