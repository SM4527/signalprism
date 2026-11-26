import type Database from "better-sqlite3";
import type { Config } from "../config.ts";
import { refreshFromFolioPrism } from "./refresh.ts";

const DAY_MS = 24 * 60 * 60_000;
const RETRY_MS = 15 * 60_000;

const g = globalThis as { __signalprismFolioTimer?: NodeJS.Timeout };

/**
 * Refresh the watch list from FolioPrism at start and then daily (every 15 minutes while it fails).
 * Runs in mock mode too: the sample stack pairs with sample FolioPrism. Does nothing without `FOLIOPRISM_URL`.
 * The refresh is idempotent, so no lock row is needed. Logs counts only.
 */
export function startFolioRefresh(db: Database.Database, config: Config): void {
  if (!config.FOLIOPRISM_URL || g.__signalprismFolioTimer) return;
  const run = async () => {
    const s = await refreshFromFolioPrism(db, config, new Date());
    console.log(`[folioprism] ${s.ok ? `refreshed: ${s.direct} direct, ${s.funds} funds, ${s.notTracked.length} not tracked, ${s.noCoverage} without coverage` : `refresh failed: ${s.error}`}`);
    g.__signalprismFolioTimer = setTimeout(() => void run(), s.ok ? DAY_MS : RETRY_MS).unref();
  };
  g.__signalprismFolioTimer = setTimeout(() => void run(), 0).unref();
}
