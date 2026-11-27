import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { storeTickerMap } from "@/lib/sec/ticker-map";
import { clearFolioCache } from "@/lib/watchlist/folioprism";
import { refreshFromFolioPrism } from "@/lib/watchlist/refresh";
import { listWatchlist } from "@/lib/queries/companies";
import { addTickers, removeTickers } from "@/lib/watchlist/watch";
import { FakeSec } from "../poll/fake-sec";
import { startFakeFolio, type FakeFolio } from "./fake-folioprism";

/** company_tickers.json shape: many entries can share one cik_str (share classes, preferreds). */
const TICKERS = JSON.stringify({
  "0": { cik_str: 9200001, ticker: "DUAL", title: "Dualclass Corp" },
  "1": { cik_str: 9200001, ticker: "DUAL-B", title: "Dualclass Corp" },
  "2": { cik_str: 9200002, ticker: "BANK", title: "Bankco Inc" },
  "3": { cik_str: 9200002, ticker: "BANK-PC", title: "Bankco Inc" },
  "4": { cik_str: 9200002, ticker: "BANK-PD", title: "Bankco Inc" },
  "5": { cik_str: 9200003, ticker: "SOLO", title: "Solo Inc" },
});
const NOW = new Date("2026-11-26T12:00:00Z");

const portfolio = (direct: string[], funds: string[] = [], rows: [string, string][] = []) => ({
  "/api/holdings": [...direct, ...funds].map((ticker) => ({ ticker })),
  "/api/analysis": {
    intersection: {
      rows: rows.map(([ticker, fund]) => ({ ticker, name: ticker, children: [{ sourceTicker: fund, portfolioPct: "1" }] })),
      coverage: { items: [...direct.map((ticker) => ({ ticker, source: "direct" })), ...funds.map((ticker) => ({ ticker, source: "curated" }))] },
    },
  },
});

describe("ticker_map keeps every ticker of a CIK", () => {
  it("stores two tickers on one CIK and finds each", () => {
    const db = openDb(":memory:");
    storeTickerMap(db, TICKERS, NOW);
    const cik = (t: string) => db.prepare("SELECT cik FROM ticker_map WHERE ticker = ?").pluck().get(t);
    expect(cik("DUAL")).toBe("0009200001");
    expect(cik("DUAL-B")).toBe("0009200001");
    expect(cik("BANK-PD")).toBe("0009200002");
    expect(db.prepare("SELECT count(*) FROM ticker_map").pluck().get()).toBe(6);
  });

  it("normalizes dots to dashes when storing", () => {
    const db = openDb(":memory:");
    storeTickerMap(db, JSON.stringify({ "0": { cik_str: 9200004, ticker: "ABC.B", title: "Abc" } }), NOW);
    expect(db.prepare("SELECT ticker FROM ticker_map").pluck().get()).toBe("ABC-B");
  });
});

describe("refresh and manual add with share classes", () => {
  const fake = new FakeSec();
  let folio: FakeFolio;
  beforeAll(() => fake.start());
  afterEach(async () => {
    clearFolioCache();
    await folio?.close();
  });
  afterAll(() => fake.stop());

  const live = () =>
    loadConfig({
      DATA_MODE: "live", SEC_USER_AGENT: "SignalPrismTest test@example.invalid",
      SEC_ARCHIVES_URL: fake.url, FOLIOPRISM_URL: folio.url,
    });

  it("loads an empty ticker map first, then maps both classes onto one company with merged sources", async () => {
    fake.bodies.set("/files/company_tickers.json", TICKERS);
    fake.requests = [];
    folio = await startFakeFolio(portfolio(["DUAL", "SOLO"], ["QQQ"], [["DUAL-B", "QQQ"]]));
    const db = openDb(":memory:");
    expect(db.prepare("SELECT count(*) FROM ticker_map").pluck().get()).toBe(0);

    const state = await refreshFromFolioPrism(db, live(), NOW);

    expect(fake.paths("/files/company_tickers.json")).toHaveLength(1);
    expect(state).toMatchObject({ ok: true, notTracked: [] });
    const rows = listWatchlist(db);
    expect(rows.map((r) => r.ticker).sort()).toEqual(["DUAL", "SOLO"]);
    const dual = rows.find((r) => r.ticker === "DUAL")!;
    expect(dual).toMatchObject({ inDirect: true, inFunds: true });
    expect(dual.otherTickers).toEqual(["DUAL-B"]);
  });

  it("does not reload a fresh ticker map", async () => {
    fake.bodies.set("/files/company_tickers.json", TICKERS);
    folio = await startFakeFolio(portfolio(["SOLO"]));
    const db = openDb(":memory:");
    storeTickerMap(db, TICKERS, new Date());
    fake.requests = [];
    await refreshFromFolioPrism(db, live(), new Date());
    expect(fake.paths("/files/company_tickers.json")).toHaveLength(0);
  });

  it("adds either class by hand to the same company and removes it by either ticker", () => {
    const db = openDb(":memory:");
    storeTickerMap(db, TICKERS, NOW);
    expect(addTickers(db, ["dual-b", "DUAL", "bank.pc"], "2026-11-26").done).toEqual(["DUAL-B", "DUAL", "BANK-PC"]);
    expect(db.prepare("SELECT count(*) FROM company").pluck().get()).toBe(2);
    expect(removeTickers(db, ["DUAL-B"]).done).toEqual(["DUAL-B"]);
    expect(db.prepare("SELECT active FROM company WHERE cik = '0009200001'").pluck().get()).toBe(0);
  });
});

describe("watchlist ticker display", () => {
  it("lists common share classes and counts the preferred tickers", () => {
    const db = openDb(":memory:");
    storeTickerMap(db, TICKERS, NOW);
    addTickers(db, ["BANK"], "2026-11-26");
    addTickers(db, ["DUAL"], "2026-11-26");
    const row = (t: string) => listWatchlist(db).find((c) => c.ticker === t)!;
    expect(row("BANK")).toMatchObject({ otherTickers: [], moreTickers: ["BANK-PC", "BANK-PD"] });
    expect(row("DUAL")).toMatchObject({ otherTickers: ["DUAL-B"], moreTickers: [] });
  });
});
