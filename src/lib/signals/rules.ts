import type Database from "better-sqlite3";
import Decimal from "decimal.js";
import type { Role } from "@/lib/sec/roles";
import { PLAN_LABEL, type PlanKind } from "./plan";

export interface AlertRule {
  id: number;
  name: string;
  roles: Role[];
  minValue: string;
  minPct: string;
  directorMinValue: string;
  includeDirectors: boolean;
  includeTenPct: boolean;
  pushOnCluster: boolean;
  enabled: boolean;
}

export interface RuleInput {
  role: Role;
  value: string;
  pctIncrease: string | null;
  newPosition: boolean;
  late: boolean;
  nonCommon: boolean;
  /** A plan buy (10b5-1 box, ESPP, DRIP, 401(k)) never matches. */
  planKind: PlanKind | null;
}

export interface RuleResult {
  matches: boolean;
  reasons: string[];
}

/**
 * The default rule: CEO or CFO, value >= min or increase >= min % (new position counts), not late,
 * common stock. Directors and 10% owners only when switched on. A plan buy never matches.
 */
export function evaluateRule(s: RuleInput, rule: AlertRule): RuleResult {
  const no = (reason: string): RuleResult => ({ matches: false, reasons: [reason] });
  if (!rule.enabled) return no("rule disabled");
  if (s.planKind) return no(`plan buy (${PLAN_LABEL[s.planKind]})`);
  if (s.nonCommon) return no("non-common security");
  if (s.late) return no("filed late");

  const value = new Decimal(s.value);
  if (s.role === "DIRECTOR") {
    if (!rule.includeDirectors) return no("directors off");
    return value.gte(rule.directorMinValue) ? yes(`director value >= ${rule.directorMinValue}`) : no("below director minimum");
  }
  if (s.role === "HOLDER_10PCT" && !rule.includeTenPct) return no("10% owners off");
  if (s.role !== "HOLDER_10PCT" && !rule.roles.includes(s.role)) return no(`role ${s.role} not in rule`);

  if (value.gte(rule.minValue)) return yes(`value >= ${rule.minValue}`);
  if (s.newPosition) return yes("new position");
  if (s.pctIncrease !== null && new Decimal(s.pctIncrease).gte(rule.minPct)) return yes(`increase >= ${rule.minPct}%`);
  return no("below value and increase thresholds");
}

const yes = (reason: string): RuleResult => ({ matches: true, reasons: [reason] });

/** Create the default rule and notification config on first start. */
export function seedDefaults(db: Database.Database, portfolioHint: "off" | "flag" | "detail" = "off"): void {
  if (db.prepare("SELECT count(*) FROM alert_rule").pluck().get() === 0) {
    db.prepare(
      `INSERT INTO alert_rule (name, roles_json, min_value, min_pct, director_min_value)
       VALUES ('Default', ?, '100000', '10', '250000')`,
    ).run(JSON.stringify(["CEO", "CFO"]));
  }
  db.prepare("INSERT OR IGNORE INTO notification_config (id, portfolio_hint) VALUES (1, ?)").run(portfolioHint);
}

export function loadRules(db: Database.Database): AlertRule[] {
  const rows = db.prepare("SELECT * FROM alert_rule ORDER BY id").all() as Record<string, string | number>[];
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    roles: JSON.parse(r.roles_json as string) as Role[],
    minValue: r.min_value as string,
    minPct: r.min_pct as string,
    directorMinValue: r.director_min_value as string,
    includeDirectors: !!r.include_directors,
    includeTenPct: !!r.include_ten_pct,
    pushOnCluster: !!r.push_on_cluster,
    enabled: !!r.enabled,
  }));
}
