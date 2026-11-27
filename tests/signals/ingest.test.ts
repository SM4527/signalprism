import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { ingestBatch, ingestFiling } from "@/lib/ingest";
import { fixtureXml } from "../sec/fixtures";
import { FIXTURES, input, snapshot } from "./helpers";

const count = (db: ReturnType<typeof openDb>, table: string) =>
  db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

describe("ingest", () => {
  it("is idempotent on accession", () => {
    const db = openDb(":memory:");
    ingestBatch(db, FIXTURES);
    const before = snapshot(db);
    const again = ingestBatch(db, FIXTURES);
    expect(again.every((r) => r.status === "duplicate")).toBe(true);
    expect(snapshot(db)).toEqual(before);
  });

  it("stores every line for audit but signals only the P lines", () => {
    const db = openDb(":memory:");
    ingestFiling(db, input("synthetic_p_mixed_codes.xml", "M-1", "2026-11-10"));
    expect(count(db, "signal")).toBe(1);
    expect(db.prepare("SELECT count(DISTINCT code) FROM transaction_line").pluck().get()).toBeGreaterThan(1);
  });

  it("creates no signal for conversions or a missing price", () => {
    const db = openDb(":memory:");
    for (const [f, i] of [
      ["synthetic_conversion_no_p.xml", "N-1"],
      ["synthetic_no_price.xml", "N-3"],
    ]) {
      ingestFiling(db, input(f, i, "2026-11-10"));
    }
    expect(count(db, "signal")).toBe(0);
    expect(count(db, "filing")).toBe(2);
  });

  it("stores a 10b5-1 box purchase as a plan signal with no first-buy points", () => {
    const db = openDb(":memory:");
    ingestFiling(db, input("synthetic_p_10b5_box.xml", "N-2", "2026-10-22"));
    expect(db.prepare("SELECT plan_kind FROM signal").pluck().get()).toBe("10b5-1");
    expect(db.prepare("SELECT score_parts_json FROM signal").pluck().get()).not.toContain("first buy");

    const unplanned = openDb(":memory:");
    const open = input("synthetic_p_10b5_box.xml", "N-2", "2026-10-22");
    ingestFiling(unplanned, { ...open, xml: open.xml.replace("<aff10b5One>1</aff10b5One>", "<aff10b5One>0</aff10b5One>") });
    expect(unplanned.prepare("SELECT plan_kind FROM signal").pluck().get()).toBeNull();
    expect(unplanned.prepare("SELECT score_parts_json FROM signal").pluck().get()).toContain("first buy");
  });

  it("records a parse error on the filing and keeps going", () => {
    const db = openDb(":memory:");
    const r = ingestFiling(db, input("synthetic_malformed.xml", "E-1", "2026-11-10", "0009000011"));
    expect(r.status).toBe("parse_error");
    expect(db.prepare("SELECT parse_error FROM filing").pluck().get()).toBeTruthy();
    expect(ingestFiling(db, input("synthetic_malformed.xml", "E-1", "2026-11-10")).status).toBe("duplicate");
  });

  it("forms one cluster of three insiders and scores the members with +3", () => {
    const db = openDb(":memory:");
    ingestBatch(db, FIXTURES);
    const cluster = db.prepare("SELECT * FROM cluster").all() as { insider_count: number; window_start: string }[];
    expect(cluster).toHaveLength(1);
    expect(cluster[0].insider_count).toBe(3);
    const parts = db.prepare("SELECT score_parts_json FROM signal WHERE score_parts_json LIKE '%cluster%'").all();
    expect(parts).toHaveLength(3);
  });

  it("supersedes the original with the 4/A and flags a re-push above 20%", () => {
    const db = openDb(":memory:");
    const [orig, amend] = ingestBatch(db, [FIXTURES[3], FIXTURES[4]]);
    expect(orig.repushIds).toEqual([]);
    expect(amend.repushIds).toHaveLength(1);
    const rows = db.prepare("SELECT id, superseded_by FROM signal ORDER BY id").all() as {
      id: number;
      superseded_by: number | null;
    }[];
    expect(rows[0].superseded_by).toBe(rows[1].id);
    expect(rows[1].superseded_by).toBeNull();
  });

  it("does not re-push when the amended value moves by 20% or less", () => {
    const db = openDb(":memory:");
    const [, amend] = ingestBatch(db, [
      { ...FIXTURES[3], xml: FIXTURES[3].xml.replace("<value>300</value>", "<value>340</value>") },
      FIXTURES[4],
    ]);
    expect(amend.repushIds).toEqual([]);
  });

  describe("amendment matching", () => {
    const origWith = (acc: string, filedAt: string, shares: string) => ({
      ...input("synthetic_amendment_original.xml", acc, filedAt, "0009000006"),
      xml: fixtureXml("synthetic_amendment_original.xml").replace("<value>300</value>", `<value>${shares}</value>`),
    });
    const amend = (xmlEdit: (x: string) => string) => ({
      ...input("synthetic_amendment_4a.xml", "AM", "2026-10-26", "0009000006"),
      xml: xmlEdit(fixtureXml("synthetic_amendment_4a.xml")),
    });
    const stripDate = (x: string) => x.replace(/<dateOfOriginalSubmission>.*<\/dateOfOriginalSubmission>\s*/, "");
    const live = (db: ReturnType<typeof openDb>) =>
      db
        .prepare(
          `SELECT f.accession_no FROM signal s JOIN filing f ON f.id = s.filing_id
           WHERE s.superseded_by_filing_id IS NULL ORDER BY f.accession_no`,
        )
        .pluck()
        .all();

    it("uses dateOfOriginalSubmission to pick the amended original among two same-period originals", () => {
      const db = openDb(":memory:");
      ingestBatch(db, [origWith("O-1", "2026-10-21", "100"), origWith("O-2", "2026-10-22", "200"), amend((x) => x.replace("2026-10-22", "2026-10-21"))]);
      expect(live(db)).toEqual(["AM", "O-2"]);
    });

    it("falls back to the most recent same-period original when the date is absent", () => {
      const db = openDb(":memory:");
      ingestBatch(db, [origWith("O-1", "2026-10-21", "100"), origWith("O-2", "2026-10-22", "200"), amend(stripDate)]);
      expect(live(db)).toEqual(["AM", "O-1"]);
    });

    it("falls back when no earlier filing was made on the named date", () => {
      const db = openDb(":memory:");
      ingestBatch(db, [origWith("O-1", "2026-10-21", "100"), amend((x) => x.replace("2026-10-22", "2026-10-15"))]);
      expect(live(db)).toEqual(["AM"]);
    });

    it("a 4/A with no qualifying purchase removes the original and never re-pushes", () => {
      const db = openDb(":memory:");
      const removal = amend((x) => x.replace("<transactionCode>P<", "<transactionCode>A<"));
      const [, r] = ingestBatch(db, [origWith("O-1", "2026-10-22", "300"), removal]);
      expect(r.repushIds).toEqual([]);
      expect(db.prepare("SELECT count(*) FROM signal").pluck().get()).toBe(1);
      const row = db.prepare("SELECT superseded_by, superseded_by_filing_id, score FROM signal").get() as Record<string, number | null>;
      expect(row.superseded_by).toBeNull();
      expect(row.superseded_by_filing_id).not.toBeNull();
      expect(row.score).toBe(0);
    });

    it("the removal gives the same result when the original is ingested after the 4/A", () => {
      const removal = amend((x) => x.replace("<transactionCode>P<", "<transactionCode>A<"));
      const a = openDb(":memory:");
      ingestBatch(a, [origWith("O-1", "2026-10-22", "300"), removal]);
      const b = openDb(":memory:");
      ingestBatch(b, [removal]);
      ingestBatch(b, [origWith("O-1", "2026-10-22", "300")]);
      expect(snapshot(b)).toEqual(snapshot(a));
    });
  });

  it("gives the same signals, scores and clusters in any batch order", () => {
    const ascending = openDb(":memory:");
    ingestBatch(ascending, FIXTURES);

    const reversed = openDb(":memory:");
    const byDate = [...FIXTURES].sort((a, b) => a.filedAt.localeCompare(b.filedAt));
    const half = Math.ceil(byDate.length / 2);
    ingestBatch(reversed, byDate.slice(half));
    ingestBatch(reversed, byDate.slice(0, half));

    expect(snapshot(reversed)).toEqual(snapshot(ascending));
  });
});
