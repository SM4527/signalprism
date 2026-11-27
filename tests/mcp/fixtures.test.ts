import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClustersResponse, SignalsResponse, StatusResponse, TickerResponse } from "@/lib/mcp/schemas";

const DIR = join(process.cwd(), "tests", "fixtures", "mcp");
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), "utf8"));

describe("captured fixtures match the exported schemas", () => {
  it.each([
    ["status.json", StatusResponse],
    ["signals.json", SignalsResponse],
    ["signals-with-plan.json", SignalsResponse],
    ["clusters.json", ClustersResponse],
    ["ticker-GSBD.json", TickerResponse],
  ] as const)("%s", (file, schema) => {
    expect(schema.safeParse(read(file)).success).toBe(true);
  });
});
