import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { rejectUnlessLoopback } from "@/lib/loopback";
import { POST as add } from "@/app/api/watchlist/add/route";
import { POST as remove } from "@/app/api/watchlist/remove/route";
import { POST as refresh } from "@/app/api/watchlist/refresh/route";
import { startFakeFolio, type FakeFolio } from "./fake-folioprism";

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:8500${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:8500", origin: "http://127.0.0.1:8500", ...headers },
    body: new URLSearchParams(fields),
  });
const msg = (r: Response) => new URL(r.headers.get("location")!, "http://x").searchParams.get("msg");

describe("loopback guard", () => {
  it.each([
    [{ host: "127.0.0.1:8500" }, true],
    [{ host: "localhost:8500", origin: "http://localhost:8500" }, true],
    [{ host: "[::1]:8500" }, true],
    [{ host: "example.com" }, false],
    [{ host: "192.168.1.5:8500" }, false],
    [{ host: "127.0.0.1:8500", origin: "https://evil.example" }, false],
    [{}, false],
  ])("%j -> allowed %s", (headers, allowed) => {
    const r = rejectUnlessLoopback(new Request("http://x/", { method: "POST", headers }));
    expect(r === null).toBe(allowed);
    if (r) expect(r.status).toBe(403);
  });
});

describe("watchlist routes", () => {
  let fake: FakeFolio;
  const db = () => getDb(":memory:");

  beforeAll(async () => {
    fake = await startFakeFolio();
    process.env.DB_PATH = ":memory:";
    process.env.FOLIOPRISM_URL = fake.url;
    db().prepare("INSERT INTO ticker_map VALUES ('0009000001', 'ACMR', 'Acme Robotics', ?)").run(new Date().toISOString());
  });
  afterAll(async () => {
    delete process.env.FOLIOPRISM_URL;
    await fake.close();
  });

  it("answers a non-loopback POST with 403 and changes nothing", async () => {
    const r = await add(post("/api/watchlist/add", { tickers: "ACMR" }, { host: "example.com" }));
    expect(r.status).toBe(403);
    expect(db().prepare("SELECT count(*) FROM company").pluck().get()).toBe(0);
  });

  it("adds and removes a manual ticker, then redirects with a message", async () => {
    const a = await add(post("/api/watchlist/add", { tickers: "acmr, nope" }));
    expect(a.status).toBe(303);
    expect(msg(a)).toBe("Added ACMR. Unknown ticker: NOPE.");
    expect(db().prepare("SELECT in_manual FROM company WHERE ticker = 'ACMR'").pluck().get()).toBe(1);
    const r = await remove(post("/api/watchlist/remove", { tickers: "ACMR" }));
    expect(msg(r)).toBe("Removed ACMR.");
    expect(db().prepare("SELECT active FROM company WHERE ticker = 'ACMR'").pluck().get()).toBe(0);
  });

  it("refreshes from FolioPrism with GET requests only", async () => {
    const r = await refresh(post("/api/watchlist/refresh", {}));
    expect(msg(r)).toBe("Refreshed from FolioPrism: 2 direct, 25 through funds.");
    expect(db().prepare("SELECT count(*) FROM company WHERE in_direct = 1 OR in_funds = 1").pluck().get()).toBe(0);
    expect(fake.requests.every((q) => q.startsWith("GET "))).toBe(true);
  });
});
