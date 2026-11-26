import { toId } from "@/lib/store/rowid";
import type Database from "better-sqlite3";
import type { Signal } from "./signal-builder";

/** Insert one signal row per owner; returns the new signal ids in owner order. Score comes later. */
export function persistSignals(
  db: Database.Database,
  filingId: number,
  issuerCik: string,
  ownerIds: number[],
  signals: Signal[],
): number[] {
  const insert = db.prepare(
    `INSERT INTO signal
       (filing_id, owner_id, issuer_cik, txn_date, shares, value, avg_price, owned_before, pct_increase,
        new_position, lag_days, late, plan_suspected, non_common, indirect, footnotes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return signals.map((s, i) =>
    toId(
      insert.run(
        filingId, ownerIds[i], issuerCik, s.txnDate, s.shares, s.value, s.avgPrice, s.ownedBefore,
        s.pctIncrease, +s.newPosition, s.lagDays, +s.late, +s.planSuspected, +s.nonCommon, +s.indirect,
        JSON.stringify(s.footnotes),
      ).lastInsertRowid,
    ),
  );
}
