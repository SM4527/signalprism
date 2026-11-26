import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const DIR = join(process.cwd(), "tests", "fixtures", "folioprism");
export const fixture = (name: "holdings" | "analysis") => JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));

export interface FakeFolio {
  url: string;
  requests: string[];
  close: () => Promise<void>;
}

/** Serves the captured sample fixtures (or overrides) on a random local port and records "METHOD path". */
export async function startFakeFolio(
  override: Partial<Record<"/api/holdings" | "/api/analysis", unknown>> = {},
  status = 200,
): Promise<FakeFolio> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const body =
      override[req.url as "/api/holdings"] ??
      (req.url === "/api/holdings" ? fixture("holdings") : req.url === "/api/analysis" ? fixture("analysis") : null);
    res.writeHead(body === null ? 404 : status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
