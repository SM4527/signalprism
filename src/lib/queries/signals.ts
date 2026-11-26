import type Database from "better-sqlite3";
import { ROLES, type Role } from "@/lib/sec/roles";
import { addDays } from "@/lib/signals/dates";
import { evaluateRule, loadRules } from "@/lib/signals/rules";
import type { ScorePart } from "@/lib/signals/score";

export const MAX_ROWS = 200;
export const DEFAULT_DAYS = 30;

export interface SignalFilters {
  /** Filed within this many days before today. */
  days: number;
  minScore: number;
  role: Role | null;
  heldOnly: boolean;
  matchesRule: boolean;
  sort: "filed" | "score";
}

export const DEFAULT_FILTERS: SignalFilters = {
  days: DEFAULT_DAYS, minScore: 0, role: null, heldOnly: false, matchesRule: false, sort: "filed",
};

export interface SignalListRow {
  id: number;
  ticker: string | null;
  issuerName: string | null;
  issuerCik: string;
  ownerName: string;
  role: Role;
  titleRaw: string | null;
  shares: string;
  value: string;
  avgPrice: string;
  pctIncrease: string | null;
  newPosition: boolean;
  txnDate: string;
  filedAt: string;
  formType: string;
  accession: string;
  score: number;
  parts: ScorePart[];
  late: boolean;
  indirect: boolean;
  nonCommon: boolean;
  planSuspected: boolean;
  heldVia: "direct" | "funds" | null;
  inCluster: boolean;
  footnotes: string[];
  matchesRule: boolean;
}

const SELECT = `
  SELECT s.id, c.ticker, c.name AS issuer_name, s.issuer_cik, o.owner_name, o.role, o.officer_title_raw AS title_raw,
         s.shares, s.value, s.avg_price, s.pct_increase, s.new_position, s.txn_date, f.filed_at, f.form_type,
         f.accession_no, s.score, s.score_parts_json, s.late, s.indirect, s.non_common, s.plan_suspected,
         s.held_via, s.footnotes_json,
         EXISTS (SELECT 1 FROM cluster_member m WHERE m.signal_id = s.id) AS in_cluster
  FROM signal s
  JOIN reporting_owner o ON o.id = s.owner_id
  JOIN filing f ON f.id = s.filing_id
  LEFT JOIN company c ON c.cik = s.issuer_cik
  WHERE s.superseded_by_filing_id IS NULL`;

function toRow(r: Record<string, string | number | null>, matches: boolean): SignalListRow {
  return {
    id: r.id as number,
    ticker: r.ticker as string | null,
    issuerName: r.issuer_name as string | null,
    issuerCik: r.issuer_cik as string,
    ownerName: r.owner_name as string,
    role: r.role as Role,
    titleRaw: r.title_raw as string | null,
    shares: r.shares as string,
    value: r.value as string,
    avgPrice: r.avg_price as string,
    pctIncrease: r.pct_increase as string | null,
    newPosition: !!r.new_position,
    txnDate: r.txn_date as string,
    filedAt: r.filed_at as string,
    formType: r.form_type as string,
    accession: r.accession_no as string,
    score: r.score as number,
    parts: r.score_parts_json ? (JSON.parse(r.score_parts_json as string) as ScorePart[]) : [],
    late: !!r.late,
    indirect: !!r.indirect,
    nonCommon: !!r.non_common,
    planSuspected: !!r.plan_suspected,
    heldVia: r.held_via as SignalListRow["heldVia"],
    inCluster: !!r.in_cluster,
    footnotes: r.footnotes_json ? (JSON.parse(r.footnotes_json as string) as string[]) : [],
    matchesRule: matches,
  };
}

function load(db: Database.Database, where: string, params: unknown[], order: string): SignalListRow[] {
  const rule = loadRules(db)[0];
  const rows = db.prepare(`${SELECT} ${where} ${order}`).all(...params) as Record<string, string | number | null>[];
  return rows.map((r) =>
    toRow(
      r,
      !!rule &&
        evaluateRule(
          {
            role: r.role as Role,
            value: r.value as string,
            pctIncrease: r.pct_increase as string | null,
            newPosition: !!r.new_position,
            late: !!r.late,
            nonCommon: !!r.non_common,
          },
          rule,
        ).matches,
    ),
  );
}

/** Live signals filed in the window, filtered, newest filed first (or highest score), at most 200 rows. */
export function listSignals(db: Database.Database, f: SignalFilters, today: string): SignalListRow[] {
  const where = ["AND f.filed_at >= ?", "AND s.score >= ?"];
  const params: unknown[] = [addDays(today, -f.days), f.minScore];
  if (f.role) {
    where.push("AND o.role = ?");
    params.push(f.role);
  }
  if (f.heldOnly) where.push("AND s.held_via IS NOT NULL");
  const order =
    f.sort === "score"
      ? "ORDER BY s.score DESC, f.filed_at DESC, s.id DESC"
      : "ORDER BY f.filed_at DESC, f.accession_no DESC, s.id DESC";
  const rows = load(db, where.join(" "), params, order);
  return (f.matchesRule ? rows.filter((r) => r.matchesRule) : rows).slice(0, MAX_ROWS);
}

/** Every live signal of one company, newest filed first. */
export function signalsForIssuer(db: Database.Database, issuerCik: string): SignalListRow[] {
  return load(db, "AND s.issuer_cik = ?", [issuerCik], "ORDER BY f.filed_at DESC, f.accession_no DESC, s.id DESC");
}

export interface AuditLine {
  ownerName: string;
  accession: string;
  filedAt: string;
  tableNo: number;
  code: string | null;
  securityTitle: string | null;
  txnDate: string | null;
  shares: string | null;
  price: string | null;
  plan10b51: boolean;
  why: string;
}

const AUDIT_LIMIT = 300;

/** Why a line is not a purchase signal, mirroring `purchaseLines`. */
function whyNot(r: { table_no: number; code: string | null; shares: string | null; price: string | null; plan_10b51: number }) {
  if (r.table_no !== 1) return "derivative table";
  if (r.code !== "P") return `code ${r.code ?? "?"}`;
  if (r.plan_10b51) return "10b5-1 plan";
  return r.price === null ? "no price" : "no shares";
}

/** Stored lines of one company that did not become a signal: M, A, S, F, derivative, 10b5-1, no price. */
export function auditLines(db: Database.Database, issuerCik: string): AuditLine[] {
  const rows = db
    .prepare(
      `SELECT o.owner_name, f.accession_no, f.filed_at, t.table_no, t.code, t.security_title, t.txn_date,
              t.shares, t.price, t.plan_10b51
       FROM transaction_line t
       JOIN filing f ON f.id = t.filing_id
       JOIN reporting_owner o ON o.id = t.owner_id
       WHERE f.issuer_cik = ?
         AND NOT (t.table_no = 1 AND t.code = 'P' AND t.shares IS NOT NULL AND t.price IS NOT NULL AND t.plan_10b51 = 0)
       ORDER BY f.filed_at DESC, f.accession_no DESC, t.seq
       LIMIT ${AUDIT_LIMIT}`,
    )
    .all(issuerCik) as { owner_name: string; accession_no: string; filed_at: string; table_no: number; code: string | null; security_title: string | null; txn_date: string | null; shares: string | null; price: string | null; plan_10b51: number }[];
  return rows.map((r) => ({
    ownerName: r.owner_name,
    accession: r.accession_no,
    filedAt: r.filed_at,
    tableNo: r.table_no,
    code: r.code,
    securityTitle: r.security_title,
    txnDate: r.txn_date,
    shares: r.shares,
    price: r.price,
    plan10b51: !!r.plan_10b51,
    why: whyNot(r),
  }));
}

/** Parse query-string filters; anything unrecognized falls back to the default. */
export function parseFilters(q: Record<string, string | string[] | undefined>): SignalFilters {
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const days = Number(one("days"));
  const minScore = Number(one("min"));
  const role = one("role");
  return {
    days: Number.isInteger(days) && days > 0 && days <= 400 ? days : DEFAULT_DAYS,
    minScore: Number.isInteger(minScore) && minScore > 0 ? minScore : 0,
    role: (ROLES as readonly string[]).includes(role ?? "") ? (role as Role) : null,
    heldOnly: one("held") === "1",
    matchesRule: one("rule") === "1",
    sort: one("sort") === "score" ? "score" : "filed",
  };
}
