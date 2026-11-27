import type Database from "better-sqlite3";
import { isCommonTicker } from "@/lib/sec/ticker";

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
  /** Other common-stock tickers of the same company (share classes), sorted. */
  otherTickers: string[];
  /** Its preferred, warrant, unit and rights tickers, sorted: shown as a count. */
  moreTickers: string[];
}

const SELECT = `
  SELECT c.cik, c.ticker, c.name, c.in_direct, c.in_funds, c.in_manual,
         (SELECT max(f.filed_at) FROM filing f WHERE f.issuer_cik = c.cik) AS last_filed,
         k.last_polled_at, k.last_error,
         (SELECT count(*) FROM signal s WHERE s.issuer_cik = c.cik AND s.superseded_by_filing_id IS NULL) AS signal_count,
         (SELECT group_concat(t.ticker, ' ') FROM ticker_map t WHERE t.cik = c.cik AND t.ticker != c.ticker) AS other_tickers
  FROM company c LEFT JOIN company_cursor k ON k.cik = c.cik
  WHERE c.active = 1`;

type Raw = Record<string, string | number | null>;

const toRow = (r: Raw): CompanyRow => {
  const others = ((r.other_tickers as string | null) ?? "").split(" ").filter(Boolean).sort();
  return toRowWith(r, others.filter(isCommonTicker), others.filter((t) => !isCommonTicker(t)));
};

const toRowWith = (r: Raw, otherTickers: string[], moreTickers: string[]): CompanyRow => ({
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
  otherTickers,
  moreTickers,
});

export const listWatchlist = (db: Database.Database): CompanyRow[] =>
  (db.prepare(`${SELECT} ORDER BY c.ticker`).all() as Raw[]).map(toRow);

export function companyByTicker(db: Database.Database, ticker: string): CompanyRow | null {
  const r = db.prepare(`${SELECT} AND upper(c.ticker) = upper(?)`).get(ticker) as Raw | undefined;
  return r ? toRow(r) : null;
}
