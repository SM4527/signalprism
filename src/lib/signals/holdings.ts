import Decimal from "decimal.js";
import type { Line } from "@/lib/sec/form4-types";

const bucketKey = (l: Line) => `${l.securityTitle}|${l.ownershipForm ?? ""}|${l.nature}`;

/**
 * Holdings before the buys, summed over (security, ownership form, nature) buckets.
 * Per bucket: the lowest `owned_after` among the P lines, minus that line's shares,
 * minus same-day Table I M shares in the bucket. A bucket cannot contribute below 0.
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
  return total;
}
