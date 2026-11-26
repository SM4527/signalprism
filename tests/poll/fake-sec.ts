import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SecClient } from "@/lib/sec/client";
import { RateLimiter } from "@/lib/sec/limiter";

const FIXTURES = join(process.cwd(), "tests", "fixtures");

/** Answer `status` to the next `times` requests whose path contains `match`. */
export interface Rule {
  match: string;
  status: number;
  times: number;
  headers?: Record<string, string>;
}

export const NOW_ISO = "2026-11-26T15:00:00Z";

export const TICKERS = {
  "0": { cik_str: 9000001, ticker: "ACMR", title: "Acme Robotics" },
  "1": { cik_str: 9000006, ticker: "FLCN", title: "Falcon Foods" },
  "2": { cik_str: 9000011, ticker: "MLFM", title: "Malformed Co" },
};

/** A local stand-in for data.sec.gov and www.sec.gov, backed by the submissions and Form 4 fixtures. */
export class FakeSec {
  requests: { path: string; userAgent: string | undefined }[] = [];
  rules: Rule[] = [];
  /** Replaces the body served at an exact path. */
  bodies = new Map<string, string>();
  url = "";
  private server: Server;

  constructor() {
    this.server = createServer((req, res) => {
      const path = req.url ?? "";
      this.requests.push({ path, userAgent: req.headers["user-agent"] });
      const rule = this.rules.find((r) => r.times > 0 && path.includes(r.match));
      if (rule) {
        rule.times--;
        res.writeHead(rule.status, rule.headers).end();
        return;
      }
      const body = this.bodies.get(path) ?? this.fixture(path);
      if (body === undefined) res.writeHead(404).end();
      else res.writeHead(200).end(body);
    });
  }

  private fixture(path: string): string | undefined {
    const file = path.startsWith("/submissions/")
      ? join(FIXTURES, "submissions", path.split("/").pop()!)
      : path.startsWith("/Archives/")
        ? join(FIXTURES, "form4", path.split("/").pop()!)
        : null;
    if (path === "/files/company_tickers.json") return JSON.stringify(TICKERS);
    try {
      return file ? readFileSync(file, "utf8") : undefined;
    } catch {
      return undefined;
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((ok) => this.server.listen(0, "127.0.0.1", ok));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((ok) => this.server.close(() => ok()));
  }

  get urls() {
    return { dataUrl: this.url, archivesUrl: this.url };
  }

  /** Requests whose path contains `part`, in arrival order. */
  paths(part = ""): string[] {
    return this.requests.map((r) => r.path).filter((p) => p.includes(part));
  }
}

/** A client on a fake clock: waits advance time instantly and are recorded. */
export function testClient(userAgent = "SignalPrismTest test@example.invalid") {
  const clock = { t: Date.parse(NOW_ISO) };
  const waits: number[] = [];
  const now = () => clock.t;
  const wait = async (ms: number) => {
    waits.push(ms);
    clock.t += ms;
  };
  const client = new SecClient({ userAgent, now, wait, limiter: new RateLimiter(8, now, wait) });
  return { client, clock, waits };
}
