import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { DEFAULT_FILTERS, listSignals } from "@/lib/queries/signals";
import { planKindOfFootnotes } from "@/lib/signals/plan";
import { reclassifyPlanBuys } from "@/lib/signals/reclassify";
import { recomputeIssuer } from "@/lib/signals/recompute";
import { seedDefaults } from "@/lib/signals/rules";
import { buildSignals } from "@/lib/signals/signal-builder";
import { fixtureXml, loadForm4 } from "../sec/fixtures";

const ESPP_REAL =
  `Common Shares purchased by the administrator of the issuer's Employee Stock Purchase Plan ("ESPP") on behalf of the filer pursuant to terms predetermined by the issuer.`;
const TODAY = "2026-11-26";

describe("planKindOfFootnotes", () => {
  it.each([
    [[ESPP_REAL], "espp"],
    [["Common Shares purchased and held under the issuer's Employee Stock Purchase Plan."], "espp"],
    [["Bought through the ESPP."], "espp"],
    [["pursuant to terms predetermined by the issuer"], "espp"],
    [["EMPLOYEE STOCK PURCHASE PLAN"], "espp"],
    [["Acquired under the Dividend Reinvestment Plan."], "drip"],
    [["Shares acquired through the DRIP."], "drip"],
    [["Represents shares acquired through the reinvestment of dividends on restricted stock."], "drip"],
    [["Dividends were reinvested."], "drip"],
    [["REINVEST the DIVIDEND"], "drip"],
    [["reinvestment of cash", "dividend paid in cash"], null],
    [["Includes adjustments for dividends accrued."], null],
    [["Held in the Company 401(k) plan."], "401k"],
    [["ESPP and 401(k)"], "espp"],
    [[], null],
    [["a dripping tap"], null],
  ] as const)("%j -> %s", (footnotes, kind) => {
    expect(planKindOfFootnotes([...footnotes])).toBe(kind);
  });
});

describe("buildSignals with plan footnotes", () => {
  it("an ESPP filing is one plan signal summing both lines", () => {
    const [s] = buildSignals(loadForm4("synthetic_espp.xml"), "2026-11-02");
    expect(s).toMatchObject({ planKind: "espp", shares: "230", value: "7266" });
    expect(s.footnotes).toHaveLength(2);
  });

  it("a DRIP footnote is a plan buy", () => {
    expect(buildSignals(loadForm4("synthetic_drip.xml"), "2026-11-02")[0].planKind).toBe("drip");
  });

  it("the 10b5-1 box keeps priority over an ESPP footnote", () => {
    const xml = fixtureXml("synthetic_espp.xml").replace("<aff10b5One>0</aff10b5One>", "<aff10b5One>1</aff10b5One>");
    const parsed = parseForm4(xml);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.form4.plan10b51).toBe(true);
    expect(buildSignals(parsed.form4, "2026-11-02")[0].planKind).toBe("10b5-1");
  });

  it("a mixed filing builds its signal from the discretionary line alone", () => {
    const [s] = buildSignals(loadForm4("synthetic_espp_mixed.xml"), "2026-11-02");
    expect(s).toMatchObject({ planKind: null, shares: "5000", value: "158000", txnDate: "2026-10-29" });
    expect(s.footnotes).toEqual([]);
  });
});

/** The ESPP fixture as a second person (CEO), so two officers buy through the plan. */
const otherEspp = (cik: string, name: string) =>
  fixtureXml("synthetic_espp.xml")
    .replace("0009100031", cik)
    .replace("Alder Jun", name)
    .replace("Chief Financial Officer", "Chief Executive Officer");

const count = (db: ReturnType<typeof openDb>, table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
const ingest = (db: ReturnType<typeof openDb>, accession: string, xml: string, filedAt = "2026-11-02") =>
  ingestFiling(db, { accession, issuerCik: "0009000021", filedAt, xml });

describe("plan buys in the database", () => {
  it("two officers' ESPP buys make no cluster, no rule match and no first-buy points", () => {
    const db = openDb(":memory:");
    seedDefaults(db);
    ingest(db, "E-1", fixtureXml("synthetic_espp.xml"));
    ingest(db, "E-2", otherEspp("0009100034", "Moss Dale"));
    expect(count(db, "signal")).toBe(2);
    expect(db.prepare("SELECT DISTINCT plan_kind FROM signal").pluck().all()).toEqual(["espp"]);
    expect(count(db, "cluster")).toBe(0);
    const all = { ...DEFAULT_FILTERS, days: 400, hidePlan: false, watchedOnly: false };
    expect(listSignals(db, all, TODAY).every((r) => r.planKind === "espp" && !r.matchesRule && !r.inCluster)).toBe(true);
    expect(listSignals(db, DEFAULT_FILTERS, TODAY)).toEqual([]);
    expect(db.prepare("SELECT group_concat(score_parts_json) FROM signal").pluck().get()).not.toContain("first buy");
  });

  it("a mixed filing still alerts on its discretionary line, and keeps every line for audit", () => {
    const db = openDb(":memory:");
    seedDefaults(db);
    ingest(db, "M-1", fixtureXml("synthetic_espp_mixed.xml"));
    const [row] = listSignals(db, { ...DEFAULT_FILTERS, days: 400, watchedOnly: false }, TODAY);
    expect(row).toMatchObject({ planKind: null, shares: "5000", value: "158000", matchesRule: true });
    expect(db.prepare("SELECT count(*) FROM transaction_line WHERE code = 'P'").pluck().get()).toBe(2);
  });

  it("ESPP buys do not take a person's first-buy points away from a later discretionary buy", () => {
    const db = openDb(":memory:");
    const pike = fixtureXml("synthetic_espp.xml").replace("0009100031", "0009100032").replace("Alder Jun", "Pike Rowan");
    ingest(db, "E-1", pike, "2026-11-02");
    ingest(db, "M-1", fixtureXml("synthetic_espp_mixed.xml"), "2026-11-02");
    const parts = db.prepare("SELECT score_parts_json FROM signal WHERE plan_kind IS NULL").pluck().get() as string;
    expect(parts).toContain("first buy in 12 months");
  });
});

describe("one-time reclassification of stored data", () => {
  /** Put the database back in the state before plan_kind existed: no plan kinds, marker not set. */
  function asBefore(db: ReturnType<typeof openDb>) {
    db.prepare("UPDATE signal SET plan_kind = NULL").run();
    db.prepare("DELETE FROM maintenance_done").run();
    recomputeIssuer(db, "0009000021", TODAY);
  }

  it("sets plan_kind from stored footnotes and removes the cluster the plan buys had formed", () => {
    const db = openDb(":memory:");
    ingest(db, "E-1", fixtureXml("synthetic_espp.xml"));
    ingest(db, "E-2", otherEspp("0009100034", "Moss Dale"));
    asBefore(db);
    expect(count(db, "cluster")).toBe(1);

    expect(reclassifyPlanBuys(db, TODAY)).toBe(2);
    expect(db.prepare("SELECT DISTINCT plan_kind FROM signal").pluck().all()).toEqual(["espp"]);
    expect(count(db, "cluster")).toBe(0);
    expect(count(db, "cluster_member")).toBe(0);
  });

  it("rebuilds a mixed filing's signal from its discretionary lines only", () => {
    const db = openDb(":memory:");
    ingest(db, "M-1", fixtureXml("synthetic_espp_mixed.xml"));
    db.prepare("UPDATE signal SET shares = '5080', value = '160520', avg_price = '31.6', plan_kind = NULL").run();
    db.prepare("DELETE FROM maintenance_done").run();

    expect(reclassifyPlanBuys(db, TODAY)).toBe(1);
    expect(db.prepare("SELECT shares, value, plan_kind FROM signal").get()).toEqual({ shares: "5000", value: "158000", plan_kind: null });
  });

  it("runs again on data that the first version of the step already handled", () => {
    const db = openDb(":memory:");
    ingest(db, "S-1", fixtureXml("SPG_form4-10012026_071044.xml"), "2026-10-01");
    expect(db.prepare("SELECT plan_kind FROM signal").pluck().get()).toBe("drip");
    db.prepare("UPDATE signal SET plan_kind = NULL").run();
    db.prepare("DELETE FROM maintenance_done").run();
    db.prepare("INSERT INTO maintenance_done VALUES ('plan-kind-from-footnotes', '2026-11-26T00:00:00Z')").run();

    expect(reclassifyPlanBuys(db, TODAY)).toBe(1);
    expect(db.prepare("SELECT plan_kind FROM signal").pluck().get()).toBe("drip");
  });

  it("leaves discretionary filings alone and runs only once", () => {
    const db = openDb(":memory:");
    ingest(db, "C-1", fixtureXml("Cat_tm2629746-1_4seq1.xml"), "2026-11-13");
    const before = db.prepare("SELECT * FROM signal").all();
    db.prepare("DELETE FROM maintenance_done").run();
    expect(reclassifyPlanBuys(db, TODAY)).toBe(0);
    expect(db.prepare("SELECT * FROM signal").all()).toEqual(before);

    ingest(db, "E-1", fixtureXml("synthetic_espp.xml"));
    db.prepare("UPDATE signal SET plan_kind = NULL WHERE plan_kind = 'espp'").run();
    expect(reclassifyPlanBuys(db, TODAY)).toBe(0);
    expect(db.prepare("SELECT count(*) FROM signal WHERE plan_kind IS NULL").pluck().get()).toBe(2);
  });
});
