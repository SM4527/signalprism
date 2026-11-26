import type Database from "better-sqlite3";

export interface CompanyRow {
  cik: string;
  ticker: string;
  name: string | null;
  inDirect: boolean;
  inFunds: boolean;
  inManual: boolean;
  lastFiled: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  signalCount: number;
}

const SELECT = `
  SELECT c.cik, c.ticker, c.name, c.in_direct, c.in_funds, c.in_manual,
         (SELECT max(f.filed_at) FROM filing f WHERE f.issuer_cik = c.cik) AS last_filed,
         k.last_polled_at, k.last_error,
         (SELECT count(*) FROM signal s WHERE s.issuer_cik = c.cik AND s.superseded_by_filing_id IS NULL) AS signal_count
  FROM company c LEFT JOIN company_cursor k ON k.cik = c.cik
  WHERE c.active = 1`;

type Raw = Record<string, string | number | null>;

const toRow = (r: Raw): CompanyRow => ({
  cik: r.cik as string,
  ticker: r.ticker as string,
  name: r.name as string | null,
  inDirect: !!r.in_direct,
  inFunds: !!r.in_funds,
  inManual: !!r.in_manual,
  lastFiled: r.last_filed as string | null,
  lastPolledAt: r.last_polled_at as string | null,
  lastError: r.last_error as string | null,
  signalCount: r.signal_count as number,
});

export const listWatchlist = (db: Database.Database): CompanyRow[] =>
  (db.prepare(`${SELECT} ORDER BY c.ticker`).all() as Raw[]).map(toRow);

export function companyByTicker(db: Database.Database, ticker: string): CompanyRow | null {
  const r = db.prepare(`${SELECT} AND upper(c.ticker) = upper(?)`).get(ticker) as Raw | undefined;
  return r ? toRow(r) : null;
}
