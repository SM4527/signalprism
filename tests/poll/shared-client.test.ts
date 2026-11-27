import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as add } from "@/app/api/watchlist/add/route";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { pollAll } from "@/lib/poll/poll-all";
import type { SecClient } from "@/lib/sec/client";
import { getSecClient } from "@/lib/sec/shared-client";
import { FakeSec, testClient } from "./fake-sec";

const fake = new FakeSec();
const UA = "SignalPrismTest test@example.invalid";
const g = globalThis as { __signalprismSecClient?: SecClient };

beforeAll(async () => {
  await fake.start();
  Object.assign(process.env, {
    DATA_MODE: "live", SEC_USER_AGENT: UA, DB_PATH: ":memory:", SEC_DATA_URL: fake.url, SEC_ARCHIVES_URL: fake.url,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  g.__signalprismSecClient = undefined;
});
afterAll(async () => {
  for (const k of ["DATA_MODE", "SEC_USER_AGENT", "DB_PATH", "SEC_DATA_URL", "SEC_ARCHIVES_URL"]) delete process.env[k];
  await fake.stop();
});

/** The most requests inside any `windowMs` window. */
function busiest(times: number[], windowMs: number): number {
  return Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + windowMs).length));
}

describe("one SEC client per process", () => {
  it("returns the same instance every time", () => {
    const config = loadConfig();
    expect(getSecClient(config)).toBe(getSecClient(config));
  });

  it("keeps the add route's ticker-map refresh and a concurrent poll under 8 req/s together", async () => {
    // The shared client runs on a fake clock: waits advance it instantly, so the result does not depend on load.
    const { client, clock } = testClient(UA);
    g.__signalprismSecClient = client;
    const config = loadConfig();
    expect(getSecClient(config)).toBe(client);

    const sentAt: number[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((...args) => {
      sentAt.push(clock.t);
      return realFetch(...args);
    });

    const db = getDb(config.DB_PATH);
    const insert = db.prepare("INSERT INTO company (cik, ticker, name, in_manual, added_at) VALUES (?, ?, 'x', 1, '2026-11-26')");
    for (let i = 0; i < 20; i++) insert.run(String(9100000 + i).padStart(10, "0"), `T${i}`);

    const urls = { dataUrl: fake.url, archivesUrl: fake.url };
    const request = new Request("http://127.0.0.1:8500/api/watchlist/add", {
      method: "POST",
      headers: { host: "127.0.0.1:8500", origin: "http://127.0.0.1:8500" },
      body: new URLSearchParams({ tickers: "ACMR" }),
    });
    const [, response] = await Promise.all([pollAll(db, client, urls, new Date()), add(request)]);

    expect(response.status).toBe(303);
    expect(fake.paths("/files/company_tickers.json")).toHaveLength(1);
    expect(fake.paths("/submissions/").length).toBeGreaterThanOrEqual(20);
    expect(client.requests).toBe(fake.requests.length);
    expect(sentAt).toHaveLength(client.requests);
    // A second limiter would send its requests at the same fake instant as the poll's first eight.
    expect(busiest(sentAt, 1000)).toBeLessThanOrEqual(8);
    expect(clock.t - Math.min(...sentAt)).toBeGreaterThanOrEqual(1000);
  });
});
