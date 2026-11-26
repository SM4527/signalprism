import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { getSecClient } from "../sec/shared-client.ts";
import { refreshTickerMap, storeTickerMap, tickerMapStale } from "../sec/ticker-map.ts";

export const SAMPLE_TICKER_MAP = join("tests", "fixtures", "sample", "company_tickers.json");

/** Make sure `ticker_map` is fresh: live mode asks SEC once, mock mode loads the fixture. Returns true when it loaded. */
export async function ensureTickerMap(db: Database.Database, config: Config, now: Date): Promise<boolean> {
  if (!tickerMapStale(db, now)) return false;
  if (config.DATA_MODE === "mock") {
    storeTickerMap(db, readFileSync(join(process.cwd(), SAMPLE_TICKER_MAP), "utf8"), now);
  } else {
    await refreshTickerMap(db, getSecClient(config), config.SEC_ARCHIVES_URL, now);
  }
  return true;
}
