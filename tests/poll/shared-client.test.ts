import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as add } from "@/app/api/watchlist/add/route";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { pollAll } from "@/lib/poll/poll-all";
import { getSecClient } from "@/lib/sec/shared-client";
import { FakeSec } from "./fake-sec";

const fake = new FakeSec();
const UA = "SignalPrismTest test@example.invalid";

beforeAll(async () => {
  await fake.start();
  Object.assign(process.env, {
    DATA_MODE: "live", SEC_USER_AGENT: UA, DB_PATH: ":memory:", SEC_DATA_URL: fake.url, SEC_ARCHIVES_URL: fake.url,
  });
});
afterAll(async () => {
  for (const k of ["DATA_MODE", "SEC_USER_AGENT", "DB_PATH", "SEC_DATA_URL", "SEC_ARCHIVES_URL"]) delete process.env[k];
  await fake.stop();
});

/** The most requests that arrived within any `windowMs`. */
function busiest(times: number[], windowMs: number): number {
  return Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + windowMs).length));
}

describe("one SEC client per process", () => {
  it("returns the same instance every time", () => {
    const config = loadConfig();
    expect(getSecClient(config)).toBe(getSecClient(config));
  });

  it("keeps the add route's ticker-map refresh and a concurrent poll under 8 req/s together", async () => {
    const config = loadConfig();
    const db = getDb(config.DB_PATH);
    const insert = db.prepare("INSERT INTO company (cik, ticker, name, in_manual, added_at) VALUES (?, ?, 'x', 1, '2026-11-26')");
    for (let i = 0; i < 20; i++) insert.run(String(9100000 + i).padStart(10, "0"), `T${i}`);

    const client = getSecClient(config);
    const before = client.requests;
    const urls = { dataUrl: fake.url, archivesUrl: fake.url };
    const body = new URLSearchParams({ tickers: "ACMR" });
    const request = new Request("http://127.0.0.1:8500/api/watchlist/add", {
      method: "POST", headers: { host: "127.0.0.1:8500", origin: "http://127.0.0.1:8500" }, body,
    });
    const [, response] = await Promise.all([pollAll(db, client, urls, new Date()), add(request)]);

    expect(response.status).toBe(303);
    expect(fake.paths("/files/company_tickers.json")).toHaveLength(1);
    expect(fake.paths("/submissions/").length).toBeGreaterThanOrEqual(20);
    expect(client.requests - before).toBe(fake.requests.length);
    // A second limiter would put 9 or more requests within a few ms. A 600 ms window leaves room for the
    // arrival jitter of a loaded machine (the limiter itself allows 8 in any 1000 ms, so 8 in 600 ms is implied).
    expect(busiest(fake.arrivals, 600)).toBeLessThanOrEqual(8);
  });
});
