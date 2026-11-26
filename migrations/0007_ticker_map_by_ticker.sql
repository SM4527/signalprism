-- ticker_map is keyed by ticker: one CIK can have several tickers (share classes, preferreds).
CREATE TABLE ticker_map_new (
  cik TEXT NOT NULL,
  ticker TEXT PRIMARY KEY,
  name TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO ticker_map_new (cik, ticker, name, updated_at)
  SELECT cik, upper(replace(ticker, '.', '-')), name, updated_at FROM ticker_map WHERE true
  ON CONFLICT (ticker) DO NOTHING;
DROP TABLE ticker_map;
ALTER TABLE ticker_map_new RENAME TO ticker_map;
CREATE INDEX ticker_map_cik ON ticker_map (cik);
-- The old table kept one ticker per CIK, so mark what is left as stale: the next start loads the full map.
UPDATE ticker_map SET updated_at = '1970-01-01T00:00:00.000Z';
