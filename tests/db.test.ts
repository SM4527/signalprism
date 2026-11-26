import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { loadConfig } from "@/lib/config";

describe("db", () => {
  it("applies migrations on a fresh database and is idempotent", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all();
    expect(tables).toEqual(expect.arrayContaining(["company", "signal", "notification_log"]));
    expect(db.prepare("SELECT count(*) FROM scheduler_lock").pluck().get()).toBe(1);
  });

  it("sets busy_timeout", () => {
    const db = openDb(":memory:");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });
});

describe("config", () => {
  it("starts in mock mode without SEC_USER_AGENT", () => {
    expect(loadConfig({}).DATA_MODE).toBe("mock");
  });

  it("refuses live mode without SEC_USER_AGENT", () => {
    expect(() => loadConfig({ DATA_MODE: "live" })).toThrow();
    expect(loadConfig({ DATA_MODE: "live", SEC_USER_AGENT: "x" }).DATA_MODE).toBe("live");
  });
});
