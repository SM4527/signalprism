import { describe, expect, it } from "vitest";
import { formatEt, formatIncrease, formatShares, formatSignalCount, formatUsd } from "@/lib/format";
import { filingIndexUrl } from "@/lib/sec/links";

describe("formatEt", () => {
  it("shows a filing at 19:46 ET in winter (UTC-5)", () => {
    expect(formatEt("2026-11-27T00:46:00.000Z")).toBe("2026-11-26 19:46 ET");
  });
  it("shows a filing at 19:46 ET in summer (UTC-4)", () => {
    expect(formatEt("2026-07-15T23:46:00.000Z")).toBe("2026-07-15 19:46 ET");
  });
  it("moves a UTC early-morning poll to the previous ET day", () => {
    expect(formatEt("2026-03-09T02:30:00Z")).toBe("2026-03-08 22:30 ET");
  });
  it("leaves a plain date alone", () => {
    expect(formatEt("2026-11-26")).toBe("2026-11-26");
  });
});

describe("number formats", () => {
  it.each([
    ["1240000", "$1.2M"],
    ["1250000", "$1.3M"],
    ["250000", "$250K"],
    ["900", "$900"],
  ])("formatUsd %s", (v, out) => expect(formatUsd(v)).toBe(out));

  it("formatShares", () => {
    expect(formatShares("1234567")).toBe("1,234,567");
    expect(formatShares("1234.5")).toBe("1,234.5");
  });

  it("formatIncrease", () => {
    expect(formatIncrease("38.2345", false)).toBe("+38.2%");
    expect(formatIncrease(null, true)).toBe("New position");
    expect(formatIncrease(null, false)).toBe("—");
  });
});

describe("filingIndexUrl", () => {
  it("builds the sec.gov index link from the archives host", () => {
    expect(filingIndexUrl("0000320193", "0000320193-26-000001")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm",
    );
  });
  it("honors another archives host", () => {
    expect(filingIndexUrl("1", "0000000001-26-000001", "http://x")).toMatch(/^http:\/\/x\/Archives/);
  });
});

describe("formatSignalCount", () => {
  it("shows the plan buys only when there are some", () => {
    expect(formatSignalCount(14, 0)).toBe("Signals (14)");
    expect(formatSignalCount(261, 247)).toBe("Signals (261, 247 plan)");
  });
});
