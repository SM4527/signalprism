import { describe, expect, it } from "vitest";
import { isCommonTicker, normalizeTicker } from "@/lib/sec/ticker";

const map = new Map([["0000123456", "ACME"]]);

describe("normalizeTicker", () => {
  it.each([
    ["BRK.B", "BRK-B"],
    ["BRK-B", "BRK-B"],
    ["brk.a", "BRK-A"],
    [" msft ", "MSFT"],
  ])("%j -> %s", (raw, expected) => {
    expect(normalizeTicker(raw, "0000000001")).toBe(expected);
  });

  it.each(["NONE", "none", "", "N/A", null])("falls back to the CIK map for %j", (raw) => {
    expect(normalizeTicker(raw, "0000123456", map)).toBe("ACME");
  });

  it("returns null when the fallback has no entry", () => {
    expect(normalizeTicker("NONE", "0000999999", map)).toBeNull();
  });
});

describe("isCommonTicker", () => {
  it.each(["JPM", "GOOG", "GOOGL", "BRK-A", "BRK-B", "HEI-A", "DUAL-B", "PG", "UNH", "WMT", "RTX", "UPS", "ABC-PEER"])("%s is common", (t) => {
    expect(isCommonTicker(t)).toBe(true);
  });

  it.each(["JPM-PC", "JPM-PD", "BAC-PL", "XYZ-P", "ABC-WS", "ABC-WT", "ABC-W", "ABC-U", "ABC-UN", "ABC-R", "ABC-RT", "jpm-pc"])("%s is not", (t) => {
    expect(isCommonTicker(t)).toBe(false);
  });
});
