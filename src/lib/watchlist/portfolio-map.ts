import Decimal from "decimal.js";
import { normalizeTicker } from "../sec/ticker.ts";
import type { FolioData } from "./folioprism.ts";

export const FUND_STOCK_CAP = 25;

export interface FundExposure {
  fund: string;
  pct: string;
}

/** Ticker (normalized) to how it is held. `direct` stocks and capped `viaFunds` stocks; funds themselves are never in it. */
export interface PortfolioMap {
  direct: Set<string>;
  viaFunds: Map<string, FundExposure[]>;
  /** Holdings with no coverage item in the analysis: neither stock nor fund can be told, so they are skipped. */
  noCoverage: string[];
}

const norm = (t: string) => normalizeTicker(t, "") ?? t.toUpperCase();
const total = (f: FundExposure[]) => f.reduce((s, x) => s.plus(x.pct), new Decimal(0));

/**
 * Decide stock vs fund from FolioPrism's own data: a holding is a direct stock when its coverage item has
 * source "direct", a fund when it has any other source. A holding with no coverage item is skipped.
 * Fund stocks come from the Top 50 intersection (children from a fund), the top 25 by fund exposure
 * among stocks not already held directly.
 */
export function buildPortfolioMap(data: FolioData, cap = FUND_STOCK_CAP): PortfolioMap {
  const source = new Map(data.analysis.intersection.coverage.items.map((i) => [norm(i.ticker), i.source]));
  const direct = new Set(data.holdings.map((h) => norm(h.ticker)).filter((t) => source.get(t) === "direct"));
  const isFund = (t: string) => source.has(t) && source.get(t) !== "direct";

  const candidates = data.analysis.intersection.rows
    .map((r) => ({
      ticker: norm(r.ticker),
      funds: r.children.filter((c) => isFund(norm(c.sourceTicker))).map((c) => ({ fund: norm(c.sourceTicker), pct: c.portfolioPct })),
    }))
    .filter((r) => r.funds.length > 0 && !direct.has(r.ticker) && !isFund(r.ticker))
    .sort((a, b) => total(b.funds).comparedTo(total(a.funds)));

  const noCoverage = [...new Set(data.holdings.map((h) => norm(h.ticker)).filter((t) => !source.has(t)))].sort();
  return { direct, viaFunds: new Map(candidates.slice(0, cap).map((r) => [r.ticker, r.funds])), noCoverage };
}
