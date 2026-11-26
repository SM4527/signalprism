import { describe, expect, it } from "vitest";
import { normalizeTicker } from "@/lib/sec/ticker";

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
