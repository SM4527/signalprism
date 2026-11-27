import type Database from "better-sqlite3";
import { HOLDING_TABLE, type Line } from "@/lib/sec/form4-types";
import { recomputeIssuer } from "./recompute";
import { selectBuys, summarizeBuys } from "./signal-builder";

/** Bump the suffix when the footnote patterns change, so the step runs again on stored data. */
const TASK = "plan-kind-from-footnotes-v2";

interface LineRow {
  seq: number;
  table_no: number | string;
  security_title: string | null;
  code: string | null;
  txn_date: string | null;
  shares: string | null;
  price: string | null;
  acquired_disposed: string | null;
  owned_after: string | null;
  ownership_form: string | null;
  nature_of_ownership: string | null;
  plan_10b51: number;
  footnotes_json: string | null;
}

const toLine = (r: LineRow): Line => ({
  table: r.table_no === HOLDING_TABLE ? HOLDING_TABLE : (r.table_no === 2 ? 2 : 1),
  seq: r.seq,
  securityTitle: r.security_title ?? "",
  code: r.code ?? "",
  txnDate: r.txn_date ?? "",
  shares: r.shares,
  price: r.price,
  acquiredDisposed: r.acquired_disposed,
  ownedAfter: r.owned_after,
  ownershipForm: r.ownership_form,
  nature: r.nature_of_ownership ?? "",
  footnotes: r.footnotes_json ? (JSON.parse(r.footnotes_json) as string[]) : [],
});

/**
 * One-time step for data stored before `plan_kind` existed: classify each filing's purchases from the
 * stored line footnotes, rebuild the signals of filings where that changes anything (all plan lines, or a
 * mix of plan and discretionary lines), then recompute clusters and scores of the affected issuers.
 * Filings whose lines are all discretionary are left as they are. No re-fetch; the XML is not needed.
 * Returns the number of filings changed; later calls do nothing.
 */
export function reclassifyPlanBuys(db: Database.Database, today: string): number {
  if (db.prepare("SELECT 1 FROM maintenance_done WHERE name = ?").get(TASK)) return 0;
  const issuers = new Set<string>();
  let changed = 0;

  db.transaction(() => {
    const filings = db
      .prepare(
        `SELECT DISTINCT f.id, f.issuer_cik, f.filed_at FROM filing f JOIN signal s ON s.filing_id = f.id`,
      )
      .all() as { id: number; issuer_cik: string; filed_at: string }[];
    const readLines = db.prepare("SELECT * FROM transaction_line WHERE filing_id = ? ORDER BY seq");
    const update = db.prepare(
      `UPDATE signal SET shares = ?, value = ?, avg_price = ?, owned_before = ?, pct_increase = ?, new_position = ?,
              txn_date = ?, lag_days = ?, late = ?, non_common = ?, indirect = ?, footnotes_json = ?, plan_kind = ?
       WHERE filing_id = ?`,
    );
    for (const f of filings) {
      const rows = readLines.all(f.id) as LineRow[];
      const lines = rows.map(toLine);
      const box = rows.some((r) => r.plan_10b51 === 1);
      const picked = selectBuys(lines, box);
      if (!picked) continue;
      const stored = db.prepare("SELECT plan_kind FROM signal WHERE filing_id = ? LIMIT 1").pluck().get(f.id) as string | null;
      const allQualifying = selectBuys(lines, true)!.buys.length;
      if (picked.planKind === stored && picked.buys.length === allQualifying) continue;

      const n = summarizeBuys(lines, picked.buys, f.filed_at);
      update.run(
        n.shares, n.value, n.avgPrice, n.ownedBefore, n.pctIncrease, +n.newPosition, n.txnDate, n.lagDays, +n.late,
        +n.nonCommon, +n.indirect, JSON.stringify(n.footnotes), picked.planKind, f.id,
      );
      issuers.add(f.issuer_cik);
      changed++;
    }
    for (const cik of issuers) recomputeIssuer(db, cik, today);
    db.prepare("INSERT INTO maintenance_done (name, done_at) VALUES (?, ?)").run(TASK, new Date().toISOString());
  })();
  return changed;
}
