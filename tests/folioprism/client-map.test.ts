import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFolioCache, fetchFolioData, type FolioData } from "@/lib/watchlist/folioprism";
import { buildPortfolioMap } from "@/lib/watchlist/portfolio-map";
import { fixture, startFakeFolio, type FakeFolio } from "./fake-folioprism";

let fake: FakeFolio;
beforeEach(() => clearFolioCache());
afterEach(() => fake?.close());

describe("FolioPrism client", () => {
  it("reads both endpoints with GET only", async () => {
    fake = await startFakeFolio();
    const data = await fetchFolioData(fake.url);
    expect(data.holdings).toHaveLength(7);
    expect(fake.requests.sort()).toEqual(["GET /api/analysis", "GET /api/holdings"]);
  });

  it("serves the second call within an hour from memory, and force refetches", async () => {
    fake = await startFakeFolio();
    await fetchFolioData(fake.url, 0);
    await fetchFolioData(fake.url, 59 * 60_000);
    expect(fake.requests).toHaveLength(2);
    await fetchFolioData(fake.url, 61 * 60_000);
    expect(fake.requests).toHaveLength(4);
    await fetchFolioData(fake.url, 61 * 60_000, true);
    expect(fake.requests).toHaveLength(6);
  });

  it("rejects a payload of the wrong shape and a non-200 answer", async () => {
    fake = await startFakeFolio({ "/api/holdings": { not: "a list" } });
    await expect(fetchFolioData(fake.url)).rejects.toThrow();
    await fake.close();
    fake = await startFakeFolio({}, 500);
    await expect(fetchFolioData(fake.url)).rejects.toThrow("500");
  });
});

const data = (): FolioData => ({ holdings: fixture("holdings"), analysis: fixture("analysis") });

describe("portfolio map", () => {
  it("takes direct stocks from coverage source and never lists funds", () => {
    const m = buildPortfolioMap(data());
    expect([...m.direct].sort()).toEqual(["AAPL", "MSFT"]);
    for (const fund of ["VTI", "FXAIX", "QQQ", "SCHD", "BND"]) {
      expect(m.direct.has(fund)).toBe(false);
      expect(m.viaFunds.has(fund)).toBe(false);
    }
  });

  it("caps fund stocks at 25 by fund exposure, excluding direct stocks, and normalizes BRK.B", () => {
    const m = buildPortfolioMap(data());
    expect(m.viaFunds.size).toBe(25);
    expect(m.viaFunds.has("AAPL")).toBe(false);
    expect([...m.viaFunds.keys()].slice(0, 3)).toEqual(["NVDA", "AMZN", "GOOGL"]);
    expect(m.viaFunds.has("JNJ")).toBe(false);
    const small = buildPortfolioMap(data(), 40);
    expect(small.viaFunds.has("BRK-B")).toBe(true);
    expect(small.viaFunds.has("BRK.B")).toBe(false);
    expect(small.viaFunds.get("NVDA")!.map((f) => f.fund).sort()).toEqual(["FXAIX", "QQQ", "VTI"]);
  });

  it("does not treat a holding as a fund or stock without a coverage item", () => {
    const d = data();
    d.holdings.push({ ticker: "ZZZZ" });
    const m = buildPortfolioMap(d);
    expect(m.direct.has("ZZZZ")).toBe(false);
    expect(m.noCoverage).toEqual(["ZZZZ"]);
    expect(buildPortfolioMap(data()).noCoverage).toEqual([]);
  });
});
