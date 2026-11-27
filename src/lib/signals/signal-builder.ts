import Decimal from "decimal.js";
import type { Line, Owner, ParsedForm4 } from "@/lib/sec/form4-types";
import { isLate, lagDays } from "@/lib/sec/lag";
import { ownedBefore } from "./holdings";
import { planKindOfFootnotes, type PlanKind } from "./plan";

/** Anything not matching is common: Common Stock, Class A Shares, Ordinary Shares, Beneficial Interest. */
const NON_COMMON = /preferred|warrant|note|debenture|\bunits?\b|\brights?\b|option/i;

export const isNonCommon = (securityTitle: string) => NON_COMMON.test(securityTitle);

export interface Signal {
  owner: Owner;
  jointGroupId: string | null;
  /**
   * Decimal strings. `pctIncrease` is a percentage, not a fraction: "4.1553" means 4.1553%,
   * so a "10% increase" threshold is 10, never 0.10.
   */
  shares: string;
  value: string;
  avgPrice: string;
  ownedBefore: string | null;
  pctIncrease: string | null;
  newPosition: boolean;
  /** Earliest qualifying line: display and the 12-month lookback. */
  txnDate: string;
  /** Latest qualifying line: what lag and lateness are measured from. */
  lastTxnDate: string;
  lagDays: number;
  late: boolean;
  /**
   * Set when every qualifying P line is a non-discretionary plan buy (10b5-1 box, ESPP, DRIP, 401(k)).
   * Shown with a badge, never alerted, never in a cluster, no first-buy points.
   */
  planKind: PlanKind | null;
  planSuspected: boolean;
  nonCommon: boolean;
  indirect: boolean;
  footnotes: string[];
}

const isPurchase = (l: Line) => l.table === 1 && l.code === "P" && l.shares !== null && l.price !== null;

/** Table I, code P, with shares and a price. Plan buys are included; see `selectBuys`. */
export function purchaseLines(form: ParsedForm4): Line[] {
  return form.lines.filter(isPurchase);
}

const PLAN_PRIORITY: PlanKind[] = ["10b5-1", "espp", "drip", "401k"];

/**
 * The lines a signal is built from. A ticked 10b5-1 box makes every line a plan line (it keeps priority);
 * otherwise a line is a plan line when its footnotes say ESPP, DRIP or 401(k). If any discretionary line
 * exists the signal is built from those alone (plan lines stay in the audit trail); only when all lines
 * are plan lines is the signal a plan buy. Null when there is no qualifying line.
 */
export function selectBuys(lines: Line[], box: boolean): { buys: Line[]; planKind: PlanKind | null } | null {
  const qualifying = lines.filter(isPurchase);
  if (qualifying.length === 0) return null;
  const kindOf = (l: Line): PlanKind | null => (box ? "10b5-1" : planKindOfFootnotes(l.footnotes));
  const discretionary = qualifying.filter((l) => kindOf(l) === null);
  if (discretionary.length > 0) return { buys: discretionary, planKind: null };
  const kinds = new Set(qualifying.map((l) => kindOf(l)));
  return { buys: qualifying, planKind: PLAN_PRIORITY.find((k) => kinds.has(k))! };
}

/** The numbers of one signal, computed from the chosen buys and all lines of the filing. */
export function summarizeBuys(lines: Line[], buys: Line[], filedAt: string) {
  const shares = buys.reduce((s, l) => s.plus(l.shares!), new Decimal(0));
  const value = buys.reduce((s, l) => s.plus(new Decimal(l.shares!).times(l.price!)), new Decimal(0));
  const before = ownedBefore(lines, buys);
  const newPosition = before !== null && before.lte(0);
  const dates = buys.map((l) => l.txnDate).sort();
  const lag = lagDays(dates[dates.length - 1], filedAt);
  return {
    shares: shares.toFixed(),
    value: value.toFixed(),
    avgPrice: value.div(shares).toDecimalPlaces(6).toFixed(),
    ownedBefore: before?.toFixed() ?? null,
    pctIncrease:
      before === null || newPosition ? null : shares.div(before).times(100).toDecimalPlaces(4).toFixed(),
    newPosition,
    txnDate: dates[0],
    lastTxnDate: dates[dates.length - 1],
    lagDays: lag,
    late: isLate(lag),
    nonCommon: buys.some((l) => isNonCommon(l.securityTitle)),
    indirect: buys.some((l) => l.ownershipForm === "I"),
    footnotes: [...new Set(buys.flatMap((l) => l.footnotes))],
  };
}

/** One signal per reporting owner for the filing's qualifying purchases, or none. */
export function buildSignals(form: ParsedForm4, filedAt: string): Signal[] {
  const picked = selectBuys(form.lines, form.plan10b51);
  if (!picked) return [];
  const numbers = summarizeBuys(form.lines, picked.buys, filedAt);
  return form.owners.map((owner) => ({
    owner,
    jointGroupId: owner.jointGroupId,
    ...numbers,
    planKind: picked.planKind,
    planSuspected: form.planSuspected,
  }));
}
