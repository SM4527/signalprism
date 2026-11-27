import { beforeAll, describe, expect, it } from "vitest";
import { GET as signals } from "@/app/api/mcp/signals/route";
import { GET } from "@/app/api/mcp/ticker/[symbol]/route";
import { SignalsResponse, TickerResponse } from "@/lib/mcp/schemas";
import { monthsBefore } from "@/lib/signals/dates";
import { req, seedRouteDb } from "./helpers";

const get = async (symbol: string) => {
  const r = await GET(req(`/api/mcp/ticker/${symbol}`), { params: Promise.resolve({ symbol }) });
  return { status: r.status, body: await r.json() };
};

let symbol: string;
beforeAll(async () => {
  seedRouteDb();
  const all = SignalsResponse.parse(await (await signals(req("/api/mcp/signals?days=400"))).json());
  symbol = all.signals.find((s) => s.ticker)!.ticker!;
});

describe("GET /api/mcp/ticker/[symbol]", () => {
  it("returns the last 12 months of one company, any case", async () => {
    const { status, body } = await get(symbol.toLowerCase());
    expect(status).toBe(200);
    const t = TickerResponse.parse(body);
    expect(t.ticker).toBe(symbol);
    expect(t.since).toBe(monthsBefore(t.as_of.slice(0, 10), 12));
    expect(t.signals.length).toBeGreaterThan(0);
    expect(t.signals.every((s) => s.ticker === symbol && s.filed_at >= t.since)).toBe(true);
    expect(t.plan_count).toBe(t.signals.filter((s) => s.badges.some((b) => b.startsWith("plan:"))).length);
  });

  it("answers an unknown ticker with 404 JSON", async () => {
    const { status, body } = await get("NOPE");
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });
});
