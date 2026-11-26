import type Database from "better-sqlite3";
import { detectClusters, saveClusters } from "./clusters";
import { monthsBefore } from "./dates";
import { isLive, loadIssuerRows, personKey, type SignalRow } from "./issuer-rows";
import { scoreSignal } from "./score";
import { recomputeSupersession } from "./supersede";

export const RESCORE_MONTHS = 13;
const FIRST_BUY_MONTHS = 12;

/** True when this person has no other live signal at the issuer in the 12 months before this one. */
function isFirstBuy(r: SignalRow, live: SignalRow[]): boolean {
  const from = monthsBefore(r.txn_date, FIRST_BUY_MONTHS);
  const me = personKey(r);
  return !live.some((o) => o.id !== r.id && personKey(o) === me && o.txn_date >= from && o.txn_date < r.txn_date);
}

/**
 * Recompute one issuer from scratch: amendments, clusters, then scores for live signals whose txn_date is
 * within 13 months of `anchorDate`. Nothing is incremental, so ingest order cannot change the result.
 * Returns, per amending signal id, the signal it replaced.
 */
export function recomputeIssuer(db: Database.Database, issuerCik: string, anchorDate: string) {
  const rows = loadIssuerRows(db, issuerCik);
  const replaced = recomputeSupersession(db, issuerCik, rows);
  const clusters = detectClusters(rows);
  saveClusters(db, issuerCik, clusters);

  const inCluster = new Set(clusters.flatMap((c) => c.members.map((m) => m.id)));
  const live = rows.filter(isLive);
  const from = monthsBefore(anchorDate, RESCORE_MONTHS);
  const update = db.prepare("UPDATE signal SET score = ?, score_parts_json = ? WHERE id = ?");
  for (const r of rows.filter((r) => !isLive(r))) update.run(0, null, r.id);
  for (const r of live.filter((r) => r.txn_date >= from)) {
    const { score, parts } = scoreSignal({
      role: r.role,
      value: r.value,
      pctIncrease: r.pct_increase,
      newPosition: !!r.new_position,
      late: !!r.late,
      planSuspected: !!r.plan_suspected,
      heldVia: r.held_via,
      inCluster: inCluster.has(r.id),
      firstBuy: isFirstBuy(r, live),
    });
    update.run(score, JSON.stringify(parts), r.id);
  }
  return { replaced, rows };
}
