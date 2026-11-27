import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { retentionDue, runRetention, runRetentionIfDue, type RetentionConfig } from "@/lib/retention";
import { seedDefaults } from "@/lib/signals/rules";
import { upsertCompany } from "@/lib/store/companies";
import { fixtureXml } from "./sec/fixtures";
import { input } from "./signals/helpers";

const CFG: RetentionConfig = { RETENTION_POLL_RUN_DAYS: 90, RETENTION_NOTIFICATION_DAYS: 365, RETENTION_AUDIT_DAYS: 1095, RETENTION_INACTIVE_DAYS: 90 };
const NOW = new Date("2026-11-27T12:00:00Z");
const ACME = "0009000001";
const FALCON = "0009000006";
const iso = (daysBack: number) => new Date(NOW.getTime() - daysBack * 86_400_000).toISOString();
const count = (db: ReturnType<typeof openDb>, table: string, where = "1") => db.prepare(`SELECT count(*) FROM ${table} WHERE ${where}`).pluck().get() as number;

function setup() {
  const db = openDb(":memory:");
  seedDefaults(db);
  return db;
}

/** Make a company inactive and age the stamp (the trigger sets it to the real time in the same statement). */
function deactivate(db: ReturnType<typeof openDb>, cik: string, daysBack: number) {
  db.prepare("UPDATE company SET active = 0 WHERE cik = ?").run(cik);
  db.prepare("UPDATE company SET inactive_since = ? WHERE cik = ?").run(iso(daysBack), cik);
}

describe("trigger on company.active", () => {
  it("stamps inactive_since once when a company goes inactive and clears it when it is active again", () => {
    const db = setup();
    upsertCompany(db, { cik: ACME, ticker: "ACMR", name: null, source: "in_manual" }, "2026-11-01");
    expect(db.prepare("SELECT inactive_since FROM company").pluck().get()).toBeNull();
    db.prepare("UPDATE company SET active = 0").run();
    const first = db.prepare("SELECT inactive_since FROM company").pluck().get() as string;
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    db.prepare("UPDATE company SET active = 0").run();
    expect(db.prepare("SELECT inactive_since FROM company").pluck().get()).toBe(first);
    db.prepare("UPDATE company SET active = 1").run();
    expect(db.prepare("SELECT inactive_since FROM company").pluck().get()).toBeNull();
  });
});

describe("poll runs and notifications", () => {
  it("deletes poll runs older than 90 days and notifications older than a year, keeping the rest", () => {
    const db = setup();
    for (const days of [100, 89, 1]) db.prepare("INSERT INTO poll_run (started_at) VALUES (?)").run(iso(days));
    let k = 0;
    for (const days of [400, 364, 1]) {
      db.prepare("INSERT INTO notification_log (kind, dedup_key, status, payload_json, created_at) VALUES ('signal', ?, 'sent', '{}', ?)").run(`k${k++}`, iso(days));
    }
    const r = runRetention(db, CFG, NOW);
    expect(r).toMatchObject({ pollRuns: 1, notifications: 1 });
    expect(count(db, "poll_run")).toBe(2);
    expect(count(db, "notification_log")).toBe(2);
  });

  it("deletes failed fetches older than the poll-run period", () => {
    const db = setup();
    for (const days of [100, 89, 1]) db.prepare("INSERT INTO fetch_failure (accession_no, failures, updated_at) VALUES (?, 1, ?)").run(`a${days}`, iso(days));
    expect(runRetention(db, CFG, NOW).fetchFailures).toBe(1);
    expect(db.prepare("SELECT accession_no FROM fetch_failure ORDER BY accession_no").pluck().all()).toEqual(["a1", "a89"]);
  });

  it("honours the configured periods", () => {
    const db = setup();
    db.prepare("INSERT INTO poll_run (started_at) VALUES (?)").run(iso(20));
    runRetention(db, { ...CFG, RETENTION_POLL_RUN_DAYS: 10 }, NOW);
    expect(count(db, "poll_run")).toBe(0);
  });
});

describe("audit lines", () => {
  /** The CFO fixture has M, A, F and P lines; the P line makes the signal. */
  function withFiling(filedAt: string) {
    const db = setup();
    ingestFiling(db, { ...input("synthetic_p_mixed_codes.xml", "A-2", "2026-11-10", ACME), historical: true }, { now: NOW });
    db.prepare("UPDATE filing SET filed_at = ?").run(filedAt);
    return db;
  }

  it("deletes lines that did not become a signal once the filing is over 3 years old; the purchase line stays", () => {
    const db = withFiling("2023-11-01");
    const lines = count(db, "transaction_line");
    const purchases = count(db, "transaction_line", "table_no = 1 AND code = 'P' AND shares IS NOT NULL AND price IS NOT NULL");
    expect(lines).toBeGreaterThan(purchases);
    expect(runRetention(db, CFG, NOW).auditLines).toBe(lines - purchases);
    expect(count(db, "transaction_line")).toBe(purchases);
    expect(count(db, "signal")).toBe(1);
  });

  it("keeps everything for a filing under 3 years old", () => {
    const db = withFiling("2024-01-15");
    const lines = count(db, "transaction_line");
    expect(runRetention(db, CFG, NOW).auditLines).toBe(0);
    expect(count(db, "transaction_line")).toBe(lines);
  });
});

describe("companies inactive for 90+ days", () => {
  function twoCompanies() {
    const db = setup();
    for (const [cik, ticker] of [[ACME, "ACMR"], [FALCON, "FLCN"]]) {
      upsertCompany(db, { cik, ticker, name: ticker, source: "in_manual" }, "2026-01-01");
      db.prepare("INSERT INTO company_cursor (cik, last_polled_at) VALUES (?, ?)").run(cik, iso(1));
    }
    for (const [file, acc] of [["synthetic_ceo_multi_p.xml", "A-1"], ["synthetic_p_mixed_codes.xml", "A-2"]] as const) {
      ingestFiling(db, { ...input(file, acc, "2026-11-06", ACME), historical: true }, { now: NOW });
    }
    // Falcon: a filing with a signal and a conversion-only filing without one.
    ingestFiling(db, { ...input("synthetic_amendment_original.xml", "F-1", "2026-10-22", FALCON), historical: true }, { now: NOW });
    ingestFiling(db, { ...input("synthetic_conversion_no_p.xml", "F-2", "2026-10-23", FALCON), historical: true }, { now: NOW });
    return db;
  }

  it("removes the company, its lines, clusters, cursor and unsignaled filings; keeps signals with their filings and owners", () => {
    const db = twoCompanies();
    expect(count(db, "cluster", `issuer_cik = '${ACME}'`)).toBe(1);
    deactivate(db, ACME, 91);
    db.prepare("UPDATE filing SET issuer_cik = ? WHERE accession_no = 'F-2'").run(ACME); // an ACME filing without a signal
    const signals = count(db, "signal");

    expect(runRetention(db, CFG, NOW).companies).toBe(1);
    expect(count(db, "company", `cik = '${ACME}'`)).toBe(0);
    expect(count(db, "company_cursor", `cik = '${ACME}'`)).toBe(0);
    expect(count(db, "cluster", `issuer_cik = '${ACME}'`)).toBe(0);
    expect(count(db, "cluster_member")).toBe(0);
    expect(count(db, "transaction_line", `filing_id IN (SELECT id FROM filing WHERE issuer_cik = '${ACME}')`)).toBe(0);
    expect(count(db, "filing", "accession_no = 'F-2'")).toBe(0);
    expect(count(db, "signal")).toBe(signals);
    expect(count(db, "filing", "accession_no IN ('A-1', 'A-2')")).toBe(2);
    expect(count(db, "reporting_owner", "filing_id IN (SELECT id FROM filing WHERE accession_no IN ('A-1', 'A-2'))")).toBeGreaterThan(0);
    // The other company is untouched.
    expect(count(db, "company", `cik = '${FALCON}'`)).toBe(1);
    expect(count(db, "transaction_line", `filing_id IN (SELECT id FROM filing WHERE issuer_cik = '${FALCON}')`)).toBeGreaterThan(0);
  });

  it("leaves a company inactive for under 90 days, and an active one, alone", () => {
    const db = twoCompanies();
    deactivate(db, ACME, 89);
    expect(runRetention(db, CFG, NOW).companies).toBe(0);
    expect(count(db, "company")).toBe(2);
  });

  it("a company reactivated before the cutoff is not deleted", () => {
    const db = twoCompanies();
    deactivate(db, ACME, 200);
    db.prepare("UPDATE company SET active = 1 WHERE cik = ?").run(ACME);
    expect(runRetention(db, CFG, NOW).companies).toBe(0);
  });

  it("keeps the 4/A filing that removed a purchase while its signal is kept", () => {
    const db = setup();
    upsertCompany(db, { cik: FALCON, ticker: "FLCN", name: null, source: "in_manual" }, "2026-01-01");
    const noP = fixtureXml("synthetic_amendment_4a.xml").replace(/<transactionCode>P<\/transactionCode>/g, "<transactionCode>S</transactionCode>");
    ingestFiling(db, { ...input("synthetic_amendment_original.xml", "F-1", "2026-10-22", FALCON), historical: true }, { now: NOW });
    ingestFiling(db, { ...input("synthetic_amendment_4a.xml", "F-2", "2026-10-22", FALCON), xml: noP, historical: true }, { now: NOW });
    expect(db.prepare("SELECT superseded_by_filing_id FROM signal").pluck().get()).not.toBeNull();
    deactivate(db, FALCON, 120);
    expect(() => runRetention(db, CFG, NOW)).not.toThrow();
    expect(count(db, "filing", "accession_no = 'F-2'")).toBe(1);
  });
});

describe("weekly schedule", () => {
  it("runs when never run or a week old, and not in between", () => {
    const db = setup();
    expect(retentionDue(db, NOW)).toBe(true);
    expect(runRetentionIfDue(db, CFG, NOW)).not.toBeNull();
    expect(retentionDue(db, new Date(NOW.getTime() + 6 * 86_400_000))).toBe(false);
    expect(runRetentionIfDue(db, CFG, new Date(NOW.getTime() + 6 * 86_400_000))).toBeNull();
    expect(runRetentionIfDue(db, CFG, new Date(NOW.getTime() + 7 * 86_400_000))).not.toBeNull();
  });
});

describe("VACUUM", () => {
  const dir = mkdtempSync(join(tmpdir(), "signalprism-retention-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("gives the freed pages back to the file", () => {
    const db = openDb(join(dir, "r.db"));
    seedDefaults(db);
    const insert = db.prepare("INSERT INTO poll_run (started_at, errors) VALUES (?, 0)");
    for (let i = 0; i < 5000; i++) insert.run(iso(200));
    db.pragma("wal_checkpoint(TRUNCATE)");
    runRetentionIfDue(db, CFG, NOW);
    expect(count(db, "poll_run")).toBe(0);
    expect(db.pragma("freelist_count", { simple: true })).toBe(0);
    db.close();
  });
});
