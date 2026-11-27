import type Database from "better-sqlite3";
import { z } from "zod";
import { formatEt } from "@/lib/format";
import { clustersSince, type ClusterDetail } from "@/lib/queries/clusters";
import { companyByTicker, listWatchlist } from "@/lib/queries/companies";
import { DEFAULT_FILTERS, MAX_ROWS, listSignals, signalsForIssuer, type SignalListRow } from "@/lib/queries/signals";
import { parseErrors } from "@/lib/queries/status";
import { getPollStatus } from "@/lib/poll/poll-all";
import { ROLES } from "@/lib/sec/roles";
import { filingIndexUrl } from "@/lib/sec/links";
import { addDays, monthsBefore } from "@/lib/signals/dates";
import {
  ClustersResponse, SignalsResponse, StatusResponse, TickerResponse, type ClusterItem, type SignalItem,
} from "./schemas";

const flag = z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true");
const days = z.coerce.number().int().min(1).max(400);

export const SignalsQuery = z.strictObject({
  days: days.default(30),
  minScore: z.coerce.number().int().min(0).default(0),
  role: z.enum(ROLES).optional(),
  heldOnly: flag.default(false),
  includePlan: flag.default(false),
});
export const ClustersQuery = z.strictObject({ days: days.default(30) });

const etNow = (now: Date) => formatEt(now.toISOString());
const etToday = (now: Date) => etNow(now).slice(0, 10);

function badges(s: SignalListRow): string[] {
  return [
    s.late && "late",
    s.indirect && "indirect",
    s.nonCommon && "non-common",
    s.planKind && `plan:${s.planKind}`,
    s.planSuspected && "plan-suspected",
    s.inCluster && "cluster",
  ].filter((b): b is string => !!b);
}

export const signalItem = (s: SignalListRow): SignalItem => ({
  ticker: s.ticker,
  company: s.issuerName,
  insiders: s.ownerNames,
  role: s.role,
  title_raw: s.titleRaw,
  shares: s.shares,
  value_usd: s.value,
  avg_price: s.avgPrice,
  pct_increase: s.pctIncrease,
  new_position: s.newPosition,
  txn_date: s.txnDate,
  filed_at: s.filedAt,
  form_type: s.formType,
  score: s.score,
  score_parts: s.parts,
  badges: badges(s),
  rule_match: s.matchesRule,
  held_via: s.heldVia,
  sec_url: filingIndexUrl(s.issuerCik, s.accession),
});

const clusterItem = (c: ClusterDetail): ClusterItem => ({
  ticker: c.ticker,
  company: c.company,
  window_start: c.windowStart,
  window_end: c.windowEnd,
  insider_count: c.insiderCount,
  total_value_usd: c.totalValue,
  held_via: c.heldVia,
  members: c.members.map((m) => ({ insider: m.insider, role: m.role, value_usd: m.value, txn_date: m.txnDate })),
});

export function buildSignals(db: Database.Database, q: z.infer<typeof SignalsQuery>, now: Date): SignalsResponse {
  const filters = { ...DEFAULT_FILTERS, days: q.days, minScore: q.minScore, role: q.role ?? null, heldOnly: q.heldOnly, hidePlan: !q.includePlan };
  const rows = listSignals(db, filters, etToday(now));
  return SignalsResponse.parse({
    as_of: etNow(now),
    filters: { days: q.days, min_score: q.minScore, role: q.role ?? null, held_only: q.heldOnly, include_plan: q.includePlan },
    count: rows.length,
    truncated: rows.length === MAX_ROWS,
    signals: rows.map(signalItem),
  });
}

export function buildClusters(db: Database.Database, q: z.infer<typeof ClustersQuery>, now: Date): ClustersResponse {
  return ClustersResponse.parse({
    as_of: etNow(now),
    filters: { days: q.days },
    clusters: clustersSince(db, addDays(etToday(now), -q.days)).map(clusterItem),
  });
}

/** Last 12 months of one company; null when the ticker is not on the watch list. */
export function buildTicker(db: Database.Database, symbol: string, now: Date): TickerResponse | null {
  const company = companyByTicker(db, symbol);
  if (!company) return null;
  const since = monthsBefore(etToday(now), 12);
  const signals = signalsForIssuer(db, company.cik).filter((s) => s.filedAt >= since);
  return TickerResponse.parse({
    as_of: etNow(now),
    ticker: company.ticker,
    company: company.name,
    held_via: company.inDirect ? "direct" : company.inFunds ? "funds" : null,
    since,
    plan_count: signals.filter((s) => s.planKind).length,
    signals: signals.map(signalItem),
    clusters: clustersSince(db, since, company.cik).map(clusterItem),
  });
}

export function buildStatus(db: Database.Database, mode: "mock" | "live", now: Date): StatusResponse {
  const { lastRun, pausedUntil } = getPollStatus(db, now);
  return StatusResponse.parse({
    as_of: etNow(now),
    stack: mode === "mock" ? "sample" : "personal",
    companies_watched: listWatchlist(db).length,
    last_poll: lastRun && {
      started_at: formatEt(lastRun.started_at),
      finished_at: lastRun.finished_at && formatEt(lastRun.finished_at),
      new_filings: lastRun.filings_new,
      new_signals: lastRun.signals_new,
      errors: lastRun.errors,
    },
    paused_until: pausedUntil && formatEt(pausedUntil),
    parse_errors: parseErrors(db, 1_000_000).length,
  });
}
