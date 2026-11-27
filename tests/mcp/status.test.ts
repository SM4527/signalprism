import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/mcp/status/route";
import { StatusResponse } from "@/lib/mcp/schemas";
import { req, seedRouteDb } from "./helpers";

beforeAll(() => void seedRouteDb());

describe("GET /api/mcp/status", () => {
  it("reports the sample stack, the watch list size and as_of", async () => {
    const r = await GET(req("/api/mcp/status"));
    expect(r.status).toBe(200);
    const s = StatusResponse.parse(await r.json());
    expect(s.stack).toBe("sample");
    expect(s.companies_watched).toBeGreaterThan(0);
    expect(s.last_poll).toBeNull();
    expect(s.paused_until).toBeNull();
    expect(s.as_of).toMatch(/ ET$/);
  });

  it("rejects any query parameter with 400", async () => {
    expect((await GET(req("/api/mcp/status?x=1"))).status).toBe(400);
  });
});
