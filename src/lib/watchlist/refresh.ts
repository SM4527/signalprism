import type Database from "better-sqlite3";
import type { Config } from "../config.ts";
import { recomputeIssuer } from "../signals/recompute.ts";
import { upsertCompany } from "../store/companies.ts";
import { ensureTickerMap } from "./ensure-ticker-map.ts";
import { fetchFolioData } from "./folioprism.ts";
import { buildPortfolioMap } from "./portfolio-map.ts";

export const SOFT_CAP = 150;

/** What the last refresh did. Held in memory only: it names tickers, so it is never stored or logged. */
export interface RefreshState {
  ok: boolean;
  at: string;
  error: string | null;
  direct: number;
  funds: number;
  notTracked: NotTracked[];
  /** Holdings skipped for lack of a coverage item (also listed in `notTracked`). */
  noCoverage: number;
  overCap: boolean;
}

export type NotTrackedReason = "no SEC CIK" | "no coverage in FolioPrism";
export interface NotTracked {
  ticker: string;
  reason: NotTrackedReason;
}

const g = globalThis as { __signalprismRefresh?: RefreshState };
export const lastRefresh = (): RefreshState | undefined => g.__signalprismRefresh;

type Flags = { cik: string; in_direct: number; in_funds: number };
const flags = (db: Database.Database) => new Map((db.prepare("SELECT cik, in_direct, in_funds FROM company").all() as Flags[]).map((f) => [f.cik, f]));

/**
 * Rebuild `in_direct` and `in_funds` from FolioPrism, leaving `in_manual` alone. Funds never become companies.
 * Tickers with no CIK are only remembered as "not tracked". Companies whose flags changed are recomputed,
 * which refreshes `held_via` and scores.
 */
export async function refreshFromFolioPrism(db: Database.Database, config: Config, now: Date): Promise<RefreshState> {
  const at = now.toISOString();
  try {
    await ensureTickerMap(db, config, now);
    const map = buildPortfolioMap(await fetchFolioData(config.FOLIOPRISM_URL!, now.getTime(), true));
    const cikOf = new Map(
      (db.prepare("SELECT cik, ticker FROM ticker_map").all() as { cik: string; ticker: string }[]).map((r) => [r.ticker, r.cik]),
    );
    const wanted = [
      ...[...map.direct].map((t) => [t, "in_direct"] as const),
      ...[...map.viaFunds.keys()].map((t) => [t, "in_funds"] as const),
    ];
    const notTracked: NotTracked[] = [
      ...wanted.filter(([t]) => !cikOf.has(t)).map(([t]) => ({ ticker: t, reason: "no SEC CIK" as const })),
      ...map.noCoverage.map((ticker) => ({ ticker, reason: "no coverage in FolioPrism" as const })),
    ].sort((a, b) => a.ticker.localeCompare(b.ticker));
    const before = flags(db);

    db.transaction(() => {
      db.prepare("UPDATE company SET in_direct = 0, in_funds = 0").run();
      for (const [ticker, source] of wanted) {
        const cik = cikOf.get(ticker);
        if (cik) upsertCompany(db, { cik, ticker, name: nameOf(db, cik), source }, at.slice(0, 10));
      }
      db.prepare("UPDATE company SET active = (in_direct OR in_funds OR in_manual)").run();
      for (const [cik, f] of flags(db)) {
        const b = before.get(cik);
        if (!b || b.in_direct !== f.in_direct || b.in_funds !== f.in_funds) recomputeIssuer(db, cik, at.slice(0, 10));
      }
    })();

    const active = db.prepare("SELECT count(*) FROM company WHERE active = 1").pluck().get() as number;
    return (g.__signalprismRefresh = {
      ok: true, at, error: null, direct: map.direct.size, funds: map.viaFunds.size, notTracked,
      noCoverage: map.noCoverage.length, overCap: active > SOFT_CAP,
    });
  } catch (e) {
    const prev = g.__signalprismRefresh;
    return (g.__signalprismRefresh = {
      ok: false, at, error: (e as Error).name, direct: prev?.direct ?? 0, funds: prev?.funds ?? 0, notTracked: prev?.notTracked ?? [], noCoverage: prev?.noCoverage ?? 0, overCap: prev?.overCap ?? false,
    });
  }
}

const nameOf = (db: Database.Database, cik: string) =>
  db.prepare("SELECT name FROM ticker_map WHERE cik = ? LIMIT 1").pluck().get(cik) as string | null;
