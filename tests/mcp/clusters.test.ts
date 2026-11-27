import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/mcp/clusters/route";
import { ClustersResponse } from "@/lib/mcp/schemas";
import { req, seedRouteDb } from "./helpers";

const get = async (query = "") => {
  const r = await GET(req(`/api/mcp/clusters${query}`));
  return { status: r.status, body: await r.json() };
};

beforeAll(() => void seedRouteDb());

describe("GET /api/mcp/clusters", () => {
  it("lists clusters with members, as_of and the applied days", async () => {
    const { status, body } = await get("?days=400");
    expect(status).toBe(200);
    const parsed = ClustersResponse.parse(body);
    expect(parsed.filters).toEqual({ days: 400 });
    expect(parsed.as_of).toMatch(/ ET$/);
    expect(parsed.clusters.length).toBeGreaterThan(0);
    for (const c of parsed.clusters) {
      expect(c.insider_count).toBeGreaterThanOrEqual(2);
      expect(new Set(c.members.map((m) => m.insider)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("defaults to 30 days and a shorter window never returns more clusters", async () => {
    const def = ClustersResponse.parse((await get()).body);
    expect(def.filters.days).toBe(30);
    const all = ClustersResponse.parse((await get("?days=400")).body);
    expect(def.clusters.length).toBeLessThanOrEqual(all.clusters.length);
  });

  it("rejects a bad days value with 400", async () => {
    expect((await get("?days=-1")).status).toBe(400);
  });
});
