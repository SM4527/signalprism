import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { listWatchlist, companyByTicker } from "@/lib/queries/companies";
import { ingestFiling } from "@/lib/ingest";
import { groupAudit } from "@/lib/queries/audit";
import { DEFAULT_FILTERS, auditLines, groupJoint, listSignals, parseFilters, peopleFirst, signalsForIssuer, type SignalListRow } from "@/lib/queries/signals";
import { fixtureXml } from "./sec/fixtures";
import { parseErrors, recentPollRuns } from "@/lib/queries/status";
import { seedSample } from "@/lib/seed-sample";
import { seedDefaults } from "@/lib/signals/rules";

const TODAY = "2026-11-26";
const db = openDb(":memory:");
seedDefaults(db);
seedSample(db, TODAY);

describe("listSignals", () => {
  const all = { ...DEFAULT_FILTERS, days: 400, hidePlan: false };

  it("hides superseded signals", () => {
    const live = db
      .prepare(
        `SELECT count(DISTINCT CASE WHEN o.joint_group_id IS NULL THEN 's' || s.id ELSE s.filing_id || o.joint_group_id END)
         FROM signal s JOIN reporting_owner o ON o.id = s.owner_id WHERE s.superseded_by_filing_id IS NULL`,
      )
      .pluck()
      .get();
    expect(listSignals(db, all, TODAY)).toHaveLength(live as number);
  });

  it("defaults to the last 30 days, newest filed first", () => {
    const rows = listSignals(db, DEFAULT_FILTERS, TODAY);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.filedAt >= "2026-10-27")).toBe(true);
    const filed = rows.map((r) => r.filedAt);
    expect(filed).toEqual([...filed].sort().reverse());
  });

  it("sorts by score when asked", () => {
    const scores = listSignals(db, { ...all, sort: "score" }, TODAY).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("filters by minimum score and role", () => {
    expect(listSignals(db, { ...all, minScore: 5 }, TODAY).every((r) => r.score >= 5)).toBe(true);
    expect(listSignals(db, { ...all, role: "CEO" }, TODAY).every((r) => r.role === "CEO")).toBe(true);
  });

  it("matches-default-rule keeps only matching rows, and some rows do not match", () => {
    const matching = listSignals(db, { ...all, matchesRule: true }, TODAY);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every((r) => r.matchesRule)).toBe(true);
    expect(matching.length).toBeLessThan(listSignals(db, all, TODAY).length);
  });

  it("caps rows at 200", () => {
    const many = openDb(":memory:");
    seedDefaults(many);
    many.exec(`INSERT INTO company (cik, ticker, added_at) VALUES ('1', 'ZZZ', '2026-01-01')`);
    many.exec(`INSERT INTO filing (accession_no, form_type, issuer_cik, filed_at) VALUES ('a', '4', '1', '2026-11-20')`);
    many.exec(`INSERT INTO reporting_owner (filing_id, owner_name, role) VALUES (1, 'X', 'CEO')`);
    const ins = many.prepare(
      `INSERT INTO signal (filing_id, owner_id, issuer_cik, txn_date, shares, value, avg_price, lag_days)
       VALUES (1, 1, '1', '2026-11-19', '1', '1', '1', 1)`,
    );
    many.exec("DROP INDEX signal_filing_owner");
    many.transaction(() => {
      for (let i = 0; i < 250; i++) ins.run();
    })();
    expect(listSignals(many, DEFAULT_FILTERS, TODAY)).toHaveLength(200);
  });

  it("flags a cluster member", () => {
    expect(listSignals(db, all, TODAY).some((r) => r.inCluster)).toBe(true);
  });
});

describe("parseFilters", () => {
  it("falls back to defaults on junk", () => {
    expect(parseFilters({ days: "-3", min: "x", role: "KING", sort: "z" })).toEqual(DEFAULT_FILTERS);
  });
  it("reads valid values", () => {
    expect(parseFilters({ days: "90", min: "4", role: "CFO", held: "1", rule: "1", sort: "score", hideplan: ["0", "1"] })).toEqual({
      days: 90, minScore: 4, role: "CFO", heldOnly: true, matchesRule: true, hidePlan: true, sort: "score",
    });
  });

  it("hides plan buys by default, shows them only when the box is unchecked", () => {
    expect(parseFilters({}).hidePlan).toBe(true);
    expect(parseFilters({ days: "30" }).hidePlan).toBe(true);
    expect(parseFilters({ hideplan: "0" }).hidePlan).toBe(false);
    expect(parseFilters({ hideplan: ["0", "1"] }).hidePlan).toBe(true);
  });
});

describe("ticker page queries", () => {
  const company = listWatchlist(db).find((c) => signalsForIssuer(db, c.cik).length > 0)!;

  it("finds a company case-insensitively and rejects an unknown one", () => {
    expect(companyByTicker(db, company.ticker.toLowerCase())?.cik).toBe(company.cik);
    expect(companyByTicker(db, "NOPE")).toBeNull();
  });

  it("audit lines never include a qualifying purchase", () => {
    const lines = db.prepare("SELECT cik FROM company").pluck().all() as string[];
    const audit = lines.flatMap((cik) => auditLines(db, cik));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((l) => l.code === "M" || l.code === "A" || l.code === "S")).toBe(true);
    expect(audit.every((l) => l.why.length > 0)).toBe(true);
  });
});

describe("watchlist and status", () => {
  it("lists active companies with their sources", () => {
    const list = listWatchlist(db);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.inManual && !c.inDirect && !c.inFunds)).toBe(true);
    expect(list.some((c) => c.lastFiled !== null)).toBe(true);
  });

  it("reports parse errors and no poll runs on the sample", () => {
    expect(parseErrors(db)).toHaveLength(2);
    expect(recentPollRuns(db)).toEqual([]);
  });
});

describe("plan signals", () => {
  const all = { ...DEFAULT_FILTERS, days: 400 };
  it("are listed with the badge flag only when not hidden, and never match the rule", () => {
    const shown = listSignals(db, { ...all, hidePlan: false }, TODAY);
    const plans = shown.filter((r) => r.planKind);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((r) => r.planKind === "10b5-1" && !r.matchesRule && !r.inCluster)).toBe(true);
    expect(listSignals(db, all, TODAY).some((r) => r.planKind)).toBe(false);
    expect(listSignals(db, { ...all, hidePlan: false, matchesRule: true }, TODAY).some((r) => r.planKind)).toBe(false);
  });
});

describe("audit groups", () => {
  const line = (o: Partial<ReturnType<typeof auditLines>[number]>) => ({
    ownerName: "Ann", accession: "A-1", filedAt: "2026-11-01", tableNo: 1, code: "S", securityTitle: "Common Stock",
    txnDate: "2026-10-30", shares: "100", price: "10", plan10b51: false, why: "code S", ...o,
  });

  it("makes one row per filing and owner with total shares and the weighted average price", () => {
    const groups = groupAudit([
      line({ shares: "100", price: "10" }),
      line({ shares: "300", price: "20", code: "M", why: "code M" }),
      line({ ownerName: "Bob" }),
      line({ accession: "A-2" }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      accession: "A-1", ownerName: "Ann", codes: ["S", "M"], totalShares: "400", avgPrice: "17.5", reasons: ["code S", "code M"],
    });
    expect(groups[0].lines).toHaveLength(2);
  });

  it("has no totals for holding rows", () => {
    const [g] = groupAudit([line({ tableNo: "I-holding", code: "", shares: null, price: null, why: "holding report" })]);
    expect(g).toMatchObject({ codes: [], totalShares: null, avgPrice: null });
  });

  it("groups the sample's stored lines by filing", () => {
    const cik = db.prepare("SELECT cik FROM company c WHERE EXISTS (SELECT 1 FROM transaction_line t JOIN filing f ON f.id = t.filing_id WHERE f.issuer_cik = c.cik AND t.code = 'M')").pluck().get() as string;
    const lines = auditLines(db, cik);
    const groups = groupAudit(lines);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(lines.length);
    expect(groups.flatMap((g) => g.lines)).toHaveLength(lines.length);
  });
});

describe("peopleFirst", () => {
  it("lists individuals before entities and keeps the order within each", () => {
    expect(
      peopleFirst(["Zed Capital LP", "Ann Smith", "Oak Holdings", "Bob Jones", "Smith Family Trust", "Acme Inc.", "Cy Fund"]),
    ).toEqual(["Ann Smith", "Bob Jones", "Zed Capital LP", "Oak Holdings", "Smith Family Trust", "Acme Inc.", "Cy Fund"]);
    expect(peopleFirst(["Big Partners", "Cole Reed", "Foo Capital, L.P.", "Dee Price"])).toEqual(["Cole Reed", "Dee Price", "Big Partners", "Foo Capital, L.P."]);
  });

  it("orders a joint row's names that way", () => {
    const base = listSignals(db, { ...DEFAULT_FILTERS, days: 400 }, TODAY)[0];
    const m = (id: number, name: string) => ({ ...base, id, filingId: 7, jointGroupId: "joint:x", ownerNames: [name] });
    expect(groupJoint([m(1, "North Star Capital LP"), m(2, "Dana Whit")])[0].ownerNames).toEqual(["Dana Whit", "North Star Capital LP"]);
  });
});

describe("joint filers", () => {
  const base = listSignals(db, { ...DEFAULT_FILTERS, days: 400 }, TODAY)[0];
  const member = (id: number, name: string, role: SignalListRow["role"], score: number): SignalListRow => ({
    ...base, id, filingId: 99, jointGroupId: "joint:a+b", ownerNames: [name], role, score,
    parts: [{ label: name, points: score }], inCluster: false, matchesRule: false,
  });

  it("groups one filing's joint members into one row with the highest role and score", () => {
    const rows = groupJoint([member(1, "Ann Fund", "HOLDER_10PCT", 2), member(2, "Bob", "CEO", 5), member(3, "Cy", "DIRECTOR", 4)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownerNames: ["Bob", "Cy", "Ann Fund"], role: "CEO", score: 5 });
    expect(rows[0].parts).toEqual([{ label: "Bob", points: 5 }]);
  });

  it("does not merge the same group across filings, or rows without a group", () => {
    const other = { ...member(4, "Ann Fund", "HOLDER_10PCT", 2), filingId: 100 };
    const solo = { ...member(5, "Dee", "CFO", 3), jointGroupId: null };
    expect(groupJoint([member(1, "Ann Fund", "HOLDER_10PCT", 2), other, solo])).toHaveLength(3);
  });

  it("lists the sample's joint filing once with both names", () => {
    const joint = openDb(":memory:");
    seedDefaults(joint);
    ingestFiling(joint, { accession: "J-1", issuerCik: "0000000000", filedAt: "2026-11-20", xml: fixtureXml("synthetic_joint_filers.xml") });
    const owners = joint.prepare("SELECT count(*) FROM signal").pluck().get() as number;
    const rows = listSignals(joint, { ...DEFAULT_FILTERS, days: 400 }, TODAY);
    expect(owners).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerNames).toHaveLength(2);
    expect(signalsForIssuer(joint, rows[0].issuerCik)).toHaveLength(1);
  });
});
