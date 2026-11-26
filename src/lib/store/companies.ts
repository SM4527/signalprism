import type Database from "better-sqlite3";

export type WatchSource = "in_direct" | "in_funds" | "in_manual";

/** Add a company to the watch list, or turn on one more source for an existing one. */
export function upsertCompany(
  db: Database.Database,
  c: { cik: string; ticker: string; name: string | null; source: WatchSource },
  now: string,
): void {
  db.prepare(
    `INSERT INTO company (cik, ticker, name, ${c.source}, added_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (cik) DO UPDATE SET ${c.source} = 1`,
  ).run(c.cik, c.ticker, c.name, now);
}
