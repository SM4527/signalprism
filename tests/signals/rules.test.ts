import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { evaluateRule, loadRules, seedDefaults, type AlertRule, type RuleInput } from "@/lib/signals/rules";

const rule: AlertRule = {
  id: 1, name: "Default", roles: ["CEO", "CFO"], minValue: "100000", minPct: "10",
  directorMinValue: "250000", includeDirectors: false, includeTenPct: false, pushOnCluster: true, enabled: true,
};
const sig: RuleInput = { role: "CEO", value: "50000", pctIncrease: "5", newPosition: false, late: false, nonCommon: false, planKind: null };
const hit = (s: Partial<RuleInput>, r: Partial<AlertRule> = {}) => evaluateRule({ ...sig, ...s }, { ...rule, ...r }).matches;

describe("default rule", () => {
  it("seeds once from the database", () => {
    const db = openDb(":memory:");
    seedDefaults(db);
    seedDefaults(db);
    const rules = loadRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ roles: ["CEO", "CFO"], minValue: "100000", minPct: "10", includeDirectors: false });
  });

  it("value boundary", () => {
    expect(hit({ value: "99999.99" })).toBe(false);
    expect(hit({ value: "100000" })).toBe(true);
  });

  it("increase boundary and new position", () => {
    expect(hit({ pctIncrease: "9.99" })).toBe(false);
    expect(hit({ pctIncrease: "10" })).toBe(true);
    expect(hit({ pctIncrease: null, newPosition: true })).toBe(true);
    expect(hit({ pctIncrease: null })).toBe(false);
  });

  it("roles", () => {
    expect(hit({ role: "CFO", value: "100000" })).toBe(true);
    for (const role of ["COO", "PRESIDENT", "OTHER_OFFICER", "OTHER", "HOLDER_10PCT"] as const) {
      expect(hit({ role, value: "9999999" })).toBe(false);
    }
  });

  it("rejects late and non-common", () => {
    expect(hit({ value: "100000", late: true })).toBe(false);
    expect(hit({ value: "100000", nonCommon: true })).toBe(false);
  });

  it("directors are off by default and need 250K when on", () => {
    expect(hit({ role: "DIRECTOR", value: "999999" })).toBe(false);
    expect(hit({ role: "DIRECTOR", value: "249999" }, { includeDirectors: true })).toBe(false);
    expect(hit({ role: "DIRECTOR", value: "250000" }, { includeDirectors: true })).toBe(true);
  });

  it("10% owners only when on", () => {
    expect(hit({ role: "HOLDER_10PCT", value: "200000" }, { includeTenPct: true })).toBe(true);
  });

  it.each(["10b5-1", "espp", "drip", "401k"] as const)("a %s plan buy never matches, however large", (planKind) => {
    expect(hit({ value: "99999999", planKind })).toBe(false);
    expect(hit({ pctIncrease: null, newPosition: true, planKind })).toBe(false);
  });

  it("a disabled rule never matches", () => {
    expect(hit({ value: "100000" }, { enabled: false })).toBe(false);
  });
});
