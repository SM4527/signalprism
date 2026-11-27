import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as saveNotifications } from "@/app/api/notifications/save/route";
import { POST as testPush } from "@/app/api/push/test/route";
import { POST as saveRule } from "@/app/api/rules/save/route";
import { getDb } from "@/lib/db";
import { loadNotificationConfig } from "@/lib/queries/rules";
import { evaluateRule, loadRules, seedDefaults } from "@/lib/signals/rules";
import { FakePushover } from "./fake-pushover";

const fake = new FakePushover();
beforeAll(async () => {
  await fake.start();
  process.env.DB_PATH = ":memory:";
  seedDefaults(getDb(":memory:"));
});
afterAll(async () => {
  for (const k of ["DB_PATH", "DATA_MODE", "SEC_USER_AGENT", "PUSHOVER_APP_TOKEN", "PUSHOVER_USER_KEY", "PUSHOVER_URL"]) delete process.env[k];
  await fake.stop();
});
beforeEach(() => fake.reset());

const db = () => getDb(":memory:");
const post = (path: string, fields: [string, string][] = [], headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:8500${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:8500", origin: "http://127.0.0.1:8500", ...headers },
    body: new URLSearchParams(fields),
  });
const msg = (r: Response) => new URL(r.headers.get("location")!, "http://x").searchParams.get("msg");
const where = (r: Response) => new URL(r.headers.get("location")!, "http://x").pathname;

const ruleForm = (over: Record<string, string> = {}, roles = ["CEO", "CFO"]): [string, string][] => {
  const base: Record<string, string> = {
    id: "1", minValue: "100000", minPct: "10", directorMinValue: "250000", pushOnCluster: "on", enabled: "on", ...over,
  };
  return [...Object.entries(base).filter(([, v]) => v !== "off"), ...roles.map((r): [string, string] => ["roles", r])];
};

describe("loopback guard", () => {
  it.each(["/api/rules/save", "/api/notifications/save", "/api/push/test"])("%s refuses a non-loopback POST", async (path) => {
    const handler = { "/api/rules/save": saveRule, "/api/notifications/save": saveNotifications, "/api/push/test": testPush }[path]!;
    const r = await handler(post(path, ruleForm(), { host: "example.com" }));
    expect(r.status).toBe(403);
    const evil = await handler(post(path, ruleForm(), { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
  });
});

describe("save rule", () => {
  it("stores the edited rule, keeps money as text, and changes what matches", async () => {
    const r = await saveRule(post("/api/rules/save", ruleForm({ minValue: "250000.50", minPct: "25", includeDirectors: "on", directorMinValue: "500000" }, ["CEO"])));
    expect(r.status).toBe(303);
    expect(where(r)).toBe("/rules");
    expect(msg(r)).toBe("Rule saved. It applies to signals ingested from now on.");
    const rule = loadRules(db())[0];
    expect(rule).toMatchObject({ roles: ["CEO"], minValue: "250000.5", minPct: "25", includeDirectors: true, directorMinValue: "500000", pushOnCluster: true, enabled: true });
    const buy = { role: "CFO" as const, value: "9000000", pctIncrease: "50", newPosition: false, late: false, nonCommon: false, planKind: null };
    expect(evaluateRule(buy, rule).matches).toBe(false); // CFO is no longer in the rule
    expect(evaluateRule({ ...buy, role: "CEO" }, rule).matches).toBe(true);
  });

  it.each([
    [{ minValue: "lots" }, ["CEO"], "minValue: must be a number, 0 or more"],
    [{ minValue: "-5" }, ["CEO"], "minValue: must be a number, 0 or more"],
    [{ minPct: "5000" }, ["CEO"], "minPct: must be at most 1000"],
    [{}, [], "roles: pick at least one role"],
    [{ id: "99" }, ["CEO"], "id: no such rule"],
  ])("rejects %j with roles %j and saves nothing", async (over, roles, message) => {
    const before = JSON.stringify(loadRules(db()));
    const r = await saveRule(post("/api/rules/save", ruleForm(over, roles)));
    expect(msg(r)).toBe(`Not saved: ${message}`);
    expect(JSON.stringify(loadRules(db()))).toBe(before);
  });
});

describe("save notification settings", () => {
  const form = (over: Record<string, string> = {}): [string, string][] =>
    Object.entries({ portfolioHint: "flag", quietStart: "22:00", quietEnd: "07:00", digestTime: "08:30", dailyCap: "7", pushoverEnabled: "on", ...over });

  it("stores quiet hours, digest time, cap, hint and the Pushover switch", async () => {
    const r = await saveNotifications(post("/api/notifications/save", form({ digest: "on" })));
    expect(msg(r)).toBe("Notification settings saved.");
    expect(loadNotificationConfig(db())).toMatchObject({
      pushoverEnabled: true, portfolioHint: "flag", quietStart: "22:00", quietEnd: "07:00", digest: true, digestTime: "08:30", dailyCap: 7,
    });
  });

  it("empty quiet hours mean none", async () => {
    await saveNotifications(post("/api/notifications/save", form({ quietStart: "", quietEnd: "" })));
    expect(loadNotificationConfig(db())).toMatchObject({ quietStart: null, quietEnd: null });
  });

  it.each([
    [{ quietEnd: "" }, "quietStart: set both quiet hours times, or neither"],
    [{ quietStart: "25:00" }, "quietStart: must be HH:MM, for example 22:00"],
    [{ digestTime: "8am" }, "digestTime: must be HH:MM, for example 22:00"],
    [{ dailyCap: "0" }, "dailyCap: must be at least 1"],
    [{ dailyCap: "500" }, "dailyCap: must be at most 100"],
    [{ portfolioHint: "everything" }, "portfolioHint: Invalid option: expected one of \"off\"|\"flag\"|\"detail\""],
  ])("rejects %j", async (over, message) => {
    const before = JSON.stringify(loadNotificationConfig(db()));
    const r = await saveNotifications(post("/api/notifications/save", form(over)));
    expect(msg(r)).toBe(`Not saved: ${message}`);
    expect(JSON.stringify(loadNotificationConfig(db()))).toBe(before);
  });
});

describe("send test push", () => {
  const testRows = () => db().prepare("SELECT status, payload_json, error FROM notification_log WHERE kind = 'test' ORDER BY id").all() as { status: string; payload_json: string; error: string | null }[];

  it("on the sample stack (mock mode) only records the would-be message and makes no request", async () => {
    const r = await testPush(post("/api/push/test"));
    expect(msg(r)).toMatch(/^Test push logged only/);
    expect(fake.requests).toHaveLength(0);
    expect(testRows().at(-1)).toMatchObject({ status: "logged" });
  });

  it("in live mode with credentials sends one real message and stores the usage, never the credentials", async () => {
    Object.assign(process.env, {
      DATA_MODE: "live", SEC_USER_AGENT: "SignalPrismTest test@example.invalid", PUSHOVER_APP_TOKEN: "tok-SECRET-1", PUSHOVER_USER_KEY: "usr-SECRET-2", PUSHOVER_URL: fake.url,
    });
    const r = await testPush(post("/api/push/test"));
    expect(msg(r)).toBe("Test push sent.");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].form).toMatchObject({ token: "tok-SECRET-1", user: "usr-SECRET-2", title: "SignalPrism test push", priority: "0" });
    expect(testRows().at(-1)?.status).toBe("sent");
    expect(loadNotificationConfig(db())!.usage).toMatchObject({ limit: 10000, remaining: 9990 });
    expect(JSON.stringify([testRows(), loadNotificationConfig(db())])).not.toContain("SECRET");
  });

  it("reports a rejected test push", async () => {
    fake.plan = [{ status: 400 }];
    const r = await testPush(post("/api/push/test"));
    expect(msg(r)).toBe("Test push failed (HTTP 400).");
    expect(testRows().at(-1)).toMatchObject({ status: "failed", error: "HTTP 400" });
  });
});
