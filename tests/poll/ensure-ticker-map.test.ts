import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { ensureTickerMap } from "@/lib/watchlist/ensure-ticker-map";
import { FakeSec, NOW_ISO } from "./fake-sec";

const fake = new FakeSec();
beforeAll(() => fake.start());
afterAll(() => fake.stop());
const NOW = new Date(NOW_ISO);
const count = (db: ReturnType<typeof openDb>) => db.prepare("SELECT count(*) FROM ticker_map").pluck().get();

describe("ensureTickerMap", () => {
  it("mock mode loads the sample fixture without any request", async () => {
    fake.requests = [];
    const db = openDb(":memory:");
    expect(await ensureTickerMap(db, loadConfig({ SEC_ARCHIVES_URL: fake.url }), NOW)).toBe(true);
    expect(count(db)).toBe(26);
    expect(db.prepare("SELECT cik FROM ticker_map WHERE ticker = 'ACMR'").pluck().get()).toBe("0009000001");
    expect(fake.requests).toHaveLength(0);
    expect(await ensureTickerMap(db, loadConfig({}), NOW)).toBe(false);
  });

  it("live mode makes one request with the User-Agent, only when empty or older than 7 days", async () => {
    fake.requests = [];
    const config = loadConfig({ DATA_MODE: "live", SEC_USER_AGENT: "T t@example.invalid", SEC_ARCHIVES_URL: fake.url });
    const db = openDb(":memory:");
    expect(await ensureTickerMap(db, config, NOW)).toBe(true);
    expect(count(db)).toBe(3);
    expect(fake.requests).toEqual([{ path: "/files/company_tickers.json", userAgent: "T t@example.invalid" }]);

    expect(await ensureTickerMap(db, config, new Date("2026-11-30T15:00:00Z"))).toBe(false);
    expect(fake.requests).toHaveLength(1);

    expect(await ensureTickerMap(db, config, new Date("2026-12-04T15:00:01Z"))).toBe(true);
    expect(fake.requests).toHaveLength(2);
  });
});
