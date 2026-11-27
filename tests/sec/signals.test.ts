import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseForm4 } from "@/lib/sec/form4-parser";
import { normalizeTicker } from "@/lib/sec/ticker";
import { buildSignals, isNonCommon } from "@/lib/signals/signal-builder";
import { fixtureXml, loadForm4 } from "./fixtures";

const signals = (file: string, filedAt: string) => buildSignals(loadForm4(file), filedAt);
const one = (file: string, filedAt: string) => {
  const s = signals(file, filedAt);
  expect(s).toHaveLength(1);
  return s[0];
};

describe("real P fixtures (hand-checked)", () => {
  it("Cat: 350 x 596.10 = 208635, owned before 8423, +4.1553%", () => {
    const s = one("Cat_tm2629746-1_4seq1.xml", "2026-11-13");
    expect(s).toMatchObject({
      shares: "350", value: "208635", avgPrice: "596.1", ownedBefore: "8423",
      pctIncrease: "4.1553", newPosition: false, txnDate: "2026-11-12", lagDays: 1, late: false,
      nonCommon: false, indirect: false, planSuspected: false,
      footnotes: ["Includes adjustments for dividends accrued."],
    });
    expect(s.owner.role).toBe("DIRECTOR");
  });

  it("GS: 2004 x 9.0399 = 18115.9596, owned before 17671, +11.3406%", () => {
    const s = one("GS_ownership.xml", "2026-06-11");
    expect(s).toMatchObject({
      shares: "2004", value: "18115.9596", ownedBefore: "17671", pctIncrease: "11.3406", nonCommon: false,
    });
  });

  it("SPG: dividend-reinvestment P builds a DRIP plan signal with its footnote", () => {
    const s = one("SPG_form4-10012026_071044.xml", "2026-10-01");
    expect(s).toMatchObject({ value: "17844.64", ownedBefore: "8047", pctIncrease: "1.0936", planKind: "drip" });
    expect(s.footnotes[0]).toMatch(/reinvestment of dividends/);
  });
});

describe("M, A, C, F, S or G with no P gives no signal", () => {
  it.each([
    "MSFT_wk-form4_1795563957.xml", "Exxon_form4.xml", "NRG_doc4.xml", "JNJ_wk-form4_1794606870.xml",
    "AMZN_form4.xml", "BRK_ownership.xml", "Googl_ownership.xml", "JPMC_doc4.xml", "Meta_ownership.xml",
    "PG_form4.xml", "VZ_wk-form4_1795621978.xml", "Dow_wk-form4_1793220102.xml",
    "synthetic_conversion_no_p.xml",
  ])("%s", (file) => {
    expect(signals(file, "2027-01-04")).toEqual([]);
  });
});

describe("several P lines", () => {
  it("are summed into one signal; lag counts from the latest line (Mon+Wed, filed Fri: not late)", () => {
    const s = one("synthetic_ceo_multi_p.xml", "2026-11-06");
    expect(s).toMatchObject({
      shares: "3500", value: "35450", avgPrice: "10.128571", ownedBefore: "10000", pctIncrease: "35",
      txnDate: "2026-11-02", lastTxnDate: "2026-11-04", lagDays: 2, late: false,
    });
    expect(s.owner.role).toBe("CEO");
  });

  it("is late when even the latest line is more than 2 business days old", () => {
    expect(one("synthetic_ceo_multi_p.xml", "2026-11-10").late).toBe(true);
  });

  it("carries the weighted-average price footnote", () => {
    expect(one("synthetic_ceo_multi_p.xml", "2026-11-06").footnotes[0]).toMatch(/Weighted average price/);
  });
});

describe("P mixed with A, F and M", () => {
  it("counts only P; same-day Table I M lowers the baseline, Table II M does not", () => {
    const s = one("synthetic_p_mixed_codes.xml", "2026-11-10");
    expect(s).toMatchObject({ shares: "1000", value: "20000", ownedBefore: "10000", pctIncrease: "10" });
    expect(s.owner.role).toBe("CFO");
  });
});

describe("pctIncrease is a percentage", () => {
  const atLeast = (pct: string | null, min: string) => pct !== null && new Decimal(pct).gte(min);

  it("10.0 passes a 10% threshold", () => {
    const s = one("synthetic_p_mixed_codes.xml", "2026-11-10");
    expect(s.pctIncrease).toBe("10");
    expect(atLeast(s.pctIncrease, "10")).toBe(true);
  });

  it("0.10 does not pass a 10% threshold", () => {
    const form = structuredClone(loadForm4("synthetic_p_mixed_codes.xml"));
    // 1000 bought on 1,000,000 held before (the same-day 5000 M is also removed): +0.1%.
    form.lines.find((l) => l.code === "P")!.ownedAfter = "1006000";
    const s = buildSignals(form, "2026-11-10")[0];
    expect(s.pctIncrease).toBe("0.1");
    expect(atLeast(s.pctIncrease, "10")).toBe(false);
  });
});

describe("new position", () => {
  it("is flagged with no percentage and no division", () => {
    const s = one("synthetic_new_position.xml", "2026-10-07");
    expect(s).toMatchObject({ shares: "2000", value: "51000", ownedBefore: "0", pctIncrease: null, newPosition: true });
    expect(s.owner.role).toBe("CFO");
    expect(s.nonCommon).toBe(false);
  });
});

describe("joint filers", () => {
  it("give one signal per owner linked by jointGroupId", () => {
    const s = signals("synthetic_joint_filers.xml", "2026-09-16");
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.owner.cik)).toEqual(["0009100004", "0009100005"]);
    expect(new Set(s.map((x) => x.jointGroupId))).toEqual(new Set(["joint:0009100004+0009100005"]));
    expect(s[0]).toMatchObject({ value: "50000", ownedBefore: "500000", pctIncrease: "2", indirect: true });
    expect(s[0].owner.role).toBe("HOLDER_10PCT");
  });

  it("a single owner has no jointGroupId", () => {
    expect(one("Cat_tm2629746-1_4seq1.xml", "2026-11-13").jointGroupId).toBeNull();
  });
});

describe("direct vs indirect buckets", () => {
  it("keeps direct, trust and spouse holdings in separate buckets", () => {
    const s = one("synthetic_indirect_natures.xml", "2026-10-14");
    expect(s).toMatchObject({
      shares: "600", value: "30000", ownedBefore: "8500", pctIncrease: "7.0588", indirect: true,
    });
    expect(s.owner.role).toBe("CEO");
  });
});

describe("holiday week", () => {
  it("does not flag a Thanksgiving-week buy as late", () => {
    expect(one("synthetic_holiday_week.xml", "2026-11-30")).toMatchObject({ lagDays: 2, late: false });
  });

  it("flags it once a real business day more has passed", () => {
    expect(one("synthetic_holiday_week.xml", "2026-12-01")).toMatchObject({ lagDays: 3, late: true });
  });
});

describe("price missing", () => {
  it("is stored with no price and never builds a signal", () => {
    const f = loadForm4("synthetic_no_price.xml");
    expect(f.lines[0]).toMatchObject({ code: "P", shares: "1000", price: null });
    expect(buildSignals(f, "2026-10-21")).toEqual([]);
  });
});

describe("10b5-1", () => {
  it("a ticked box still builds a signal, with plan kind 10b5-1", () => {
    const f = loadForm4("synthetic_p_10b5_box.xml");
    expect(f.plan10b51).toBe(true);
    const [s] = buildSignals(f, "2026-10-22");
    expect(s.planKind).toBe("10b5-1");
    expect(s.planSuspected).toBe(false);
    expect(Number(s.value)).toBeGreaterThan(0);
  });

  it("without the box the flag is false", () => {
    expect(one("Cat_tm2629746-1_4seq1.xml", "2026-11-13").planKind).toBeNull();
  });

  it("a footnote mention only sets planSuspected", () => {
    const s = one("synthetic_p_10b5_footnote.xml", "2026-10-23");
    expect(s.planSuspected).toBe(true);
    expect(s.value).toBe("12500");
  });

  it("is not suspected without a mention", () => {
    expect(one("Cat_tm2629746-1_4seq1.xml", "2026-11-13").planSuspected).toBe(false);
  });
});

describe("Form 4/A", () => {
  it("is parsed as an amendment and still builds its signal", () => {
    const f = loadForm4("synthetic_amendment_4a.xml");
    expect(f.formType).toBe("4/A");
    expect(buildSignals(f, "2026-10-26")[0].value).toBe("12000");
  });
});

describe("ticker", () => {
  it("falls back to the CIK map for NONE", () => {
    const f = loadForm4("synthetic_ticker_none.xml");
    expect(f.tickerRaw).toBe("NONE");
    expect(normalizeTicker(f.tickerRaw, f.issuerCik, new Map([["0009000007", "GRNT"]]))).toBe("GRNT");
  });

  it("normalizes the real BRK.A", () => {
    const f = loadForm4("BRK_ownership.xml");
    expect(normalizeTicker(f.tickerRaw, f.issuerCik)).toBe("BRK-A");
  });
});

describe("non-common security", () => {
  it("badges a preferred stock purchase", () => {
    expect(one("synthetic_non_common.xml", "2026-10-16").nonCommon).toBe(true);
  });

  it.each([
    "Common Stock", "Class A Common Shares", "Class A Shares", "Ordinary Shares",
    "Shares of Beneficial Interest", "Common  Stock, par value $0.001 per share",
  ])("%s is common", (title) => {
    expect(isNonCommon(title)).toBe(false);
  });

  it.each([
    "Series A Preferred Stock", "Warrants", "Convertible Notes due 2030", "Debentures",
    "Limited Partnership Units", "Subscription Rights", "Employee Stock Option",
  ])("%s is non-common", (title) => {
    expect(isNonCommon(title)).toBe(true);
  });
});

describe("parse errors", () => {
  it("malformed XML becomes an error, not a throw", () => {
    const r = parseForm4(fixtureXml("synthetic_malformed.xml"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/malformed/);
  });

  it("valid XML with a missing issuer becomes an error", () => {
    expect(parseForm4(fixtureXml("synthetic_missing_issuer.xml")).ok).toBe(false);
  });

  it("garbage input becomes an error", () => {
    expect(parseForm4("not xml at all").ok).toBe(false);
    expect(parseForm4("").ok).toBe(false);
  });
});
