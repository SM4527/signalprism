import type Database from "better-sqlite3";
import type { Role } from "@/lib/sec/roles";

export interface ClusterDetail {
  ticker: string | null;
  company: string | null;
  windowStart: string;
  windowEnd: string;
  insiderCount: number;
  totalValue: string;
  heldVia: "direct" | "funds" | null;
  members: { insider: string; role: Role; value: string; txnDate: string }[];
}

/** Clusters whose window ended on or after `since`, newest first, with their member purchases. */
export function clustersSince(db: Database.Database, since: string, issuerCik?: string): ClusterDetail[] {
  const clusters = db
    .prepare(
      `SELECT k.id, c.ticker, c.name, c.in_direct, c.in_funds, k.window_start, k.window_end, k.insider_count, k.total_value
       FROM cluster k LEFT JOIN company c ON c.cik = k.issuer_cik
       WHERE k.window_end >= ? AND (? IS NULL OR k.issuer_cik = ?)
       ORDER BY k.window_end DESC, k.id DESC`,
    )
    .all(since, issuerCik ?? null, issuerCik ?? null) as Record<string, string | number | null>[];
  const members = db.prepare(
    `SELECT o.owner_name, o.role, s.value, s.txn_date
     FROM cluster_member m JOIN signal s ON s.id = m.signal_id JOIN reporting_owner o ON o.id = s.owner_id
     WHERE m.cluster_id = ? ORDER BY s.txn_date, o.owner_name`,
  );
  return clusters.map((k) => ({
    ticker: k.ticker as string | null,
    company: k.name as string | null,
    windowStart: k.window_start as string,
    windowEnd: k.window_end as string,
    insiderCount: k.insider_count as number,
    totalValue: k.total_value as string,
    heldVia: k.in_direct ? "direct" : k.in_funds ? "funds" : null,
    members: (members.all(k.id) as Record<string, string>[]).map((m) => ({
      insider: m.owner_name, role: m.role as Role, value: m.value, txnDate: m.txn_date,
    })),
  }));
}
