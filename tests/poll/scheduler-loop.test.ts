import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db";
import { Scheduler, installSignalHandlers } from "@/lib/scheduler";
import { SecClient } from "@/lib/sec/client";

const MIN = 60_000;
/** 21:00 Eastern on a Thursday. */
const START = "2026-11-27T02:00:00Z";

beforeEach(() => vi.useFakeTimers({ now: new Date(START) }));
afterEach(() => vi.useRealTimers());

/** An empty watch list, so a poll makes no network request; the ticker map is fresh. */
function make(owner = "a") {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO ticker_map VALUES ('1', 'X', 'x', '2099-01-01T00:00:00Z')").run();
  const logs: string[] = [];
  const client = new SecClient({ userAgent: "SignalPrismTest test@example.invalid" });
  const urls = { dataUrl: "http://127.0.0.1:1", archivesUrl: "http://127.0.0.1:1" };
  const s = new Scheduler({ db, client, urls, owner, log: (m) => logs.push(m) });
  const runs = () => db.prepare("SELECT count(*) FROM poll_run").pluck().get() as number;
  return { db, s, logs, runs };
}

describe("restart", () => {
  it("claims after a foreign heartbeat goes stale, then polls", async () => {
    const { db, s, logs, runs } = make("new");
    db.prepare("UPDATE scheduler_lock SET owner = 'old', heartbeat_at = ? WHERE id = 1").run(new Date().toISOString());
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs()).toBe(0);
    expect(logs.some((l) => l.includes("waiting for lock"))).toBe(true);

    await vi.advanceTimersByTimeAsync(2.5 * MIN);
    expect(runs()).toBe(1);
    expect(logs.some((l) => l.includes("lock claimed"))).toBe(true);
    s.stop();
  });

  it("releases the lock on SIGTERM and SIGINT so a restart claims at once", async () => {
    const { db, s, runs } = make("old");
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.prepare("SELECT owner FROM scheduler_lock").pluck().get()).toBe("old");

    const proc = Object.assign(new EventEmitter(), { pid: 1, kill: vi.fn() });
    installSignalHandlers(s, proc);
    proc.emit("SIGTERM");
    expect(db.prepare("SELECT owner FROM scheduler_lock").pluck().get()).toBeNull();
    expect(proc.kill).toHaveBeenCalledWith(1, "SIGTERM");

    const next = new Scheduler({
      db, client: new SecClient({ userAgent: "SignalPrismTest test@example.invalid" }),
      urls: { dataUrl: "", archivesUrl: "" }, owner: "new", log: () => {},
    });
    expect(next.claim()).toBe(true);
    expect(runs()).toBe(1);
    next.stop();
  });
});

describe("poll request", () => {
  it("the holder polls on its next heartbeat after poll:now sets the flag, once", async () => {
    const { db, s, runs } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs()).toBe(1);
    db.prepare("UPDATE scheduler_lock SET poll_requested_at = ? WHERE id = 1").run(new Date().toISOString());
    await vi.advanceTimersByTimeAsync(31_000);
    expect(runs()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs()).toBe(2);
    s.stop();
  });
});

describe("cadence", () => {
  it("fires three consecutive ticks and switches to 3 h after 22:30 ET", async () => {
    vi.setSystemTime(new Date("2026-11-27T03:00:00Z")); // 22:00 ET
    const { s, logs, runs } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs()).toBe(1);
    await vi.advanceTimersByTimeAsync(30 * MIN); // 22:30, still the 30 minute window
    expect(runs()).toBe(2);
    await vi.advanceTimersByTimeAsync(30 * MIN); // 23:00
    expect(runs()).toBe(3);
    await vi.advanceTimersByTimeAsync(179 * MIN);
    expect(runs()).toBe(3);
    await vi.advanceTimersByTimeAsync(1 * MIN); // 02:00, 3 h later
    expect(runs()).toBe(4);
    expect(logs.filter((l) => l.includes("next tick"))).toHaveLength(4);
    s.stop();
  });

  it("an empty watch list does not end the chain", async () => {
    const { s, runs } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(runs()).toBe(2);
    s.stop();
  });

  it("a tick that throws still schedules the next one", async () => {
    const { s, logs, runs } = make();
    vi.spyOn(s, "tick").mockRejectedValueOnce(new Error("boom"));
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logs.some((l) => l.includes("tick failed"))).toBe(true);
    vi.mocked(s.tick).mockRestore();
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(runs()).toBe(1);
    s.stop();
  });

  it("a claim that throws (database trouble) still schedules the next tick", async () => {
    const { db, s, runs } = make();
    const real = s.claim.bind(s);
    vi.spyOn(s, "claim").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY");
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs()).toBe(0);
    vi.spyOn(s, "claim").mockImplementation(real);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(db.prepare("SELECT count(*) FROM poll_run").pluck().get()).toBe(1);
    s.stop();
  });
});
