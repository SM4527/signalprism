import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { Scheduler, nextDelayMs, startScheduler } from "@/lib/scheduler";
import { tickerMapStale } from "@/lib/sec/ticker-map";
import { upsertCompany } from "@/lib/store/companies";
import { FakeSec, NOW_ISO, testClient } from "./fake-sec";

const fake = new FakeSec();
beforeAll(() => fake.start());
afterAll(() => fake.stop());

function make(db = openDb(":memory:"), owner = "a", now = () => new Date(NOW_ISO)) {
  fake.requests = [];
  const logs: string[] = [];
  const s = new Scheduler({ db, client: testClient().client, urls: fake.urls, owner, now, log: (m) => logs.push(m) });
  return { db, s, logs };
}

describe("nextDelayMs", () => {
  it.each([
    ["2026-11-25T15:00:00Z", 30],
    ["2026-11-25T11:00:00Z", 30],
    ["2026-11-25T10:59:00Z", 1],
    ["2026-11-25T09:30:00Z", 90],
    ["2026-11-30T09:30:00Z", 90],
    ["2026-11-29T09:30:00Z", 180],
    ["2026-11-26T03:30:00Z", 30],
    ["2026-11-26T03:31:00Z", 180],
    ["2026-11-28T15:00:00Z", 180],
    ["2026-11-29T15:00:00Z", 180],
  ])("%s -> %i minutes", (at, minutes) => {
    expect(nextDelayMs(new Date(at))).toBe(minutes * 60_000);
  });
});

describe("lock row", () => {
  it("lets one scheduler own it, and a stale heartbeat be taken over", () => {
    const db = openDb(":memory:");
    const a = make(db, "a").s;
    const b = make(db, "b").s;
    expect(a.claim()).toBe(true);
    expect(b.claim()).toBe(false);
    expect(a.claim()).toBe(true);
    const later = make(db, "c", () => new Date("2026-11-26T15:03:00Z")).s;
    expect(later.claim()).toBe(true);
    expect(a.claim()).toBe(false);
  });

  it("a scheduler that does not own the lock does not poll", async () => {
    const db = openDb(":memory:");
    make(db, "a").s.claim();
    const { s } = make(db, "b");
    expect(await s.tick()).toBe("not_owner");
    expect(fake.requests).toHaveLength(0);
  });
});

describe("tick", () => {
  it("loads the ticker map once, polls, and skips an overlapping tick with a log line", async () => {
    const { db, s, logs } = make();
    upsertCompany(db, { cik: "0009000001", ticker: "ACMR", name: null, source: "in_manual" }, "2026-11-01");

    const first = s.tick();
    expect(await s.tick()).toBe("skipped_running");
    expect(logs.some((l) => l.includes("skipped"))).toBe(true);
    expect(await first).toBe("ran");

    expect(db.prepare("SELECT count(*) FROM ticker_map").pluck().get()).toBe(3);
    expect(await s.tick()).toBe("ran");
    expect(fake.paths("company_tickers")).toHaveLength(1);
    expect(db.prepare("SELECT count(*) FROM poll_run").pluck().get()).toBe(2);
  });

  it("treats a ticker map older than a week as stale", () => {
    const db = openDb(":memory:");
    expect(tickerMapStale(db, new Date(NOW_ISO))).toBe(true);
    db.prepare("INSERT INTO ticker_map VALUES ('1', 'X', 'x', '2026-11-18T14:00:00Z')").run();
    expect(tickerMapStale(db, new Date(NOW_ISO))).toBe(true);
    db.prepare("UPDATE ticker_map SET updated_at = '2026-11-20T14:00:00Z'").run();
    expect(tickerMapStale(db, new Date(NOW_ISO))).toBe(false);
  });
});

describe("startScheduler", () => {
  const env = { SEC_USER_AGENT: "T t@example.invalid", SEC_DATA_URL: "", SEC_ARCHIVES_URL: "" };

  it("does nothing in mock mode", () => {
    expect(startScheduler(openDb(":memory:"), loadConfig({ DATA_MODE: "mock" }))).toBeUndefined();
  });

  it("starts once in live mode", () => {
    const config = loadConfig({ ...env, DATA_MODE: "live", SEC_DATA_URL: fake.url, SEC_ARCHIVES_URL: fake.url });
    const db = openDb(":memory:");
    const first = startScheduler(db, config);
    expect(first).toBeDefined();
    expect(startScheduler(db, config)).toBe(first);
    first!.stop();
  });
});
