import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { seedSample } from "@/lib/seed-sample";
import { seedDefaults } from "@/lib/signals/rules";
import { snapshot } from "./helpers";

const TODAY = "2026-11-26";

describe("seedSample", () => {
  const db = openDb(":memory:");
  seedDefaults(db);
  seedSample(db, TODAY);

  it("ingests every fixture, with parse errors counted", () => {
    expect(db.prepare("SELECT count(*) FROM filing").pluck().get()).toBe(33);
    expect(db.prepare("SELECT count(*) FROM filing WHERE parse_error IS NOT NULL").pluck().get()).toBe(2);
  });

  it("shifts by whole weeks and keeps filings in the past", () => {
    const newest = db.prepare("SELECT max(filed_at) FROM filing").pluck().get() as string;
    expect(newest <= TODAY).toBe(true);
    expect(Date.parse(TODAY) - Date.parse(newest)).toBeLessThan(7 * 86_400_000);
    const day = db.prepare("SELECT filed_at FROM filing WHERE accession_no = '9999999999-26-000001'").pluck().get() as string;
    expect(new Date(`${day}T00:00:00Z`).getUTCDay()).toBe(new Date("2026-11-05T00:00:00Z").getUTCDay());
  });

  it("shows scored signals, one 3-insider cluster and one superseded amendment", () => {
    expect(db.prepare("SELECT count(*) FROM signal WHERE score > 0").pluck().get()).toBeGreaterThan(3);
    expect(snapshot(db).clusters).toHaveLength(1);
    expect(db.prepare("SELECT insider_count FROM cluster").pluck().get()).toBe(3);
    expect(db.prepare("SELECT count(*) FROM signal WHERE superseded_by IS NOT NULL").pluck().get()).toBe(1);
  });

  it("is a no-op when run again", () => {
    const before = snapshot(db);
    seedSample(db, "2027-01-01");
    expect(snapshot(db)).toEqual(before);
  });
});
