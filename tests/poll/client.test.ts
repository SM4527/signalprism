import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { SecHttpError, SecPaused } from "@/lib/sec/client";
import { RateLimiter } from "@/lib/sec/limiter";
import { form4Entries } from "@/lib/sec/submissions";
import { monthsBefore } from "@/lib/signals/dates";
import { FakeSec, testClient } from "./fake-sec";

const fake = new FakeSec();
beforeAll(() => fake.start());
afterAll(() => fake.stop());
beforeEach(() => {
  fake.rules = [];
  fake.requests = [];
});
const url = () => `${fake.url}/submissions/CIK0009000001.json`;

describe("limiter", () => {
  it("never allows more than 8 acquisitions in any 1000 ms", async () => {
    const clock = { t: 0 };
    const limiter = new RateLimiter(8, () => clock.t, async (ms) => void (clock.t += ms));
    const stamps: number[] = [];
    for (let i = 0; i < 40; i++) {
      await limiter.acquire();
      stamps.push(clock.t);
    }
    for (const [i, s] of stamps.entries()) {
      expect(stamps.filter((x) => x >= s && x < s + 1000).length, `window at ${i}`).toBeLessThanOrEqual(8);
    }
    expect(stamps.at(-1)).toBeGreaterThanOrEqual(4000);
  });
});

describe("config", () => {
  it("refuses live mode without SEC_USER_AGENT and allows mock mode without it", () => {
    expect(() => loadConfig({ DATA_MODE: "live" })).toThrow(/SEC_USER_AGENT/);
    expect(loadConfig({ DATA_MODE: "live", SEC_USER_AGENT: "x y@example.invalid" }).DATA_MODE).toBe("live");
    const mock = loadConfig({});
    expect(mock.DATA_MODE).toBe("mock");
    expect(mock.SEC_DATA_URL).toBe("https://data.sec.gov");
  });
});

describe("SecClient", () => {
  it("sends the User-Agent on every request", async () => {
    const { client } = testClient("Agent One a@example.invalid");
    await client.get(url());
    await client.get(url());
    expect(fake.requests.map((r) => r.userAgent)).toEqual(Array(2).fill("Agent One a@example.invalid"));
  });

  it("retries 429 and 503 with doubling delays", async () => {
    const { client, waits } = testClient();
    fake.rules = [{ match: "/submissions", status: 429, times: 2 }, { match: "/submissions", status: 503, times: 1 }];
    await client.get(url());
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(fake.requests).toHaveLength(4);
  });

  it("honors Retry-After", async () => {
    const { client, waits } = testClient();
    fake.rules = [{ match: "/submissions", status: 429, times: 1, headers: { "Retry-After": "7" } }];
    await client.get(url());
    expect(waits).toEqual([7000]);
  });

  it("gives up after 5 tries", async () => {
    const { client } = testClient();
    fake.rules = [{ match: "/submissions", status: 503, times: 99 }];
    await expect(client.get(url())).rejects.toBeInstanceOf(SecHttpError);
    expect(fake.requests).toHaveLength(5);
  });

  it("never retries a 403, and a success resets the 403 count", async () => {
    const { client, waits } = testClient();
    fake.rules = [{ match: "/submissions", status: 403, times: 2 }];
    await expect(client.get(url())).rejects.toMatchObject({ status: 403 });
    await expect(client.get(url())).rejects.toMatchObject({ status: 403 });
    expect(fake.requests).toHaveLength(2);
    await client.get(url());
    fake.rules = [{ match: "/submissions", status: 403, times: 2 }];
    await expect(client.get(url())).rejects.toMatchObject({ status: 403 });
    await expect(client.get(url())).rejects.toMatchObject({ status: 403 });
    expect(waits).toEqual([]);
  });

  it("pauses for one hour on the third consecutive 403, across requests", async () => {
    const { client, clock } = testClient();
    fake.rules = [{ match: "/submissions", status: 403, times: 99 }];
    await expect(client.get(url())).rejects.toBeInstanceOf(SecHttpError);
    await expect(client.get(url())).rejects.toBeInstanceOf(SecHttpError);
    const start = clock.t;
    const err = await client.get(url()).catch((e) => e);
    expect(err).toBeInstanceOf(SecPaused);
    expect(err.until).toBe(start + 3_600_000);
    expect(fake.requests).toHaveLength(3);
  });
});

describe("form4Entries", () => {
  const body = JSON.stringify({
    filings: {
      recent: {
        accessionNumber: ["a", "b", "c", "d", "e"],
        filingDate: ["2025-10-27", "2025-10-25", "2026-01-02", "2026-01-03", "2026-01-04"],
        form: ["4", "4", "8-K", "4/A", "4"],
        primaryDocument: ["xslF345X05/x.xml", "x.xml", "x.htm", "xslF345X05/y.xml", "xslF345X05/z.htm"],
      },
    },
  });

  it("keeps Form 4 and 4/A inside the 13-month window, strips the XSL prefix, flags missing XML", () => {
    const since = monthsBefore("2026-11-26", 13);
    expect(since).toBe("2025-10-26");
    expect(form4Entries(body, since)).toEqual([
      { accession: "a", filedAt: "2025-10-27", doc: "x.xml" },
      { accession: "d", filedAt: "2026-01-03", doc: "y.xml" },
      { accession: "e", filedAt: "2026-01-04", doc: null },
    ]);
  });

  it("throws on a surprise shape", () => {
    expect(() => form4Entries("{}", "2025-01-01")).toThrow();
  });
});
