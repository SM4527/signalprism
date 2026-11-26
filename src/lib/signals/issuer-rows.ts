import type Database from "better-sqlite3";
import type { Role } from "@/lib/sec/roles";

/** One stored signal joined with its owner and filing. */
export interface SignalRow {
  id: number;
  filing_id: number;
  issuer_cik: string;
  txn_date: string;
  value: string;
  pct_increase: string | null;
  new_position: number;
  late: number;
  plan_suspected: number;
  held_via: "direct" | "funds" | null;
  superseded_by: number | null;
  superseded_by_filing: number | null;
  role: Role;
  owner_cik: string | null;
  owner_name: string;
  joint_group_id: string | null;
  form_type: "4" | "4/A";
  filed_at: string;
  period_of_report: string | null;
}

const OFFICER_ROLES: ReadonlySet<Role> = new Set(["CEO", "CFO", "COO", "PRESIDENT", "OTHER_OFFICER"]);
export const isOfficerRole = (r: Role) => OFFICER_ROLES.has(r);

const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Who the person is: `owner_cik`, else the normalized name. */
export const personKey = (r: Pick<SignalRow, "owner_cik" | "owner_name">) => r.owner_cik ?? `name:${normName(r.owner_name)}`;


export function loadIssuerRows(db: Database.Database, issuerCik: string): SignalRow[] {
  return db
    .prepare(
      `SELECT s.id, s.filing_id, s.issuer_cik, s.txn_date, s.value, s.pct_increase, s.new_position,
              s.late, s.plan_suspected, s.held_via, s.superseded_by, s.superseded_by_filing_id AS superseded_by_filing,
              o.role, o.owner_cik, o.owner_name, o.joint_group_id,
              f.form_type, f.filed_at, f.period_of_report
       FROM signal s
       JOIN reporting_owner o ON o.id = s.owner_id
       JOIN filing f ON f.id = s.filing_id
       WHERE s.issuer_cik = ?
       ORDER BY s.txn_date, s.id`,
    )
    .all(issuerCik) as SignalRow[];
}

/** A signal is live until an amendment replaces or removes it. */
export const isLive = (r: SignalRow) => r.superseded_by_filing === null;
