import { describe, expect, it } from "vitest";
import { HOLIDAYS } from "@/lib/sec/holidays";
import { isBusinessDay, isLate, lagDays } from "@/lib/sec/lag";

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Nth (1-based) weekday of a month; weekday 0 = Sunday. n = -1 means last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const matches: number[] = [];
  for (let d = 1; d <= days; d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === weekday) matches.push(d);
  }
  return iso(y, m, n === -1 ? matches[matches.length - 1] : matches[n - 1]);
}

/** Federal calendar: a Saturday holiday moves to Friday, a Sunday holiday to Monday. */
function federalObserved(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  const wd = t.getUTCDay();
  if (wd === 6) t.setUTCDate(d - 1);
  if (wd === 0) t.setUTCDate(d + 1);
  return t.toISOString().slice(0, 10);
}

/** NYSE calendar: a Sunday holiday moves to Monday; a Saturday holiday is NOT observed (null). */
function nyseObserved(y: number, m: number, d: number): string | null {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 6) return null;
  return wd === 0 ? iso(y, m, d + 1) : iso(y, m, d);
}

const GOOD_FRIDAY = [
  "2025-04-18", "2026-04-03", "2027-03-26", "2028-04-14", "2029-03-30", "2030-04-19",
];

/** Union of the NYSE and federal calendars (SEC is closed on federal holidays). */
function derived(): Set<string> {
  const out = new Set<string>([...GOOD_FRIDAY, "2025-01-09"]);
  const fixed: [number, number][] = [[1, 1], [6, 19], [7, 4], [12, 25]];
  for (let y = 2025; y <= 2030; y++) {
    for (const [m, d] of fixed) {
      out.add(federalObserved(y, m, d));
      const nyse = nyseObserved(y, m, d);
      if (nyse) out.add(nyse);
    }
    out.add(federalObserved(y, 11, 11)); // Veterans Day: federal only
    for (const d of [
      nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), nthWeekday(y, 5, 1, -1),
      nthWeekday(y, 9, 1, 1), nthWeekday(y, 10, 1, 2), nthWeekday(y, 11, 4, 4),
    ]) out.add(d);
  }
  // Jan 1 2028 is a Saturday: federalObserved gives 2027-12-31 (added above), NYSE gives nothing.
  return out;
}

describe("holiday list", () => {
  it("matches the dates derived by rule for 2025-2030", () => {
    expect([...HOLIDAYS].sort()).toEqual([...derived()].sort());
  });

  it("includes 2027-12-31: federal observance of Jan 1 2028 (a Saturday); NYSE stays open", () => {
    expect(HOLIDAYS.has("2027-12-31")).toBe(true);
    expect(isBusinessDay("2027-12-31")).toBe(false);
    expect(HOLIDAYS.has("2028-01-01")).toBe(false);
  });

  it("does not observe Saturday NYSE holidays on Friday (2027-06-18 and 2027-12-24 come from the federal calendar)", () => {
    expect(nyseObserved(2027, 6, 19)).toBeNull();
    expect(nyseObserved(2027, 12, 25)).toBeNull();
    expect(federalObserved(2027, 6, 19)).toBe("2027-06-18");
    expect(federalObserved(2027, 12, 25)).toBe("2027-12-24");
  });

  it("includes the one-off 2025-01-09 closure (national day of mourning)", () => {
    expect(HOLIDAYS.has("2025-01-09")).toBe(true);
    expect(isBusinessDay("2025-01-09")).toBe(false);
  });
});

describe("lagDays", () => {
  it("counts Mon to Wed as 2 and does not flag it late", () => {
    expect(lagDays("2026-11-09", "2026-11-11")).toBe(1); // Nov 11 is Veterans Day
    expect(lagDays("2026-11-02", "2026-11-04")).toBe(2);
    expect(isLate(2)).toBe(false);
  });

  it("is 0 on the same day", () => {
    expect(lagDays("2026-11-12", "2026-11-12")).toBe(0);
  });

  it("skips weekends", () => {
    expect(lagDays("2026-11-13", "2026-11-16")).toBe(1); // Fri to Mon
    expect(lagDays("2026-11-13", "2026-11-17")).toBe(2);
  });

  it("does not count Thanksgiving week holidays (not late)", () => {
    // Wed buy, filed Mon after Thanksgiving: Fri 27 and Mon 30 count.
    expect(lagDays("2026-11-25", "2026-11-30")).toBe(2);
    expect(isLate(lagDays("2026-11-25", "2026-11-30"))).toBe(false);
  });

  it("does not count July 4 observed on Friday July 3 2026", () => {
    expect(lagDays("2026-07-02", "2026-07-07")).toBe(2);
  });

  it("flags a genuinely late filing", () => {
    expect(isLate(lagDays("2026-11-02", "2026-11-05"))).toBe(true);
  });
});
