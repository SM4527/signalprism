import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const USAGE_HEADERS = {
  "x-limit-app-limit": "10000",
  "x-limit-app-remaining": "9990",
  "x-limit-app-reset": "1796083200", // 2026-12-01T00:00:00Z
};

type Reply = { status: number; headers?: Record<string, string>; delayMs?: number } | "drop";

/** A local stand-in for api.pushover.net. Records each message form; replies from `plan`, then 200. */
export class FakePushover {
  requests: { path: string; method: string; form: Record<string, string> }[] = [];
  plan: Reply[] = [];
  url = "";
  private server: Server;

  constructor() {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        this.requests.push({ path: req.url ?? "", method: req.method ?? "", form: Object.fromEntries(new URLSearchParams(body)) });
        const reply = this.plan.shift() ?? { status: 200 };
        if (reply === "drop") return void req.socket.destroy();
        setTimeout(() => {
          res.writeHead(reply.status, { "content-type": "application/json", ...USAGE_HEADERS, ...reply.headers });
          res.end(JSON.stringify({ status: reply.status === 200 ? 1 : 0, request: "fake" }));
        }, reply.delayMs ?? 0);
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((ok) => this.server.listen(0, "127.0.0.1", ok));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((ok) => this.server.close(() => ok()));
  }

  reset(): void {
    this.requests = [];
    this.plan = [];
  }

  titles(): string[] {
    return this.requests.map((r) => r.form.title);
  }
}
