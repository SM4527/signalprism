import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFiling, type IngestInput } from "@/lib/ingest";
import { evaluateAlerts } from "@/lib/notify/evaluate";
import { seedDefaults } from "@/lib/signals/rules";
import { fixtureXml } from "../sec/fixtures";
import { input } from "../signals/helpers";

const ACME = "0009000001";
const FALCON = "0009000006";

function setup() {
  const db = openDb(":memory:");
  seedDefaults(db);
  return db;
}
type Db = ReturnType<typeof setup>;

/** Ingest as of the filing day, so a signal is not historical by age. */
const ingest = (db: Db, i: IngestInput) => ingestFiling(db, i, { now: new Date(`${i.filedAt}T15:00:00Z`) });
const acme = (db: Db, file: string, accession: string, filedAt: string, extra: Partial<IngestInput> = {}) =>
  ingest(db, { ...input(file, accession, filedAt, ACME), ...extra });

const log = (db: Db, kind?: string) =>
  db
    .prepare(`SELECT kind, dedup_key, status, priority, payload_json, insiders_json FROM notification_log ${kind ? "WHERE kind = ?" : ""} ORDER BY id`)
    .all(...(kind ? [kind] : [])) as { kind: string; dedup_key: string; status: string; priority: number; payload_json: string; insiders_json: string | null }[];

describe("signal alerts", () => {
  it("a matching CEO buy makes one held row carrying only title, body, URL and priority", () => {
    const db = setup();
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    const [row] = log(db);
    expect(row).toMatchObject({ kind: "signal", status: "held", priority: 0 });
    const payload = JSON.parse(row.payload_json);
    expect(Object.keys(payload).sort()).toEqual(["body", "priority", "title", "url"]);
    expect(payload.title).toBe("ACMR · CEO buy · $35K · +35%");
    expect(payload.url).toBe("https://www.sec.gov/Archives/edgar/data/9000001/A1/A-1-index.htm");
  });

  it("is deduplicated per (rule, signal): re-ingesting or re-evaluating adds nothing", () => {
    const db = setup();
    const first = acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    expect(acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06").status).toBe("duplicate");
    const eval1 = () =>
      evaluateAlerts(db, { issuerCik: ACME, newSignalIds: first.signalIds, replaced: new Map(), repushIds: [], now: new Date("2026-11-06T15:00:00Z") });
    expect(eval1()).toBe(0);
    expect(log(db)).toHaveLength(1);
  });

  it("two enabled rules each get their own row for the same signal", () => {
    const db = setup();
    db.prepare("INSERT INTO alert_rule (name, roles_json, min_value, min_pct, director_min_value) VALUES ('Second', '[\"CEO\"]', '1000', '1', '250000')").run();
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    expect(log(db, "signal").map((r) => r.dedup_key)).toHaveLength(2);
  });

  it("makes no row for a director (off by default), a late filing, a plan buy or a disabled rule", () => {
    const db = setup();
    acme(db, "synthetic_cluster_director.xml", "A-3", "2026-11-17");
    acme(db, "synthetic_late_ceo.xml", "L-1", "2026-11-17");
    ingest(db, { ...input("synthetic_espp_mixed.xml", "E-1", "2026-11-02", "0009000021"), xml: fixtureXml("synthetic_espp.xml") });
    expect(log(db, "signal")).toHaveLength(0);

    db.prepare("UPDATE alert_rule SET enabled = 0").run();
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    expect(log(db)).toHaveLength(0);
  });

  it("one push per joint group, naming every owner", () => {
    const db = setup();
    db.prepare("UPDATE alert_rule SET include_ten_pct = 1, min_value = '10000'").run();
    ingest(db, input("synthetic_joint_filers.xml", "J-1", "2026-09-16", "0009000004"));
    const rows = log(db, "signal");
    expect(rows).toHaveLength(1);
    expect(rows[0].dedup_key).toMatch(/^sig:1:\d+\|joint:/);
    const body = JSON.parse(rows[0].payload_json).body as string;
    expect(body).toMatch(/Northwind Capital Partners LP/);
    expect(body).toMatch(/Northwind Management LLC/);
  });
});

describe("historical signals", () => {
  it("a filing older than the age limit at ingest is recorded and never alerted", () => {
    const db = setup();
    ingestFiling(db, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", ACME), { now: new Date("2026-11-20T15:00:00Z") });
    expect(db.prepare("SELECT historical FROM signal").pluck().get()).toBe(1);
    expect(log(db)).toHaveLength(0);
  });

  it("three days old is still alerted, four is not (ET calendar days)", () => {
    const db = setup();
    ingestFiling(db, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", ACME), { now: new Date("2026-11-09T15:00:00Z") });
    expect(log(db)).toHaveLength(1);
    const old = setup();
    ingestFiling(old, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", ACME), { now: new Date("2026-11-10T15:00:00Z") });
    expect(log(old)).toHaveLength(0);
  });

  it("the age limit is configurable and an explicit historical flag always wins", () => {
    const db = setup();
    ingestFiling(db, input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", ACME), { now: new Date("2026-11-09T15:00:00Z"), maxAgeDays: 1 });
    expect(log(db)).toHaveLength(0);
    const flagged = setup();
    ingest(flagged, { ...input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", ACME), historical: true });
    expect(log(flagged)).toHaveLength(0);
  });
});

describe("cluster alerts", () => {
  /** CEO 11-06, CFO 11-10, then a third insider (the director fixture, another CIK) 11-17. */
  const buildup = (db: Db) => {
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    acme(db, "synthetic_p_mixed_codes.xml", "A-2", "2026-11-10");
    acme(db, "synthetic_cluster_director.xml", "A-3", "2026-11-17");
  };

  it("pushes when a cluster forms and again when it gains an insider, never on a recompute", () => {
    const db = setup();
    buildup(db);
    const clusters = log(db, "cluster");
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => JSON.parse(c.insiders_json!).length)).toEqual([2, 3]);
    expect(clusters.every((c) => c.priority === 1)).toBe(true);
    expect(JSON.parse(clusters[0].payload_json).title).toMatch(/^ACMR · Cluster buy · 2 insiders · /);
    expect(db.prepare("SELECT last_alerted_count FROM cluster").pluck().get()).toBe(3);

    const again = () => evaluateAlerts(db, { issuerCik: ACME, newSignalIds: [], replaced: new Map(), repushIds: [], now: new Date("2026-11-18T15:00:00Z") });
    expect(again()).toBe(0);
    expect(log(db, "cluster")).toHaveLength(2);
  });

  it("never pushes for a set that shrank or was reshuffled (insiders already notified in the last 60 days)", () => {
    const db = setup();
    buildup(db);
    const before = log(db, "cluster").length;
    const evalNow = (day: string) =>
      evaluateAlerts(db, { issuerCik: ACME, newSignalIds: [], replaced: new Map(), repushIds: [], now: new Date(`${day}T15:00:00Z`) });

    // A 4/A removes the director's buy: the set shrinks to two known insiders.
    db.prepare("UPDATE signal SET superseded_by_filing_id = filing_id WHERE filing_id = (SELECT id FROM filing WHERE accession_no = 'A-3')").run();
    expect(evalNow("2026-11-20")).toBe(0);
    // The CEO's buy goes too: a different pair, still only known insiders.
    db.prepare("UPDATE signal SET superseded_by_filing_id = filing_id WHERE filing_id = (SELECT id FROM filing WHERE accession_no = 'A-1')").run();
    db.prepare("UPDATE signal SET superseded_by_filing_id = NULL WHERE filing_id = (SELECT id FROM filing WHERE accession_no = 'A-3')").run();
    expect(evalNow("2026-11-21")).toBe(0);
    expect(log(db, "cluster")).toHaveLength(before);
  });

  it("a cluster of only historical members does not push; a live member joining it does", () => {
    const db = setup();
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06", { historical: true });
    acme(db, "synthetic_p_mixed_codes.xml", "A-2", "2026-11-10", { historical: true });
    expect(log(db)).toHaveLength(0);
    expect(db.prepare("SELECT count(*) FROM cluster").pluck().get()).toBe(1);
    acme(db, "synthetic_cluster_director.xml", "A-3", "2026-11-17");
    expect(log(db, "cluster")).toHaveLength(1);
    expect(JSON.parse(log(db, "cluster")[0].insiders_json!)).toHaveLength(3);
  });

  it("an insider seen more than 60 days ago counts as new again", () => {
    const db = setup();
    buildup(db);
    // Age the earlier notifications past the memory (and free their keys, as a later window would have its own).
    db.prepare("UPDATE notification_log SET created_at = '2026-08-01T00:00:00.000Z', dedup_key = 'old:' || id WHERE kind = 'cluster'").run();
    const n = evaluateAlerts(db, { issuerCik: ACME, newSignalIds: [], replaced: new Map(), repushIds: [], now: new Date("2026-11-18T15:00:00Z") });
    expect(n).toBe(1);
  });

  it("plan buys never form a cluster alert", () => {
    const db = setup();
    const espp = (acc: string, cik: string) =>
      ingest(db, { ...input("synthetic_espp.xml", acc, "2026-11-02", "0009000021"), xml: fixtureXml("synthetic_espp.xml").replace("0009100031", cik).replace("Alder Jun", `Person ${cik}`) });
    espp("E-1", "0009100041");
    espp("E-2", "0009100042");
    expect(log(db)).toHaveLength(0);
  });

  it("rule pushOnCluster off sends no cluster alert", () => {
    const db = setup();
    db.prepare("UPDATE alert_rule SET push_on_cluster = 0").run();
    acme(db, "synthetic_ceo_multi_p.xml", "A-1", "2026-11-06");
    acme(db, "synthetic_p_mixed_codes.xml", "A-2", "2026-11-10");
    expect(log(db, "cluster")).toHaveLength(0);
  });
});

describe("4/A amendments", () => {
  /** An original CEO buy (value $120K, matches) and its 4/A, both filed the same day so neither is late. */
  const original = (shares: string) => ({
    ...input("synthetic_amendment_original.xml", "F-1", "2026-10-22", FALCON),
    xml: fixtureXml("synthetic_amendment_original.xml").replace("<value>300</value>", `<value>${shares}</value>`),
  });
  const amendment = (shares: string) => ({
    ...input("synthetic_amendment_4a.xml", "F-2", "2026-10-22", FALCON),
    xml: fixtureXml("synthetic_amendment_4a.xml").replace("<value>400</value>", `<value>${shares}</value>`),
  });

  it("pushes again when the value moved by more than 20%", () => {
    const db = setup();
    ingest(db, original("4000"));
    expect(log(db, "signal")).toHaveLength(1);
    ingest(db, amendment("6000"));
    expect(log(db, "signal")).toHaveLength(2);
  });

  it("does not push when the value moved by 20% or less", () => {
    const db = setup();
    ingest(db, original("4000"));
    ingest(db, amendment("4400"));
    expect(log(db, "signal")).toHaveLength(1);
  });

  it("treats an amendment of something never pushed as a new signal", () => {
    const db = setup();
    ingest(db, { ...original("4000"), historical: true });
    expect(log(db)).toHaveLength(0);
    ingest(db, amendment("4400"));
    expect(log(db, "signal")).toHaveLength(1);
  });
});
