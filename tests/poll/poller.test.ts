import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { getPollStatus, pollAll } from "@/lib/poll/poll-all";
import { seedDefaults } from "@/lib/signals/rules";
import { ingestBatch } from "@/lib/ingest";
import { upsertCompany } from "@/lib/store/companies";
import { snapshot, FIXTURES } from "../signals/helpers";
import { FakeSec, NOW_ISO, testClient } from "./fake-sec";

const fake = new FakeSec();
beforeAll(() => fake.start());
afterAll(() => fake.stop());

const NOW = new Date(NOW_ISO);
const ACME = "0009000001";
const FALCON = "0009000006";
const MALFORMED = "0009000011";

function setup(ciks: string[]) {
  fake.rules = [];
  fake.requests = [];
  fake.bodies.clear();
  const db = openDb(":memory:");
  seedDefaults(db);
  for (const cik of ciks) upsertCompany(db, { cik, ticker: `T${cik.slice(-2)}`, name: null, source: "in_manual" }, "2026-11-01");
  return db;
}

/** Signals and clusters without accession numbers, so two databases can be compared. */
function shape(db: ReturnType<typeof openDb>) {
  const s = snapshot(db);
  const signals = s.signals as Record<string, unknown>[];
  const clusters = s.clusters as Record<string, unknown>[];
  return {
    signals: signals
      .map((r) => ({ owner: r.owner, score: r.score, parts: r.parts, replaced: !!r.superseded_by, removed: !!r.superseded_by_filing }))
      .sort((a, b) => String(a.owner).localeCompare(String(b.owner)) || Number(a.score) - Number(b.score)),
    clusters: clusters.map((c) => ({ ...c, members: undefined })),
  };
}

describe("first run", () => {
  it("fetches only the 13-month window, oldest first, and matches ingesting the same filings in order", async () => {
    const db = setup([ACME, FALCON]);
    const { client } = testClient();
    const counts = await pollAll(db, client, fake.urls, NOW);
    expect(counts).toEqual({ filingsNew: 5, signalsNew: expect.any(Number), errors: 0 });

    expect(fake.paths("/Archives").map((p) => p.split("/").pop())).toEqual([
      "synthetic_ceo_multi_p.xml",
      "synthetic_p_mixed_codes.xml",
      "synthetic_cluster_director.xml",
      "synthetic_amendment_original.xml",
      "synthetic_amendment_4a.xml",
    ]);
    expect(fake.paths("old")).toEqual([]);

    const expected = openDb(":memory:");
    seedDefaults(expected);
    ingestBatch(expected, FIXTURES);
    expect(shape(db)).toEqual(shape(expected));
    expect(shape(db).clusters).toHaveLength(1);
  });

  it("records the cursor per company", async () => {
    const db = setup([ACME]);
    await pollAll(db, testClient().client, fake.urls, NOW);
    expect(db.prepare("SELECT * FROM company_cursor WHERE cik = ?").get(ACME)).toEqual({
      cik: ACME,
      last_accession: "0009990001-26-000003",
      last_polled_at: NOW.toISOString(),
      last_error: null,
      first_polled_at: NOW.toISOString(),
    });
  });
});

describe("later polls", () => {
  it("cost one request per company, then fetch only the new accession", async () => {
    const db = setup([ACME, FALCON]);
    await pollAll(db, testClient().client, fake.urls, NOW);

    fake.requests = [];
    await pollAll(db, testClient().client, fake.urls, NOW);
    expect(fake.requests).toHaveLength(2);

    const path = `/submissions/CIK${ACME}.json`;
    const body = JSON.parse(await (await fetch(fake.url + path)).text());
    body.filings.recent.accessionNumber.unshift("0009990001-26-000010");
    body.filings.recent.filingDate.unshift("2026-11-25");
    body.filings.recent.form.unshift("4");
    body.filings.recent.primaryDocument.unshift("xslF345X05/synthetic_new_position.xml");
    fake.bodies.set(path, JSON.stringify(body));
    fake.requests = [];
    const counts = await pollAll(db, testClient().client, fake.urls, NOW);
    expect(counts).toMatchObject({ filingsNew: 1, errors: 0 });
    expect(fake.paths("/Archives")).toHaveLength(1);
  });
});

describe("failures", () => {
  it("a bad XML fetch is skipped; the third failure for the same accession stores fetch_failed", async () => {
    const db = setup([ACME]);
    fake.rules = [{ match: "synthetic_p_mixed_codes", status: 404, times: 99 }];
    const acc = "0009990001-26-000002";
    const failures = () => db.prepare("SELECT failures FROM fetch_failure WHERE accession_no = ?").pluck().get(acc);
    const row = () => db.prepare("SELECT parse_error FROM filing WHERE accession_no = ?").get(acc);

    const first = await pollAll(db, testClient().client, fake.urls, NOW);
    expect(first).toMatchObject({ filingsNew: 2, errors: 1 });
    expect(failures()).toBe(1);
    expect(row()).toBeUndefined();
    expect(db.prepare("SELECT last_error FROM company_cursor").pluck().get()).toMatch(/404/);

    await pollAll(db, testClient().client, fake.urls, NOW);
    expect(failures()).toBe(2);
    expect(row()).toBeUndefined();

    await pollAll(db, testClient().client, fake.urls, NOW);
    expect(row()).toEqual({ parse_error: "fetch_failed" });

    fake.requests = [];
    const after = await pollAll(db, testClient().client, fake.urls, NOW);
    expect(after).toMatchObject({ filingsNew: 0, errors: 0 });
    expect(fake.paths("/Archives")).toEqual([]);
  });

  it("a malformed Form 4 becomes parse_error and the poll carries on", async () => {
    const db = setup([MALFORMED, ACME]);
    const counts = await pollAll(db, testClient().client, fake.urls, NOW);
    expect(counts).toMatchObject({ filingsNew: 4, errors: 0 });
    expect(db.prepare("SELECT count(*) FROM filing WHERE parse_error IS NOT NULL").pluck().get()).toBe(1);
  });
});

describe("403 pause", () => {
  it("stops the run on the third 403, persists the hour, and resumes after it", async () => {
    const db = setup([ACME, FALCON, MALFORMED, "0009000012"]);
    fake.rules = [{ match: "/submissions", status: 403, times: 3 }];
    const { client } = testClient();

    const first = await pollAll(db, client, fake.urls, NOW);
    expect(first).toMatchObject({ filingsNew: 0, errors: 3 });
    expect(fake.paths("/submissions")).toHaveLength(3);

    const status = getPollStatus(db, NOW);
    expect(status.pausedUntil).toBe("2026-11-26T16:00:00.000Z");

    fake.requests = [];
    expect(await pollAll(db, testClient().client, fake.urls, NOW)).toBe("paused");
    expect(fake.requests).toHaveLength(0);

    const later = new Date("2026-11-26T16:00:01Z");
    expect(getPollStatus(db, later).pausedUntil).toBeNull();
    const resumed = await pollAll(db, testClient().client, fake.urls, later);
    expect(resumed).not.toBe("paused");
    expect(fake.paths("/submissions").length).toBeGreaterThan(0);
  });
});
