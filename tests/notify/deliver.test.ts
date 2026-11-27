import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { deliverPending, releaseSending, type DeliverDeps } from "@/lib/notify/deliver";
import { LIMITS } from "@/lib/notify/format";
import { PushoverClient } from "@/lib/notify/pushover";
import { loadNotificationConfig } from "@/lib/queries/rules";
import { seedDefaults } from "@/lib/signals/rules";
import { FakePushover } from "./fake-pushover";

const fake = new FakePushover();
beforeAll(() => fake.start());
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const TOKEN = "tok-SECRET-1234567890";
const USER = "usr-SECRET-0987654321";
const client = () => new PushoverClient({ token: TOKEN, user: USER, baseUrl: fake.url });

/** 2026-11-26 is Thanksgiving; times below are UTC (ET is UTC-5 in November). */
const at = (iso: string) => () => new Date(iso);
const NOON_ET = "2026-11-27T17:00:00Z"; // 12:00 ET, Friday

function setup(config: Record<string, string | number | null> = {}) {
  const db = openDb(":memory:");
  seedDefaults(db);
  db.prepare("UPDATE notification_config SET pushover_enabled = 1").run();
  for (const [k, v] of Object.entries(config)) db.prepare(`UPDATE notification_config SET ${k} = ? WHERE id = 1`).run(v);
  return db;
}
type Db = ReturnType<typeof setup>;

let seq = 0;
function hold(db: Db, o: { title?: string; priority?: 0 | 1; kind?: string; createdAt?: string } = {}): number {
  const title = o.title ?? `T${++seq} · CEO buy · $1M`;
  const payload = { title, body: "body", url: "https://www.sec.gov/x", priority: o.priority ?? 0 };
  return db
    .prepare(
      `INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at)
       VALUES (?, ?, 'held', ?, ?, ?)`,
    )
    .run(o.kind ?? "signal", `k${++seq}`, o.priority ?? 0, JSON.stringify(payload), o.createdAt ?? NOON_ET).lastInsertRowid as number;
}
const status = (db: Db) => db.prepare("SELECT id, status, digest, attempts, error FROM notification_log ORDER BY id").all() as { id: number; status: string; digest: number; attempts: number; error: string | null }[];
const run = (db: Db, now: string, extra: Partial<DeliverDeps> = {}) => deliverPending({ db, now: at(now), sender: client(), ...extra });

describe("sending", () => {
  it("posts the message fields to Pushover, marks the row sent and stores the usage headers", async () => {
    const db = setup();
    hold(db, { title: "ACMR · CEO buy · $1M", priority: 1 });
    expect(await run(db, NOON_ET)).toEqual({ sent: 1, logged: 0, failed: 0 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: "POST", path: "/1/messages.json",
      form: { token: TOKEN, user: USER, title: "ACMR · CEO buy · $1M", message: "body", url: "https://www.sec.gov/x", priority: "1" },
    });
    expect(status(db)[0]).toMatchObject({ status: "sent", attempts: 1, error: null });
    expect(db.prepare("SELECT sent_at FROM notification_log").pluck().get()).toBe(new Date(NOON_ET).toISOString());
    expect(loadNotificationConfig(db)!.usage).toEqual({
      limit: 10000, remaining: 9990, resetAt: "2026-12-01T00:00:00.000Z", seenAt: new Date(NOON_ET).toISOString(),
    });
  });

  it("never lets the token or user key into the database, results or errors", async () => {
    const db = setup();
    hold(db);
    hold(db);
    fake.plan = [{ status: 400 }, { status: 503 }];
    const result = await run(db, NOON_ET);
    const everything = JSON.stringify([result, db.prepare("SELECT * FROM notification_log").all(), db.prepare("SELECT * FROM notification_config").all()]);
    expect(everything).not.toContain("SECRET");
  });

  it("clamps oversized fields at the client and only ever sends priority 0 or 1", async () => {
    const db = setup();
    const payload = { title: "t".repeat(400), body: "b".repeat(2000), url: `https://x.invalid/${"u".repeat(900)}`, priority: 1 };
    db.prepare("INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at) VALUES ('signal', 'big', 'held', 1, ?, ?)").run(JSON.stringify(payload), NOON_ET);
    await run(db, NOON_ET);
    const f = fake.requests[0].form;
    expect(f.title.length).toBe(LIMITS.title);
    expect(f.message.length).toBe(LIMITS.message);
    expect(f.url.length).toBe(LIMITS.url);
    expect(["0", "1"]).toContain(f.priority);
    expect(() =>
      db.prepare("INSERT INTO notification_log (kind, dedup_key, status, priority, payload_json, created_at) VALUES ('signal', 'p2', 'held', 2, '{}', ?)").run(NOON_ET),
    ).toThrow();
  });

  it("without a sender, or with Pushover switched off, only logs: no request, status logged", async () => {
    const db = setup();
    const logs: string[] = [];
    hold(db, { title: "ACMR · CEO buy · $1M" });
    expect(await deliverPending({ db, now: at(NOON_ET), sender: null, logContent: (m) => logs.push(m) })).toEqual({ sent: 0, logged: 1, failed: 0 });
    expect(logs).toEqual(["would send: ACMR · CEO buy · $1M | body"]);
    expect(status(db)[0].status).toBe("logged");

    const off = setup();
    off.prepare("UPDATE notification_config SET pushover_enabled = 0").run();
    hold(off);
    await run(off, NOON_ET);
    expect(status(off)[0].status).toBe("logged");
    expect(fake.requests).toHaveLength(0);
  });
});

describe("quiet hours (ET)", () => {
  it("hold everything inside the window, even across midnight, and release high priority first", async () => {
    const db = setup({ quiet_start: "22:00", quiet_end: "07:00" });
    hold(db, { title: "low", priority: 0 });
    hold(db, { title: "high", priority: 1 });
    expect(await run(db, "2026-11-27T04:00:00Z")).toEqual({ sent: 0, logged: 0, failed: 0 }); // 23:00 ET
    expect(await run(db, "2026-11-27T11:59:00Z")).toEqual({ sent: 0, logged: 0, failed: 0 }); // 06:59 ET
    expect(fake.requests).toHaveLength(0);
    expect(status(db).map((r) => r.status)).toEqual(["held", "held"]);

    expect(await run(db, "2026-11-27T12:00:00Z")).toEqual({ sent: 2, logged: 0, failed: 0 }); // 07:00 ET
    expect(fake.titles()).toEqual(["high", "low"]);
  });

  it("a same-day window works too, and no window means never quiet", async () => {
    const day = setup({ quiet_start: "09:00", quiet_end: "17:00" });
    hold(day);
    expect((await run(day, NOON_ET)).sent).toBe(0);
    expect((await run(day, "2026-11-27T22:00:00Z")).sent).toBe(1); // 17:00 ET
    const none = setup();
    hold(none);
    expect((await run(none, "2026-11-27T05:00:00Z")).sent).toBe(1);
  });
});

describe("daily cap and digest", () => {
  it("sends up to the cap, then holds the rest for the summary after the next quiet-hours end", async () => {
    const db = setup({ daily_cap: 2, quiet_start: "22:00", quiet_end: "07:00" });
    for (let i = 0; i < 4; i++) hold(db, { title: `A${i}` });
    expect((await run(db, NOON_ET)).sent).toBe(2);
    expect(status(db).map((r) => `${r.status}${r.digest}`)).toEqual(["sent0", "sent0", "held1", "held1"]);

    // Later the same day: no summary yet (it is due at 07:00 ET the next morning).
    expect((await run(db, "2026-11-28T02:00:00Z")).sent).toBe(0); // 21:00 ET
    expect(fake.requests).toHaveLength(2);

    // Next morning at 07:00 ET: one summary naming the two held alerts.
    expect((await run(db, "2026-11-28T12:00:00Z")).sent).toBe(1);
    expect(fake.requests[2].form.title).toBe("SignalPrism digest · 2 alerts");
    expect(fake.requests[2].form.message).toBe("A2\nA3");
    expect(status(db).map((r) => r.status)).toEqual(["sent", "sent", "sent", "sent", "sent"]);
    expect(db.prepare("SELECT count(*) FROM notification_log WHERE digested_in IS NOT NULL").pluck().get()).toBe(2);
  });

  it("the cap counts individual alerts only and starts over each ET day", async () => {
    const db = setup({ daily_cap: 1 });
    hold(db);
    await run(db, NOON_ET);
    hold(db);
    expect((await run(db, "2026-11-27T20:00:00Z")).sent).toBe(0); // same day: over the cap
    hold(db);
    // Next ET day: the new alert goes out at once (cap reset) plus the summary of yesterday's overflow.
    expect((await run(db, "2026-11-28T17:00:00Z")).sent).toBe(2);
    expect(fake.titles().filter((t) => t.startsWith("SignalPrism digest"))).toHaveLength(1);
  });

  it("with no quiet hours the overflow summary goes out at 08:00 ET", async () => {
    const db = setup({ daily_cap: 1 });
    hold(db, { title: "first" });
    hold(db, { title: "second" });
    await run(db, NOON_ET);
    expect(fake.titles()).toEqual(["first"]);
    expect((await run(db, "2026-11-28T12:59:00Z")).sent).toBe(0); // 07:59 ET
    expect((await run(db, "2026-11-28T13:00:00Z")).sent).toBe(1); // 08:00 ET
    expect(fake.requests[1].form.message).toBe("second");
  });

  it("digest on: only high priority goes at once; the rest wait for the digest time", async () => {
    const db = setup({ digest: 1, digest_time: "09:30" });
    hold(db, { title: "calm", priority: 0 });
    hold(db, { title: "urgent", priority: 1 });
    await run(db, NOON_ET);
    expect(fake.titles()).toEqual(["urgent"]);

    expect((await run(db, "2026-11-28T14:29:00Z")).sent).toBe(0); // 09:29 ET next day
    expect((await run(db, "2026-11-28T14:30:00Z")).sent).toBe(1);
    expect(fake.requests[1].form).toMatchObject({ title: "SignalPrism digest · 1 alert", message: "calm" });
  });

  it("an alert created before the digest time the same morning goes in that morning's digest", async () => {
    const db = setup({ digest: 1, digest_time: "09:30" });
    hold(db, { title: "early", createdAt: "2026-11-27T11:00:00Z" }); // 06:00 ET
    expect((await run(db, "2026-11-27T14:30:00Z")).sent).toBe(1); // 09:30 ET same day
    expect(fake.requests[0].form.message).toBe("early");
  });
});

describe("failures", () => {
  it("a 4xx fails the row at once; a 5xx or dropped connection is retried and fails on the third try", async () => {
    const db = setup();
    const a = hold(db, { title: "bad" });
    fake.plan = [{ status: 400 }];
    expect(await run(db, NOON_ET)).toEqual({ sent: 0, logged: 0, failed: 1 });
    expect(status(db)).toEqual([{ id: a, status: "failed", digest: 0, attempts: 1, error: "HTTP 400" }]);

    fake.reset();
    const b = hold(db, { title: "flaky" });
    fake.plan = [{ status: 503 }, "drop", { status: 500 }];
    await run(db, NOON_ET);
    expect(status(db).find((r) => r.id === b)).toMatchObject({ status: "held", attempts: 1, error: "HTTP 503" });
    await run(db, NOON_ET);
    expect(status(db).find((r) => r.id === b)).toMatchObject({ status: "held", attempts: 2 });
    await run(db, NOON_ET);
    expect(status(db).find((r) => r.id === b)).toMatchObject({ status: "failed", attempts: 3, error: "HTTP 500" });
  });
});

describe("delivery is at-least-once", () => {
  it("held rows survive a restart and are sent by the next process (never lost)", async () => {
    const db = setup();
    hold(db, { title: "kept" });
    fake.plan = ["drop"];
    await run(db, NOON_ET);
    expect(status(db)[0].status).toBe("held");

    // A new process: nothing in memory, only the database.
    expect((await run(db, NOON_ET)).sent).toBe(1);
    expect(fake.titles()).toEqual(["kept", "kept"]);
    expect(status(db)[0].status).toBe("sent");
  });

  it("a crash between the request and the mark leaves the row sending; after a restart it is sent again (a duplicate, never a loss)", async () => {
    const db = setup();
    hold(db, { title: "crashy" });
    class Crash extends Error {}
    await expect(
      run(db, NOON_ET, { afterSend: () => { throw new Crash("process died"); } }),
    ).rejects.toBeInstanceOf(Crash);
    expect(fake.requests).toHaveLength(1);
    expect(status(db)[0]).toMatchObject({ status: "sending", attempts: 1 });

    // Nothing picks up a 'sending' row until the lock holder restarts.
    expect((await run(db, NOON_ET)).sent).toBe(0);
    expect(releaseSending(db)).toBe(1);
    expect((await run(db, NOON_ET)).sent).toBe(1);
    expect(fake.titles()).toEqual(["crashy", "crashy"]);
    expect(status(db)[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("two overlapping runs claim each row once", async () => {
    const db = setup();
    for (let i = 0; i < 3; i++) hold(db, { title: `row${i}` });
    fake.plan = [{ status: 200, delayMs: 30 }, { status: 200, delayMs: 30 }, { status: 200, delayMs: 30 }];
    const [a, b] = await Promise.all([run(db, NOON_ET), run(db, NOON_ET)]);
    expect(a.sent + b.sent).toBe(3);
    expect(fake.requests).toHaveLength(3);
  });

  it("stops when the process no longer holds the scheduler lock", async () => {
    const db = setup();
    hold(db);
    hold(db);
    let calls = 0;
    await run(db, NOON_ET, { canSend: () => ++calls <= 1 });
    expect(fake.requests).toHaveLength(1);
    expect(status(db).map((r) => r.status)).toEqual(["sent", "held"]);
  });
});
