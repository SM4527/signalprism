import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db";
import { Scheduler } from "@/lib/scheduler";
import { SecClient } from "@/lib/sec/client";

/** 21:00 Eastern on a Thursday. */
const START = "2026-11-27T02:00:00Z";

beforeEach(() => vi.useFakeTimers({ now: new Date(START) }));
afterEach(() => vi.useRealTimers());

function make(db = openDb(":memory:"), owner = "a") {
  db.prepare("INSERT OR IGNORE INTO ticker_map VALUES ('1', 'X', 'x', '2099-01-01T00:00:00Z')").run();
  const calls = { deliver: 0, claim: 0 };
  const s = new Scheduler({
    db,
    client: new SecClient({ userAgent: "SignalPrismTest test@example.invalid" }),
    urls: { dataUrl: "http://127.0.0.1:1", archivesUrl: "http://127.0.0.1:1" },
    owner,
    log: () => {},
    deliver: async () => void calls.deliver++,
    onClaim: () => void calls.claim++,
  });
  return { db, s, calls };
}

describe("delivery in the scheduler", () => {
  it("runs after the poll and on every heartbeat, only while holding the lock", async () => {
    const { s, calls } = make();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.claim).toBe(1);
    expect(calls.deliver).toBe(1); // after the first poll
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.deliver).toBe(2); // heartbeat
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.deliver).toBe(3);
    s.stop();
  });

  it("never runs in a process that does not hold the lock", async () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE scheduler_lock SET owner = 'someone-else', heartbeat_at = ? WHERE id = 1").run(new Date().toISOString());
    const { s, calls } = make(db, "b");
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.deliver).toBe(0);
    expect(calls.claim).toBe(0);
    expect(s.holdsLock).toBe(false);
    s.stop();
  });

  it("calls onClaim once per claim, and a failing delivery does not end the chain", async () => {
    const { db } = make();
    const calls = { n: 0, claim: 0 };
    const s = new Scheduler({
      db,
      client: new SecClient({ userAgent: "SignalPrismTest test@example.invalid" }),
      urls: { dataUrl: "http://127.0.0.1:1", archivesUrl: "http://127.0.0.1:1" },
      owner: "c",
      log: () => {},
      deliver: async () => {
        calls.n++;
        throw new Error("boom");
      },
      onClaim: () => void calls.claim++,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(calls.claim).toBe(1);
    expect(calls.n).toBeGreaterThanOrEqual(3);
    s.stop();
  });
});

describe("weekly maintenance in the scheduler", () => {
  it("runs after a poll while holding the lock, logs its line, and survives a failure", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO ticker_map VALUES ('1', 'X', 'x', '2099-01-01T00:00:00Z')").run();
    const logs: string[] = [];
    let n = 0;
    const s = new Scheduler({
      db,
      client: new SecClient({ userAgent: "SignalPrismTest test@example.invalid" }),
      urls: { dataUrl: "http://127.0.0.1:1", archivesUrl: "http://127.0.0.1:1" },
      owner: "m",
      log: (m) => logs.push(m),
      maintain: () => {
        n++;
        if (n === 1) return "retention: 0 poll runs";
        throw new Error("boom");
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(1);
    expect(logs).toContain("retention: 0 poll runs");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(n).toBe(2);
    expect(logs).toContain("maintenance failed: Error");
    s.stop();
  });
});
