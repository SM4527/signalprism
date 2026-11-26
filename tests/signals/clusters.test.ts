import { describe, expect, it } from "vitest";
import { detectClusters } from "@/lib/signals/clusters";
import type { SignalRow } from "@/lib/signals/issuer-rows";

let n = 0;
const row = (o: Partial<SignalRow>): SignalRow => ({
  id: ++n, filing_id: n, issuer_cik: "1", txn_date: "2026-01-01", value: "1000", pct_increase: null,
  new_position: 0, late: 0, plan_suspected: 0, plan_10b51: 0, held_via: null, superseded_by: null, superseded_by_filing: null, role: "CEO",
  owner_cik: `c${n}`, owner_name: `Person ${n}`, joint_group_id: null, form_type: "4",
  filed_at: "2026-01-02", period_of_report: "2026-01-01", ...o,
});

describe("detectClusters", () => {
  it("needs two distinct insiders and one officer", () => {
    expect(detectClusters([row({}), row({ txn_date: "2026-01-10", role: "CFO" })])).toHaveLength(1);
    expect(detectClusters([row({}), row({ txn_date: "2026-01-10", owner_cik: "c-same", role: "CFO" })])).toHaveLength(1);
    expect(detectClusters([row({ role: "DIRECTOR" }), row({ role: "DIRECTOR" })])).toHaveLength(0);
  });

  it("10b5-1 plan buys never form or join a cluster", () => {
    expect(detectClusters([row({}), row({ txn_date: "2026-01-10", role: "CFO", plan_10b51: 1 })])).toHaveLength(0);
    const c = detectClusters([row({}), row({ txn_date: "2026-01-10", role: "CFO" }), row({ txn_date: "2026-01-11", role: "COO", plan_10b51: 1 })]);
    expect(c[0].insiderCount).toBe(2);
    expect(c[0].members).toHaveLength(2);
  });

  it("counts the same person once, by cik then by name", () => {
    expect(detectClusters([row({ owner_cik: "x" }), row({ owner_cik: "x", txn_date: "2026-01-05" })])).toHaveLength(0);
    const a = row({ owner_cik: null, owner_name: "Doe, Jane" });
    const b = row({ owner_cik: null, owner_name: "DOE JANE", txn_date: "2026-01-05" });
    expect(detectClusters([a, b])).toHaveLength(0);
  });

  it("counts a joint group once and its value once", () => {
    const j = { joint_group_id: "joint:a,b", filing_id: 99, role: "CEO" as const };
    expect(detectClusters([row(j), row(j)])).toHaveLength(0);
    const c = detectClusters([row(j), row(j), row({ role: "CFO", txn_date: "2026-01-03" })]);
    expect(c[0].insiderCount).toBe(2);
    expect(c[0].totalValue).toBe("2000");
  });

  it("counts a person who files once jointly and once alone as one insider", () => {
    const joint = { joint_group_id: "joint:a+b", filing_id: 50 };
    const a = row({ owner_cik: "a", ...joint });
    const b = row({ owner_cik: "b", ...joint, role: "DIRECTOR" });
    const aAlone = row({ owner_cik: "a", txn_date: "2026-01-10" });
    expect(detectClusters([a, b, aAlone])).toHaveLength(0);
    const c = detectClusters([a, b, aAlone, row({ owner_cik: "c", role: "CFO", txn_date: "2026-01-12" })]);
    expect(c[0].insiderCount).toBe(2);
  });

  it("links owners through a joint group even when only one is eligible", () => {
    const joint = { joint_group_id: "joint:a+b", filing_id: 50 };
    const a = row({ owner_cik: "a", ...joint });
    const bTenPct = row({ owner_cik: "b", ...joint, role: "HOLDER_10PCT" });
    const bAlone = row({ owner_cik: "b", txn_date: "2026-01-10" });
    expect(detectClusters([a, bTenPct, bAlone])).toHaveLength(0);
  });

  it("ignores OTHER, 10% owners and superseded signals", () => {
    expect(detectClusters([row({}), row({ role: "OTHER" })])).toHaveLength(0);
    expect(detectClusters([row({}), row({ role: "HOLDER_10PCT" })])).toHaveLength(0);
    expect(detectClusters([row({}), row({ superseded_by_filing: 1 })])).toHaveLength(0);
  });

  it("windows start at the earliest signal and run 30 days inclusive", () => {
    const c = detectClusters([
      row({ txn_date: "2026-01-01" }),
      row({ txn_date: "2026-01-31" }),
      row({ txn_date: "2026-02-01" }),
      row({ txn_date: "2026-02-20" }),
    ]);
    expect(c.map((x) => [x.windowStart, x.insiderCount])).toEqual([["2026-01-01", 2], ["2026-02-01", 2]]);
  });

  it("a lone-insider window still consumes its signals", () => {
    const c = detectClusters([
      row({ owner_cik: "x", txn_date: "2026-01-01" }),
      row({ owner_cik: "x", txn_date: "2026-01-20" }),
      row({ role: "CFO", txn_date: "2026-02-05" }),
    ]);
    expect(c).toHaveLength(0);
  });
});
