import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/mcp/signals/route";
import { getDb } from "@/lib/db";
import { SignalsResponse } from "@/lib/mcp/schemas";
import { req, seedRouteDb } from "./helpers";

const get = async (query = "") => {
  const r = await GET(req(`/api/mcp/signals${query}`));
  return { status: r.status, body: await r.json() };
};

beforeAll(() => void seedRouteDb());

describe("GET /api/mcp/signals", () => {
  it("answers the default window and matches the schema, with as_of and the applied filters", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    const parsed = SignalsResponse.parse(body);
    expect(parsed.as_of).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/);
    expect(parsed.filters).toEqual({ days: 30, min_score: 0, role: null, held_only: false, watched_only: true, include_plan: false });
    expect(parsed.count).toBe(parsed.signals.length);
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("score parts add up to the score", async () => {
    const { signals } = SignalsResponse.parse((await get("?days=400")).body);
    for (const s of signals) expect(s.score_parts.reduce((n, p) => n + p.points, 0)).toBe(s.score);
  });

  it("applies minScore, role and the echoed filters", async () => {
    const all = SignalsResponse.parse((await get("?days=400")).body);
    const top = Math.max(...all.signals.map((s) => s.score));
    const byScore = SignalsResponse.parse((await get(`?days=400&minScore=${top}`)).body);
    expect(byScore.signals.length).toBeGreaterThan(0);
    expect(byScore.signals.every((s) => s.score >= top)).toBe(true);
    expect(byScore.filters.min_score).toBe(top);
    const role = all.signals[0].role;
    const byRole = SignalsResponse.parse((await get(`?days=400&role=${role}`)).body);
    expect(byRole.signals.every((s) => s.role === role)).toBe(true);
    expect(byRole.filters.role).toBe(role);
  });

  it("hides plan buys unless includePlan is set", async () => {
    const plan = (b: unknown) => SignalsResponse.parse(b).signals.filter((s) => s.badges.some((x) => x.startsWith("plan:")));
    expect(plan((await get("?days=400")).body)).toHaveLength(0);
    const withPlan = SignalsResponse.parse((await get("?days=400&includePlan=true")).body);
    expect(withPlan.filters.include_plan).toBe(true);
    expect(withPlan.count).toBeGreaterThanOrEqual(SignalsResponse.parse((await get("?days=400")).body).count);
  });

  it("heldOnly keeps only held signals", async () => {
    const held = SignalsResponse.parse((await get("?days=400&heldOnly=1")).body);
    expect(held.filters.held_only).toBe(true);
    expect(held.signals.every((s) => s.held_via !== null)).toBe(true);
  });

  it("watchedOnly defaults on; signals of a removed company appear only when it is off", async () => {
    const db = getDb(":memory:");
    const cik = db.prepare("SELECT s.issuer_cik FROM signal s JOIN company c ON c.cik = s.issuer_cik WHERE c.active = 1 LIMIT 1").pluck().get() as string;
    const ticker = db.prepare("SELECT ticker FROM company WHERE cik = ?").pluck().get(cik) as string;
    const has = (b: unknown) => SignalsResponse.parse(b).signals.some((s) => s.ticker === ticker);
    db.prepare("UPDATE company SET active = 0 WHERE cik = ?").run(cik);
    try {
      expect(has((await get("?days=400&includePlan=1")).body)).toBe(false);
      const off = SignalsResponse.parse((await get("?days=400&includePlan=1&watchedOnly=0")).body);
      expect(off.filters.watched_only).toBe(false);
      expect(has(off)).toBe(true);
    } finally {
      db.prepare("UPDATE company SET active = 1 WHERE cik = ?").run(cik);
    }
    expect(has((await get("?days=400&includePlan=1")).body)).toBe(true);
  });

  it.each(["days=0", "days=abc", "role=KING", "heldOnly=maybe", "watchedOnly=maybe","bogus=1"])("rejects %s with 400", async (q) => {
    const { status, body } = await get(`?${q}`);
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("returns only schema fields: no ids, CIKs, footnotes or notification data", async () => {
    const { body } = await get("?days=400&includePlan=1");
    const text = JSON.stringify(body);
    for (const key of ["payload_json", "footnotes", "issuer_cik", "notification", "token", "SEC_USER_AGENT"]) {
      expect(text).not.toContain(key);
    }
  });
});
