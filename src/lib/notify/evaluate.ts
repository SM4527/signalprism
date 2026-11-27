import type Database from "better-sqlite3";
import { loadNotificationConfig } from "@/lib/queries/rules";
import { peopleFirst } from "@/lib/queries/signals";
import { filingIndexUrl } from "@/lib/sec/links";
import { ROLES, type Role } from "@/lib/sec/roles";
import { detectClusters, insiderKeys } from "@/lib/signals/clusters";
import { addDays } from "@/lib/signals/dates";
import { loadIssuerRows, type SignalRow } from "@/lib/signals/issuer-rows";
import type { PlanKind } from "@/lib/signals/plan";
import { evaluateRule, loadRules, type AlertRule } from "@/lib/signals/rules";
import type { ScorePart } from "@/lib/signals/score";
import { formatClusterAlert, formatSignalAlert, type Alert, type PortfolioHint } from "./format";

/** A cluster pushes only when it holds an insider not seen in a cluster notification for the issuer in this many days. */
export const CLUSTER_MEMORY_DAYS = 60;

export interface EvaluateInput {
  issuerCik: string;
  /** Signals created by the filing just ingested. */
  newSignalIds: number[];
  /** Per amending signal id, the signal it replaced. */
  replaced: Map<number, SignalRow>;
  /** Amending signals whose value moved by more than 20% (or was unknown). */
  repushIds: number[];
  now: Date;
}

interface Full {
  id: number;
  filing_id: number;
  issuer_cik: string;
  owner_name: string;
  role: Role;
  title_raw: string | null;
  joint_group_id: string | null;
  shares: string;
  avg_price: string;
  value: string;
  pct_increase: string | null;
  new_position: number;
  txn_date: string;
  late: number;
  non_common: number;
  plan_kind: PlanKind | null;
  plan_suspected: number;
  indirect: number;
  score: number;
  score_parts_json: string | null;
  held_via: "direct" | "funds" | null;
  historical: number;
  superseded_by_filing_id: number | null;
  accession_no: string;
  filed_at: string;
  form_type: string;
  ticker: string | null;
  issuer_name: string | null;
}

const loadFull = (db: Database.Database, id: number) =>
  db
    .prepare(
      `SELECT s.*, o.owner_name, o.role, o.officer_title_raw AS title_raw, o.joint_group_id,
              f.accession_no, f.filed_at, f.form_type, coalesce(c.ticker, f.ticker) AS ticker, c.name AS issuer_name
       FROM signal s
       JOIN reporting_owner o ON o.id = s.owner_id
       JOIN filing f ON f.id = s.filing_id
       LEFT JOIN company c ON c.cik = s.issuer_cik
       WHERE s.id = ?`,
    )
    .get(id) as Full;

const jointKey = (filingId: number, group: string) => `${filingId}|${group}`;

/** True when the replaced original already has a signal notification. */
function wasAlerted(db: Database.Database, old: SignalRow): boolean {
  const pattern = old.joint_group_id ? `sig:%:${jointKey(old.filing_id, old.joint_group_id)}` : null;
  return !!db
    .prepare("SELECT 1 FROM notification_log WHERE kind = 'signal' AND (signal_id = ? OR dedup_key LIKE ?)")
    .get(old.id, pattern ?? "no match");
}

const insert = (db: Database.Database) =>
  db.prepare(
    `INSERT OR IGNORE INTO notification_log
       (kind, rule_id, signal_id, cluster_id, issuer_cik, insiders_json, dedup_key, status, priority, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?)`,
  );

const payload = (a: Alert) => JSON.stringify({ title: a.title, body: a.body, url: a.url, priority: a.priority });

/**
 * Decide what to notify after one filing: new live signals that match a rule (one per joint group, an amendment
 * only when it moved the value enough), and clusters that gained an insider. Rows are inserted as `held` with a
 * unique dedup key, in the caller's transaction; sending happens later. Historical signals never alert.
 * Returns the number of rows inserted.
 */
export function evaluateAlerts(db: Database.Database, input: EvaluateInput): number {
  const rules = loadRules(db).filter((r) => r.enabled);
  if (rules.length === 0) return 0;
  const hint = (loadNotificationConfig(db)?.portfolioHint ?? "off") as PortfolioHint;
  return signalAlerts(db, input, rules, hint) + clusterAlerts(db, input, rules, hint);
}

function signalAlerts(db: Database.Database, input: EvaluateInput, rules: AlertRule[], hint: PortfolioHint): number {
  const put = insert(db);
  const live = input.newSignalIds.map((id) => loadFull(db, id)).filter((r) => !r.historical && r.superseded_by_filing_id === null);
  const groups = Map.groupBy(live, (r) => (r.joint_group_id ? jointKey(r.filing_id, r.joint_group_id) : `${r.id}`));
  let inserted = 0;

  for (const members of groups.values()) {
    const head = members.reduce((a, b) => (ROLES.indexOf(b.role) < ROLES.indexOf(a.role) ? b : a));
    const old = members.map((m) => input.replaced.get(m.id)).find((o) => o !== undefined);
    // An amendment of something already pushed pushes again only when the value moved enough.
    if (old && wasAlerted(db, old) && !members.some((m) => input.repushIds.includes(m.id))) continue;

    const owners = peopleFirst([...new Set(members.map((m) => m.owner_name))]);
    const badges = [
      head.indirect ? "Indirect" : null,
      head.plan_suspected ? "10b5-1 suspected" : null,
      head.form_type === "4/A" ? "Amended" : null,
      db.prepare("SELECT 1 FROM cluster_member WHERE signal_id = ?").get(head.id) ? "Cluster" : null,
    ].filter((b): b is string => b !== null);
    const alert = formatSignalAlert(
      {
        ticker: head.ticker, issuerName: head.issuer_name, owners, role: head.role, titleRaw: head.title_raw,
        shares: head.shares, avgPrice: head.avg_price, value: head.value, pctIncrease: head.pct_increase,
        newPosition: !!head.new_position, txnDate: head.txn_date, filedAt: head.filed_at, score: head.score,
        parts: head.score_parts_json ? (JSON.parse(head.score_parts_json) as ScorePart[]) : [],
        heldVia: head.held_via, badges, url: filingIndexUrl(head.issuer_cik, head.accession_no),
      },
      hint,
    );

    for (const rule of rules) {
      const matches = evaluateRule(
        {
          role: head.role, value: head.value, pctIncrease: head.pct_increase, newPosition: !!head.new_position,
          late: !!head.late, nonCommon: !!head.non_common, planKind: head.plan_kind,
        },
        rule,
      ).matches;
      if (!matches) continue;
      const key = head.joint_group_id ? `sig:${rule.id}:${jointKey(head.filing_id, head.joint_group_id)}` : `sig:${rule.id}:${head.id}`;
      inserted += put.run("signal", rule.id, head.id, null, head.issuer_cik, null, key, alert.priority, payload(alert), input.now.toISOString()).changes;
    }
  }
  return inserted;
}

function clusterAlerts(db: Database.Database, input: EvaluateInput, rules: AlertRule[], hint: PortfolioHint): number {
  const clusterRules = rules.filter((r) => r.pushOnCluster);
  if (clusterRules.length === 0) return 0;
  const rows = loadIssuerRows(db, input.issuerCik);
  const keyOf = insiderKeys(rows);
  const put = insert(db);
  const since = addDays(input.now.toISOString().slice(0, 10), -CLUSTER_MEMORY_DAYS);
  const company = db.prepare("SELECT ticker, name FROM company WHERE cik = ?").get(input.issuerCik) as
    | { ticker: string; name: string | null }
    | undefined;
  const info = {
    ticker: company?.ticker ?? (db.prepare("SELECT ticker FROM filing WHERE issuer_cik = ? AND ticker IS NOT NULL LIMIT 1").pluck().get(input.issuerCik) as string | undefined) ?? null,
    name: company?.name ?? null,
  };
  let inserted = 0;

  for (const cluster of detectClusters(rows)) {
    if (!cluster.members.some((m) => !m.historical)) continue;
    const keys = [...new Set(cluster.members.map(keyOf))].sort();
    const newest = cluster.members.reduce((a, b) => (b.filed_at > a.filed_at || (b.filed_at === a.filed_at && b.id > a.id) ? b : a));
    const accession = db.prepare("SELECT accession_no FROM filing WHERE id = ?").pluck().get(newest.filing_id) as string;
    const clusterId = db.prepare("SELECT id FROM cluster WHERE issuer_cik = ? AND window_start = ?").pluck().get(input.issuerCik, cluster.windowStart) as number;

    for (const rule of clusterRules) {
      const seen = new Set(
        (
          db
            .prepare(
              "SELECT insiders_json FROM notification_log WHERE kind = 'cluster' AND issuer_cik = ? AND rule_id = ? AND created_at >= ?",
            )
            .pluck()
            .all(input.issuerCik, rule.id, since) as string[]
        ).flatMap((j) => JSON.parse(j) as string[]),
      );
      if (keys.every((k) => seen.has(k))) continue;

      const members = Map.groupBy(cluster.members, (m) => (m.joint_group_id ? jointKey(m.filing_id, m.joint_group_id) : `${m.id}`));
      const alert = formatClusterAlert(
        {
          ticker: info.ticker, issuerName: info.name, insiderCount: cluster.insiderCount, totalValue: cluster.totalValue,
          windowStart: cluster.windowStart, windowEnd: cluster.windowEnd,
          members: [...members.values()].map((g) => ({
            owners: peopleFirst([...new Set(g.map((m) => m.owner_name))]), role: g[0].role, value: g[0].value,
          })),
          heldVia: cluster.members[0].held_via, url: filingIndexUrl(input.issuerCik, accession),
        },
        hint,
      );
      // The window start keeps a later cluster of the same people (after the 60 days) from colliding with this key.
      const key = `cl:${rule.id}:${input.issuerCik}:${cluster.windowStart}:${keys.join("|")}`;
      const changes = put.run("cluster", rule.id, null, clusterId, input.issuerCik, JSON.stringify(keys), key, alert.priority, payload(alert), input.now.toISOString()).changes;
      if (changes) db.prepare("UPDATE cluster SET last_alerted_count = ? WHERE id = ?").run(cluster.insiderCount, clusterId);
      inserted += changes;
    }
  }
  return inserted;
}
