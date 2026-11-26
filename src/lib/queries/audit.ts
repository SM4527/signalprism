import Decimal from "decimal.js";
import type { AuditLine } from "./signals";

export interface AuditGroup {
  filedAt: string;
  accession: string;
  ownerName: string;
  /** Distinct codes in line order; empty for holding rows only. */
  codes: string[];
  /** Σ shares of the lines that have shares, or null when none do. */
  totalShares: string | null;
  /** Σ(shares × price) ÷ Σ shares over the lines that have both, 6 decimals, or null. */
  avgPrice: string | null;
  reasons: string[];
  lines: AuditLine[];
}

const distinct = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** One group per filing and owner, in the order the lines come (newest filed first). */
export function groupAudit(lines: AuditLine[]): AuditGroup[] {
  const groups = new Map<string, AuditLine[]>();
  for (const l of lines) {
    const key = `${l.accession}|${l.ownerName}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()].map((ls) => {
    const withShares = ls.filter((l) => l.shares !== null);
    const priced = withShares.filter((l) => l.price !== null);
    const pricedShares = priced.reduce((s, l) => s.plus(l.shares!), new Decimal(0));
    const cost = priced.reduce((s, l) => s.plus(new Decimal(l.shares!).times(l.price!)), new Decimal(0));
    return {
      filedAt: ls[0].filedAt,
      accession: ls[0].accession,
      ownerName: ls[0].ownerName,
      codes: distinct(ls.map((l) => l.code ?? "")),
      totalShares: withShares.length ? withShares.reduce((s, l) => s.plus(l.shares!), new Decimal(0)).toFixed() : null,
      avgPrice: pricedShares.gt(0) ? cost.div(pricedShares).toDecimalPlaces(6).toFixed() : null,
      reasons: distinct(ls.map((l) => l.why)),
      lines: ls,
    };
  });
}
