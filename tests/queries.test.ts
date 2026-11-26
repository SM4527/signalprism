import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { listWatchlist, companyByTicker } from "@/lib/queries/companies";
import { DEFAULT_FILTERS, auditLines, listSignals, parseFilters, signalsForIssuer } from "@/lib/queries/signals";
import { parseErrors, recentPollRuns } from "@/lib/queries/status";
import { seedSample } from "@/lib/seed-sample";
import { seedDefaults } from "@/lib/signals/rules";

const TODAY = "2026-11-26";
const db = openDb(":memory:");
seedDefaults(db);
seedSample(db, TODAY);

describe("listSignals", () => {
  const all = { ...DEFAULT_FILTERS, days: 400 };

  it("hides superseded signals", () => {
    const live = db.prepare("SELECT count(*) FROM signal WHERE superseded_by_filing_id IS NULL").pluck().get();
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
    expect(parseFilters({ days: "90", min: "4", role: "CFO", held: "1", rule: "1", sort: "score" })).toEqual({
      days: 90, minScore: 4, role: "CFO", heldOnly: true, matchesRule: true, sort: "score",
    });
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
