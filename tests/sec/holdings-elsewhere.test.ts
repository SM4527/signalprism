import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { ingestFiling } from "@/lib/ingest";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { HOLDING_TABLE } from "@/lib/sec/form4-types";
import { buildSignals } from "@/lib/signals/signal-builder";
import { fixtureXml, loadForm4 } from "./fixtures";

describe("nonDerivativeHolding rows", () => {
  it("are parsed as I-holding lines", () => {
    const holdings = loadForm4("synthetic_holdings_elsewhere.xml").lines.filter((l) => l.table === HOLDING_TABLE);
    expect(holdings).toHaveLength(3);
    expect(holdings[0]).toMatchObject({
      securityTitle: "Common Stock", ownedAfter: "24032", ownershipForm: "D", nature: "", shares: null, code: "",
    });
  });

  it("count toward ownedBefore: 2,500 bought, 9,000 after, 24,032 held directly", () => {
    const [s] = buildSignals(loadForm4("synthetic_holdings_elsewhere.xml"), "2026-10-21");
    // 9,000 - 2,500 = 6,500 in the bought bucket + 24,032 direct. The identical indirect holding row and the
    // preferred stock row do not count.
    expect(s).toMatchObject({ ownedBefore: "30532", pctIncrease: "8.1881", newPosition: false });
  });

  it("without the holding rows the same buy is +38.4615%", () => {
    const form = loadForm4("synthetic_holdings_elsewhere.xml");
    form.lines = form.lines.filter((l) => l.table !== HOLDING_TABLE);
    const [s] = buildSignals(form, "2026-10-21");
    expect(s).toMatchObject({ ownedBefore: "6500", pctIncrease: "38.4615" });
  });

  it("a buy through a new entity with existing direct holdings is not a new position", () => {
    const [s] = buildSignals(loadForm4("synthetic_new_entity_holdings.xml"), "2026-10-23");
    expect(s).toMatchObject({ ownedBefore: "5000", pctIncrease: "20", newPosition: false });
  });

  it("without the holding rows the new-entity buy is a new position", () => {
    const form = loadForm4("synthetic_new_entity_holdings.xml");
    form.lines = form.lines.filter((l) => l.table !== HOLDING_TABLE);
    const [s] = buildSignals(form, "2026-10-23");
    expect(s).toMatchObject({ newPosition: true, pctIncrease: null });
  });

  it("are stored as transaction_line rows with table I-holding and never become signals", () => {
    const db = openDb(":memory:");
    const r = ingestFiling(db, {
      accession: "H-1", issuerCik: "0009000031", filedAt: "2026-10-21", xml: fixtureXml("synthetic_holdings_elsewhere.xml"),
    });
    expect(r.signalIds).toHaveLength(1);
    expect(db.prepare("SELECT count(*) FROM transaction_line WHERE table_no = ?").pluck().get(HOLDING_TABLE)).toBe(3);
    expect(db.prepare("SELECT pct_increase FROM signal").pluck().get()).toBe("8.1881");
  });
});

describe("Table II leniency", () => {
  it("a derivativeTransaction without transactionCoding parses, with a warning", () => {
    const r = parseForm4(fixtureXml("synthetic_table2_no_coding.xml"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form4.warnings).toEqual(["table II: derivative transaction 1 has no transaction code"]);
    expect(r.form4.lines.filter((l) => l.table === 2)).toMatchObject([{ code: "", shares: "1000" }]);
    const [s] = buildSignals(r.form4, "2026-10-28");
    expect(s.value).toBe("10000");
  });

  it("an unreadable derivative row is dropped with a warning and Table I still parses", () => {
    const xml = fixtureXml("synthetic_table2_no_coding.xml").replace(
      /<derivativeTransaction>[\s\S]*<\/derivativeTransaction>/,
      "<derivativeTransaction>junk</derivativeTransaction>",
    );
    const r = parseForm4(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form4.warnings).toEqual(["table II: unreadable derivative transaction 1"]);
    expect(r.form4.lines.filter((l) => l.table === 1)).toHaveLength(1);
  });

  it("a bad field inside Table II is dropped, not fatal", () => {
    const xml = fixtureXml("synthetic_table2_no_coding.xml").replace(
      "<transactionShares><value>1000</value></transactionShares>",
      "<transactionShares><value><nested>x</nested></value></transactionShares>",
    );
    const r = parseForm4(xml);
    expect(r.ok).toBe(true);
  });

  it("the filing is stored with its warning", () => {
    const db = openDb(":memory:");
    const r = ingestFiling(db, {
      accession: "W-1", issuerCik: "0009000033", filedAt: "2026-10-28", xml: fixtureXml("synthetic_table2_no_coding.xml"),
    });
    expect(r.status).toBe("ok");
    expect(r.signalIds).toHaveLength(1);
    expect(db.prepare("SELECT parse_warning FROM filing").pluck().get()).toBe(
      "table II: derivative transaction 1 has no transaction code",
    );
  });

  it("Table I problems are still errors", () => {
    const xml = fixtureXml("synthetic_table2_no_coding.xml").replace("<transactionCode>P</transactionCode>", "");
    expect(parseForm4(xml).ok).toBe(false);
  });
});
