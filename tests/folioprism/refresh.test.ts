import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { clearFolioCache } from "@/lib/watchlist/folioprism";
import { refreshFromFolioPrism } from "@/lib/watchlist/refresh";
import { input } from "../signals/helpers";
import { startFakeFolio, type FakeFolio } from "./fake-folioprism";

const NOW = new Date("2026-11-26T12:00:00Z");
const QQQ_CIK = "0001067839";

/** A made-up portfolio: `direct` stocks, funds, and rows (stock, fund) for the intersection. */
function portfolio(direct: string[], funds: string[], rows: [string, string][]) {
  const coverage = [...direct.map((ticker) => ({ ticker, source: "direct" })), ...funds.map((ticker) => ({ ticker, source: "curated" }))];
  return {
    "/api/holdings": [...direct, ...funds].map((ticker) => ({ ticker })),
    "/api/analysis": {
      intersection: {
        rows: rows.map(([ticker, fund]) => ({ ticker, name: ticker, children: [{ sourceTicker: fund, portfolioPct: "1.5" }] })),
        coverage: { items: coverage },
      },
    },
  };
}

let fake: FakeFolio;
beforeEach(() => clearFolioCache());
afterEach(() => fake?.close());

function setup() {
  const db = openDb(":memory:");
  ingestFiling(db, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06"));
  const cik = db.prepare("SELECT issuer_cik FROM signal").pluck().get() as string;
  const put = db.prepare("INSERT INTO ticker_map VALUES (?, ?, ?, ?)");
  put.run(cik, "ACME", "Acme Corp", NOW.toISOString());
  put.run(QQQ_CIK, "QQQ", "Invesco QQQ Trust", NOW.toISOString());
  return { db, cik };
}

const run = async (db: ReturnType<typeof openDb>, files: Parameters<typeof startFakeFolio>[0]) => {
  await fake?.close();
  fake = await startFakeFolio(files);
  return refreshFromFolioPrism(db, loadConfig({ FOLIOPRISM_URL: fake.url }), NOW);
};
const signal = (db: ReturnType<typeof openDb>) =>
  db.prepare("SELECT in_portfolio, held_via, score_parts_json FROM signal").get() as { in_portfolio: number; held_via: string | null; score_parts_json: string };
const company = (db: ReturnType<typeof openDb>, ticker: string) =>
  db.prepare("SELECT in_direct, in_funds, in_manual, active FROM company WHERE ticker = ?").get(ticker);

describe("refresh from FolioPrism", () => {
  it("adds direct stocks, never funds (even an ETF with a CIK), and lists unmapped tickers as not tracked", async () => {
    const { db } = setup();
    const state = await run(db, portfolio(["ACME", "AAPL"], ["QQQ"], []));
    expect(state).toMatchObject({ ok: true, direct: 2, funds: 0, noCoverage: 0, notTracked: [{ ticker: "AAPL", reason: "no SEC CIK" }] });
    expect(company(db, "ACME")).toEqual({ in_direct: 1, in_funds: 0, in_manual: 0, active: 1 });
    expect(company(db, "QQQ")).toBeUndefined();
    expect(db.prepare("SELECT cik FROM company WHERE cik = ?").get(QQQ_CIK)).toBeUndefined();
  });

  it("counts holdings without a coverage item and lists them with their reason", async () => {
    const { db } = setup();
    const files = portfolio(["ACME"], [], []);
    files["/api/holdings"].push({ ticker: "ODDB" }, { ticker: "ACME-X" });
    const state = await run(db, files);
    expect(state.noCoverage).toBe(2);
    expect(state.notTracked).toEqual([
      { ticker: "ACME-X", reason: "no coverage in FolioPrism" },
      { ticker: "ODDB", reason: "no coverage in FolioPrism" },
    ]);
    expect(company(db, "ODDB")).toBeUndefined();
    expect(company(db, "ACME")).toMatchObject({ in_direct: 1 });
  });

  it("marks signals held directly and scores them, then clears it when the holding goes", async () => {
    const { db } = setup();
    await run(db, portfolio(["ACME"], [], []));
    expect(signal(db)).toMatchObject({ in_portfolio: 1, held_via: "direct" });
    expect(signal(db).score_parts_json).toContain("held directly");

    await run(db, portfolio([], ["QQQ"], []));
    expect(company(db, "ACME")).toMatchObject({ in_direct: 0, active: 0 });
    expect(signal(db)).toMatchObject({ in_portfolio: 0, held_via: null });
    expect(signal(db).score_parts_json).not.toContain("held");
  });

  it("marks a stock held only through a fund as funds", async () => {
    const { db } = setup();
    await run(db, portfolio([], ["QQQ"], [["ACME", "QQQ"]]));
    expect(company(db, "ACME")).toMatchObject({ in_direct: 0, in_funds: 1, active: 1 });
    expect(signal(db)).toMatchObject({ in_portfolio: 1, held_via: "funds" });
  });

  it("keeps manual companies and is the same on a second run", async () => {
    const { db } = setup();
    db.prepare("INSERT INTO company (cik, ticker, name, in_manual, added_at) VALUES (?, 'ACME', 'Acme Corp', 1, '2026-11-01')").run(
      (db.prepare("SELECT cik FROM ticker_map WHERE ticker = 'ACME'").pluck().get() as string),
    );
    await run(db, portfolio([], [], []));
    expect(company(db, "ACME")).toMatchObject({ in_manual: 1, active: 1 });
    await run(db, portfolio(["ACME"], [], []));
    const first = company(db, "ACME");
    await run(db, portfolio(["ACME"], [], []));
    expect(company(db, "ACME")).toEqual(first);
    expect(first).toMatchObject({ in_manual: 1, in_direct: 1 });
  });

  it("reports a failure without touching the watch list", async () => {
    const { db } = setup();
    await run(db, portfolio(["ACME"], [], []));
    const state = await run(db, { "/api/holdings": { bad: true } });
    expect(state.ok).toBe(false);
    expect(state.error).toBeTruthy();
    expect(company(db, "ACME")).toMatchObject({ in_direct: 1, active: 1 });
  });
});
