import type Database from "better-sqlite3";
import { normalizeTicker } from "../sec/ticker.ts";
import { upsertCompany } from "../store/companies.ts";

export interface WatchResult {
  done: string[];
  unknown: string[];
}

const clean = (tickers: string[]) =>
  [...new Set(tickers.map((t) => normalizeTicker(t, "") ?? "").filter(Boolean))];

/** Put tickers on the manual watch list, mapped to a CIK through `ticker_map`. Unknown tickers are reported, not added. */
export function addTickers(db: Database.Database, tickers: string[], today: string): WatchResult {
  const result: WatchResult = { done: [], unknown: [] };
  const find = db.prepare("SELECT cik, name FROM ticker_map WHERE ticker = ?");
  db.transaction(() => {
    for (const ticker of clean(tickers)) {
      const row = find.get(ticker) as { cik: string; name: string | null } | undefined;
      if (!row) {
        result.unknown.push(ticker);
        continue;
      }
      upsertCompany(db, { cik: row.cik, ticker, name: row.name, source: "in_manual" }, today);
      db.prepare("UPDATE company SET active = 1 WHERE cik = ?").run(row.cik);
      result.done.push(ticker);
    }
  })();
  return result;
}

/**
 * Clear the manual flag of the company that owns the ticker (any of its tickers will do); a company with no
 * source left stops being polled. Unlisted tickers are reported.
 */
export function removeTickers(db: Database.Database, tickers: string[]): WatchResult {
  const result: WatchResult = { done: [], unknown: [] };
  db.transaction(() => {
    for (const ticker of clean(tickers)) {
      const changed = db
        .prepare(
          `UPDATE company SET in_manual = 0, active = (in_direct OR in_funds)
           WHERE in_manual = 1 AND (ticker = ? OR cik IN (SELECT cik FROM ticker_map WHERE ticker = ?))`,
        )
        .run(ticker, ticker).changes;
      (changed ? result.done : result.unknown).push(ticker);
    }
  })();
  return result;
}
