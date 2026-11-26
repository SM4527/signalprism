import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { fixtureXml, loadForm4 } from "./fixtures";

const real = readdirSync(join(process.cwd(), "tests", "fixtures", "form4")).filter(
  (f) => f.endsWith(".xml") && !f.startsWith("synthetic_"),
);

describe("every real fixture parses", () => {
  it.each(real)("%s", (name) => {
    expect(parseForm4(fixtureXml(name)).ok).toBe(true);
  });
});

describe("real fixture details", () => {
  it("reads Cat: one director P line with a footnote", () => {
    const f = loadForm4("Cat_tm2629746-1_4seq1.xml");
    expect(f.tickerRaw).toBe("CAT");
    expect(f.issuerCik).toBe("0000018230");
    expect(f.owners).toHaveLength(1);
    expect(f.owners[0]).toMatchObject({ cik: "0001498535", role: "DIRECTOR", titleRaw: null });
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toMatchObject({
      table: 1, code: "P", txnDate: "2026-11-12", shares: "350", price: "596.10",
      ownedAfter: "8773", ownershipForm: "D", nature: "",
      footnotes: ["Includes adjustments for dividends accrued."],
    });
  });

  it("reads true/false booleans and a double-spaced title (GS)", () => {
    const f = loadForm4("GS_ownership.xml");
    expect(f.owners[0].isDirector).toBe(true);
    expect(f.plan10b51).toBe(false);
    expect(f.lines[0].securityTitle).toBe("Common  Stock, par value $0.001 per share");
  });

  it("keeps the 10b5-1 box and both tables (AMZN)", () => {
    const f = loadForm4("AMZN_form4.xml");
    expect(f.plan10b51).toBe(true);
    expect(f.lines.some((l) => l.table === 2)).toBe(true);
    expect(f.lines.some((l) => l.code === "M")).toBe(true);
  });

  it("reads indirect ownership with a nature (Googl)", () => {
    const f = loadForm4("Googl_ownership.xml");
    expect(f.lines.some((l) => l.ownershipForm === "I" && l.nature !== "")).toBe(true);
  });

  it("keeps the raw ticker BRK.A", () => {
    expect(loadForm4("BRK_ownership.xml").tickerRaw).toBe("BRK.A");
  });

  it("keeps an officer title and normalizes its role (MSFT)", () => {
    const o = loadForm4("MSFT_wk-form4_1795563957.xml").owners[0];
    expect(o.titleRaw).toBe("EVP, Chief Human Resources Off");
    expect(o.role).toBe("OTHER_OFFICER");
  });
});
