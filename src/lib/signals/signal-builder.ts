import Decimal from "decimal.js";
import type { Line, Owner, ParsedForm4 } from "@/lib/sec/form4-types";
import { isLate, lagDays } from "@/lib/sec/lag";
import { ownedBefore } from "./holdings";

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
  /** The 10b5-1 box is ticked: a planned buying program. Shown, never alerted, never in a cluster. */
  plan10b51: boolean;
  planSuspected: boolean;
  nonCommon: boolean;
  indirect: boolean;
  footnotes: string[];
}

/** Table I, code P, with shares and a price. A ticked 10b5-1 box still makes a signal, flagged `plan10b51`. */
export function purchaseLines(form: ParsedForm4): Line[] {
  return form.lines.filter(
    (l) => l.table === 1 && l.code === "P" && l.shares !== null && l.price !== null,
  );
}

/** One signal per reporting owner for the filing's qualifying purchases, or none. */
export function buildSignals(form: ParsedForm4, filedAt: string): Signal[] {
  const buys = purchaseLines(form);
  if (buys.length === 0) return [];

  const shares = buys.reduce((s, l) => s.plus(l.shares!), new Decimal(0));
  const value = buys.reduce((s, l) => s.plus(new Decimal(l.shares!).times(l.price!)), new Decimal(0));
  const before = ownedBefore(form.lines, buys);
  const newPosition = before !== null && before.lte(0);
  const dates = buys.map((l) => l.txnDate).sort();
  const lag = lagDays(dates[dates.length - 1], filedAt);

  return form.owners.map((owner) => ({
    owner,
    jointGroupId: owner.jointGroupId,
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
    plan10b51: form.plan10b51,
    planSuspected: form.planSuspected,
    nonCommon: buys.some((l) => isNonCommon(l.securityTitle)),
    indirect: buys.some((l) => l.ownershipForm === "I"),
    footnotes: [...new Set(buys.flatMap((l) => l.footnotes))],
  }));
}
