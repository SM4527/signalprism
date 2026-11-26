import Decimal from "decimal.js";
import { HOLDING_TABLE, type Line } from "@/lib/sec/form4-types";

const bucketKey = (l: Line) => `${l.securityTitle}|${l.ownershipForm ?? ""}|${l.nature}`;

/** Case and spacing do not tell two securities apart. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normBucket = (l: Line) => `${norm(l.securityTitle)}|${l.ownershipForm ?? ""}|${norm(l.nature)}`;

/**
 * Holdings before the buys: the sum of
 * 1. per (security, ownership form, nature) bucket with P lines: the lowest `owned_after` among the P lines,
 *    minus that line's shares, minus same-day Table I M shares in the bucket, never below 0; and
 * 2. shares owned in `nonDerivativeHolding` rows of the same security (normalized title) that are not one of
 *    those buckets, so holdings reported elsewhere in the filing count too.
 * Returns null when a P line has no `owned_after`.
 */
export function ownedBefore(lines: Line[], purchases: Line[]): Decimal | null {
  const table1 = lines.filter((l) => l.table === 1);
  const buckets = Map.groupBy(purchases, bucketKey);
  let total = new Decimal(0);
  for (const [key, bucket] of buckets) {
    if (bucket.some((l) => l.ownedAfter === null)) return null;
    const lowest = bucket.reduce((a, b) =>
      new Decimal(b.ownedAfter!).lt(a.ownedAfter!) ? b : a,
    );
    const exercised = table1
      .filter((l) => l.code === "M" && bucketKey(l) === key && l.txnDate === lowest.txnDate)
      .reduce((sum, l) => sum.plus(l.shares ?? 0), new Decimal(0));
    const before = new Decimal(lowest.ownedAfter!).minus(lowest.shares!).minus(exercised);
    total = total.plus(Decimal.max(before, 0));
  }

  const securities = new Set(purchases.map((l) => norm(l.securityTitle)));
  const boughtBuckets = new Set(purchases.map(normBucket));
  for (const h of lines) {
    if (h.table !== HOLDING_TABLE || h.ownedAfter === null) continue;
    if (!securities.has(norm(h.securityTitle)) || boughtBuckets.has(normBucket(h))) continue;
    total = total.plus(Decimal.max(h.ownedAfter, 0));
  }
  return total;
}
