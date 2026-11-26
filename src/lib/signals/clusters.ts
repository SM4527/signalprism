import type Database from "better-sqlite3";
import Decimal from "decimal.js";
import { addDays } from "./dates";
import { isLive, isOfficerRole, personKey, type SignalRow } from "./issuer-rows";

export const CLUSTER_DAYS = 30;

export interface ClusterCandidate {
  windowStart: string;
  windowEnd: string;
  members: SignalRow[];
  insiderCount: number;
  totalValue: string;
}

/** Roles that can form a cluster. OTHER and HOLDER_10PCT never count. */
const ELIGIBLE = new Set(["CEO", "CFO", "COO", "PRESIDENT", "OTHER_OFFICER", "DIRECTOR"]);

/**
 * Deterministic grouping: sort eligible signals by txn_date; a window starts at the earliest unassigned
 * signal and takes every signal within 30 days of it; the next signal starts a new window. A window is a
 * cluster when it has 2+ distinct insiders and at least one officer.
 */
export function detectClusters(rows: SignalRow[]): ClusterCandidate[] {
  const insiderOf = insiderComponents(rows);
  const eligible = rows
    .filter((r) => isLive(r) && ELIGIBLE.has(r.role))
    .sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.id - b.id);

  const clusters: ClusterCandidate[] = [];
  let i = 0;
  while (i < eligible.length) {
    const start = eligible[i].txn_date;
    const limit = addDays(start, CLUSTER_DAYS);
    const members: SignalRow[] = [];
    while (i < eligible.length && eligible[i].txn_date <= limit) members.push(eligible[i++]);

    const insiders = new Set(members.map((m) => insiderOf(m)));
    if (insiders.size >= 2 && members.some((m) => isOfficerRole(m.role))) {
      clusters.push({
        windowStart: start,
        windowEnd: members[members.length - 1].txn_date,
        members,
        insiderCount: insiders.size,
        totalValue: totalValue(members),
      });
    }
  }
  return clusters;
}

/**
 * Who counts as one insider: connected components over owner keys (CIK, else normalized name). Owners of
 * the same joint group are linked, so a person who files once jointly and once alone is one insider.
 */
function insiderComponents(rows: SignalRow[]): (r: SignalRow) => string {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    const p = parent.get(k)!;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  for (const r of rows) {
    const key = personKey(r);
    find(key);
    if (r.joint_group_id) parent.set(find(key), find(`group:${r.joint_group_id}`));
  }
  return (r) => find(personKey(r));
}

/** Sum of member values; a joint filing's identical rows count once. */
function totalValue(members: SignalRow[]): string {
  const seen = new Set<string>();
  let sum = new Decimal(0);
  for (const m of members) {
    const key = m.joint_group_id ? `${m.filing_id}|${m.joint_group_id}` : `signal|${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sum = sum.plus(m.value);
  }
  return sum.toFixed();
}

/** Replace the issuer's clusters with the candidates; a kept key keeps its `last_alerted_count`. */
export function saveClusters(db: Database.Database, issuerCik: string, found: ClusterCandidate[]): void {
  const keep = new Set(found.map((c) => c.windowStart));
  const existing = db
    .prepare("SELECT id, window_start FROM cluster WHERE issuer_cik = ?")
    .all(issuerCik) as { id: number; window_start: string }[];

  for (const c of existing) {
    db.prepare("DELETE FROM cluster_member WHERE cluster_id = ?").run(c.id);
    if (!keep.has(c.window_start)) db.prepare("DELETE FROM cluster WHERE id = ?").run(c.id);
  }
  for (const c of found) {
    db.prepare(
      `INSERT INTO cluster (issuer_cik, window_start, window_end, insider_count, total_value)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (issuer_cik, window_start) DO UPDATE SET
         window_end = excluded.window_end, insider_count = excluded.insider_count,
         total_value = excluded.total_value`,
    ).run(issuerCik, c.windowStart, c.windowEnd, c.insiderCount, c.totalValue);
    const id = db
      .prepare("SELECT id FROM cluster WHERE issuer_cik = ? AND window_start = ?")
      .pluck()
      .get(issuerCik, c.windowStart) as number;
    for (const m of c.members) db.prepare("INSERT INTO cluster_member VALUES (?, ?)").run(id, m.id);
  }
}
