import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as clusters } from "@/app/api/mcp/clusters/route";
import { GET as signals } from "@/app/api/mcp/signals/route";
import { GET as status } from "@/app/api/mcp/status/route";
import { GET as ticker } from "@/app/api/mcp/ticker/[symbol]/route";
import { req, seedRouteDb } from "./helpers";

const ROUTES = ["status", "signals", "clusters", "ticker/[symbol]"];
const call = (name: string, headers: Record<string, string>) => {
  const path = `/api/mcp/${name.replace("[symbol]", "ACME")}`;
  const params = { params: Promise.resolve({ symbol: "ACME" }) };
  const handler = { status, signals, clusters, "ticker/[symbol]": ticker }[name]!;
  return handler(req(path, headers), params);
};

beforeAll(() => void seedRouteDb());

describe.each(ROUTES)("/api/mcp/%s", (name) => {
  it.each<Record<string, string>>([{ host: "example.com" }, { host: "192.168.1.5:8500" }, {}, { host: "127.0.0.1:8500", origin: "https://evil.example" }])(
    "answers %j with 403",
    async (headers) => {
      expect((await call(name, headers)).status).toBe(403);
    },
  );

  it("exports GET only, so Next answers every other method with 405", () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "api", "mcp", name, "route.ts"), "utf8");
    const exported = [...src.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]);
    expect(exported.filter((e) => e !== "dynamic")).toEqual(["GET"]);
  });
});
