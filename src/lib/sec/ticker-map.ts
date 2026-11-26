import type Database from "better-sqlite3";
import { z } from "zod";
import type { SecClient } from "./client.ts";
import { normalizeTicker } from "./ticker.ts";

const WEEK_MS = 7 * 86_400_000;

const schema = z.record(z.string(), z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }));

/** Fetch `company_tickers.json` through the shared client and store it. */
export async function refreshTickerMap(
  db: Database.Database,
  client: SecClient,
  archivesUrl: string,
  now: Date,
): Promise<number> {
  return storeTickerMap(db, await client.get(`${archivesUrl}/files/company_tickers.json`), now);
}

/** Upsert `ticker_map` rows (one per ticker, normalized; a CIK can have several) from a `company_tickers.json` body. */
export function storeTickerMap(db: Database.Database, body: string, now: Date): number {
  const rows = Object.values(schema.parse(JSON.parse(body)));
  const put = db.prepare(
    `INSERT INTO ticker_map (ticker, cik, name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (ticker) DO UPDATE SET cik = excluded.cik, name = excluded.name, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const r of rows) {
      put.run(normalizeTicker(r.ticker, "") ?? r.ticker.toUpperCase(), String(r.cik_str).padStart(10, "0"), r.title, now.toISOString());
    }
  })();
  return rows.length;
}

/** True when the map is empty or its newest row is more than a week old. */
export function tickerMapStale(db: Database.Database, now: Date): boolean {
  const newest = db.prepare("SELECT max(updated_at) FROM ticker_map").pluck().get() as string | null;
  return !newest || now.getTime() - Date.parse(newest) > WEEK_MS;
}
