import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { PushoverClient } from "@/lib/notify/pushover";
import { deliverOnce, senderFor } from "@/lib/notify/runtime";
import { seedDefaults } from "@/lib/signals/rules";
import { input } from "../signals/helpers";
import { FakePushover } from "./fake-pushover";

const fake = new FakePushover();
beforeAll(() => fake.start());
afterAll(() => fake.stop());
afterEach(() => vi.restoreAllMocks());

const creds = () => ({ PUSHOVER_APP_TOKEN: "tok-SECRET", PUSHOVER_USER_KEY: "usr-SECRET", PUSHOVER_URL: fake.url });
const live = { DATA_MODE: "live", SEC_USER_AGENT: "SignalPrismTest test@example.invalid" };

describe("senderFor", () => {
  it("is null in mock mode even when credentials are set, so the sample stack never reaches Pushover", () => {
    expect(senderFor(loadConfig({ ...creds() }))).toBeNull();
  });

  it("is null in live mode without both credentials, and a client with them", () => {
    expect(senderFor(loadConfig({ ...live }))).toBeNull();
    expect(senderFor(loadConfig({ ...live, PUSHOVER_APP_TOKEN: "t" }))).toBeNull();
    expect(senderFor(loadConfig({ ...live, ...creds() }))).toBeInstanceOf(PushoverClient);
  });
});

/** A CEO buy filed today, so it is not historical. */
function withHeldAlert() {
  const db = openDb(":memory:");
  seedDefaults(db);
  db.prepare("UPDATE notification_config SET pushover_enabled = 1").run();
  ingestFiling(db, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", "0009000001"), { now: new Date("2026-11-06T15:00:00Z") });
  expect(db.prepare("SELECT status FROM notification_log").pluck().all()).toEqual(["held"]);
  return db;
}

describe("deliverOnce", () => {
  it("mock mode: logs the would-be message, marks the row logged and makes no request", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = withHeldAlert();
    const result = await deliverOnce(db, loadConfig({ ...creds() }));
    expect(result).toEqual({ sent: 0, logged: 1, failed: 0 });
    expect(db.prepare("SELECT status FROM notification_log").pluck().all()).toEqual(["logged"]);
    expect(fake.requests).toHaveLength(0);
    expect(out.mock.calls.flat().join("\n")).toMatch(/^\[notify\] would send: ACMR · CEO buy/);
  });

  it("live mode without credentials logs counts only, never the message", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = withHeldAlert();
    await deliverOnce(db, loadConfig({ ...live }));
    expect(db.prepare("SELECT status FROM notification_log").pluck().all()).toEqual(["logged"]);
    expect(out).not.toHaveBeenCalled();
  });

  it("live mode with credentials sends through the client", async () => {
    const db = withHeldAlert();
    expect(await deliverOnce(db, loadConfig({ ...live, ...creds() }))).toEqual({ sent: 1, logged: 0, failed: 0 });
    expect(fake.requests.at(-1)?.form.title).toMatch(/^ACMR · CEO buy/);
  });

  it("two calls at once share one pass", async () => {
    const db = withHeldAlert();
    const config = loadConfig({ ...creds() });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const a = deliverOnce(db, config);
    const b = deliverOnce(db, config);
    expect(b).toBe(a);
    await a;
  });
});
