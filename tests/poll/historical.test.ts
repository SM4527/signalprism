import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { pollAll } from "@/lib/poll/poll-all";
import { form4Url } from "@/lib/sec/submissions";
import { addDays } from "@/lib/signals/dates";
import { seedDefaults } from "@/lib/signals/rules";
import { upsertCompany } from "@/lib/store/companies";
import { addTickers } from "@/lib/watchlist/watch";
import { fixtureXml } from "../sec/fixtures";
import { FakeSec, testClient } from "./fake-sec";

const fake = new FakeSec();
beforeAll(() => fake.start());
afterAll(() => fake.stop());

/** A Friday. The CEO fixture is shifted so its buys (Mon, Mon, Wed) are filed today with a lag of 2 days. */
const NOW = new Date("2026-12-04T15:00:00Z");
const TODAY = "2026-12-04";
const ACME = "0009000001";

const ceoXml = (owner: { cik: string; name: string } | null = null) => {
  const shifted = fixtureXml("synthetic_ceo_multi_p.xml").replace(/\d{4}-\d{2}-\d{2}/g, (d) => addDays(d, 28));
  return owner ? shifted.replace("0009100001", owner.cik).replace("Rivera Dana", owner.name) : shifted;
};

const FIRST = { accession: "0009990001-26-000101", doc: "first.xml", xml: ceoXml() };
const SECOND = { accession: "0009990001-26-000102", doc: "second.xml", xml: ceoXml({ cik: "0009100099", name: "Quill Pat" }) };

/** Serve a submissions list and the XML of each entry, all dated today. */
function serve(entries: (typeof FIRST)[]) {
  fake.bodies.clear();
  fake.bodies.set(
    `/submissions/CIK${ACME}.json`,
    JSON.stringify({
      filings: {
        recent: {
          accessionNumber: entries.map((e) => e.accession),
          filingDate: entries.map(() => TODAY),
          form: entries.map(() => "4"),
          primaryDocument: entries.map((e) => `xslF345X05/${e.doc}`),
        },
      },
    }),
  );
  for (const e of entries) fake.bodies.set(form4Url("", "9000001", e.accession, e.doc), e.xml);
}

function setup() {
  fake.rules = [];
  fake.requests = [];
  const db = openDb(":memory:");
  seedDefaults(db);
  upsertCompany(db, { cik: ACME, ticker: "ACMR", name: "Acme Robotics", source: "in_manual" }, "2026-12-01");
  return db;
}

const poll = (db: ReturnType<typeof openDb>) => pollAll(db, testClient().client, fake.urls, NOW);
const rows = (db: ReturnType<typeof openDb>, kind?: string) =>
  db.prepare(`SELECT count(*) FROM notification_log ${kind ? "WHERE kind = ?" : ""}`).pluck().get(...(kind ? [kind] : [])) as number;
const historical = (db: ReturnType<typeof openDb>) => db.prepare("SELECT historical FROM signal ORDER BY id").pluck().all();

describe("first poll of a company", () => {
  it("records a filing dated today as historical and creates no notification; the next poll's new filing does", async () => {
    const db = setup();
    serve([FIRST]);
    await poll(db);
    expect(historical(db)).toEqual([1]);
    expect(rows(db)).toBe(0);

    serve([FIRST, SECOND]);
    await poll(db);
    expect(historical(db)).toEqual([1, 0]);
    expect(rows(db, "signal")).toBe(1);
    expect(rows(db, "cluster")).toBe(1);
    expect(db.prepare("SELECT status FROM notification_log").pluck().all()).toEqual(["held", "held"]);
  });

  it("is a first poll again after a wipe and re-add", async () => {
    serve([FIRST]);
    const db = setup();
    await poll(db);
    const again = setup();
    await poll(again);
    expect(historical(again)).toEqual([1]);
    expect(rows(again)).toBe(0);
  });

  it("is a first poll for a company added by hand or from FolioPrism (no cursor yet)", async () => {
    serve([FIRST]);
    const manual = openDb(":memory:");
    seedDefaults(manual);
    manual.prepare("INSERT INTO ticker_map VALUES (?, 'ACMR', 'Acme Robotics', '2026-12-04T00:00:00Z')").run(ACME);
    addTickers(manual, ["ACMR"], TODAY);
    await poll(manual);
    expect(historical(manual)).toEqual([1]);

    const folio = openDb(":memory:");
    seedDefaults(folio);
    upsertCompany(folio, { cik: ACME, ticker: "ACMR", name: "Acme Robotics", source: "in_direct" }, TODAY);
    await poll(folio);
    expect(historical(folio)).toEqual([1]);
    expect(rows(manual) + rows(folio)).toBe(0);
  });

  it("stays a first poll when the submissions request failed", async () => {
    const db = setup();
    serve([FIRST]);
    fake.rules = [{ match: "/submissions/", status: 404, times: 1 }];
    await poll(db);
    expect(db.prepare("SELECT first_polled_at FROM company_cursor").pluck().get()).toBeNull();

    await poll(db);
    expect(historical(db)).toEqual([1]);
    expect(rows(db)).toBe(0);
  });

  it("keeps a filing historical when its XML failed in the first poll and was fetched by a later one", async () => {
    const db = setup();
    serve([FIRST]);
    fake.rules = [{ match: "first.xml", status: 404, times: 1 }];
    await poll(db);
    expect(db.prepare("SELECT count(*) FROM signal").pluck().get()).toBe(0);

    serve([FIRST]);
    await poll(db);
    expect(historical(db)).toEqual([1]);
    expect(rows(db)).toBe(0);
  });
});
