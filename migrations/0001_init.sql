-- Decimals (shares, prices, values, percentages) are stored as TEXT.

CREATE TABLE company (
  cik TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  name TEXT,
  in_direct INTEGER NOT NULL DEFAULT 0,
  in_funds INTEGER NOT NULL DEFAULT 0,
  in_manual INTEGER NOT NULL DEFAULT 0,
  exposure_pct TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL
);

CREATE TABLE company_cursor (
  cik TEXT PRIMARY KEY REFERENCES company(cik),
  last_accession TEXT,
  last_polled_at TEXT,
  last_error TEXT
);

CREATE TABLE filing (
  id INTEGER PRIMARY KEY,
  accession_no TEXT NOT NULL UNIQUE,
  form_type TEXT NOT NULL,
  issuer_cik TEXT NOT NULL,
  ticker TEXT,
  filed_at TEXT NOT NULL,
  period_of_report TEXT,
  xml_url TEXT,
  amends_id INTEGER REFERENCES filing(id),
  parse_error TEXT
);

CREATE TABLE reporting_owner (
  id INTEGER PRIMARY KEY,
  filing_id INTEGER NOT NULL REFERENCES filing(id),
  owner_cik TEXT,
  owner_name TEXT NOT NULL,
  is_officer INTEGER NOT NULL DEFAULT 0,
  is_director INTEGER NOT NULL DEFAULT 0,
  is_ten_pct INTEGER NOT NULL DEFAULT 0,
  officer_title_raw TEXT,
  role TEXT NOT NULL,
  joint_group_id TEXT
);

CREATE TABLE transaction_line (
  id INTEGER PRIMARY KEY,
  filing_id INTEGER NOT NULL REFERENCES filing(id),
  owner_id INTEGER NOT NULL REFERENCES reporting_owner(id),
  seq INTEGER NOT NULL,
  table_no INTEGER NOT NULL,
  security_title TEXT,
  code TEXT,
  txn_date TEXT,
  shares TEXT,
  price TEXT,
  acquired_disposed TEXT,
  owned_after TEXT,
  ownership_form TEXT,
  nature_of_ownership TEXT,
  plan_10b51 INTEGER NOT NULL DEFAULT 0,
  footnotes_json TEXT
);

CREATE TABLE signal (
  id INTEGER PRIMARY KEY,
  filing_id INTEGER NOT NULL REFERENCES filing(id),
  owner_id INTEGER NOT NULL REFERENCES reporting_owner(id),
  issuer_cik TEXT NOT NULL,
  txn_date TEXT NOT NULL,
  shares TEXT NOT NULL,
  value TEXT NOT NULL,
  avg_price TEXT NOT NULL,
  owned_before TEXT,
  pct_increase TEXT,
  new_position INTEGER NOT NULL DEFAULT 0,
  lag_days INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  plan_suspected INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  score_parts_json TEXT,
  in_portfolio INTEGER NOT NULL DEFAULT 0,
  held_via TEXT,
  superseded_by INTEGER REFERENCES signal(id)
);

CREATE TABLE cluster (
  id INTEGER PRIMARY KEY,
  issuer_cik TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  insider_count INTEGER NOT NULL,
  total_value TEXT NOT NULL,
  last_alerted_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cluster_member (
  cluster_id INTEGER NOT NULL REFERENCES cluster(id),
  signal_id INTEGER NOT NULL REFERENCES signal(id),
  PRIMARY KEY (cluster_id, signal_id)
);

CREATE TABLE alert_rule (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  min_value TEXT NOT NULL,
  min_pct TEXT NOT NULL,
  director_min_value TEXT NOT NULL,
  include_directors INTEGER NOT NULL DEFAULT 0,
  include_ten_pct INTEGER NOT NULL DEFAULT 0,
  push_on_cluster INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pushover_enabled INTEGER NOT NULL DEFAULT 0,
  portfolio_hint TEXT NOT NULL DEFAULT 'off',
  quiet_start TEXT,
  quiet_end TEXT,
  digest INTEGER NOT NULL DEFAULT 0,
  daily_cap INTEGER NOT NULL DEFAULT 10
);

-- payload_json holds only title, body, URL and priority. Never tokens or keys.
CREATE TABLE notification_log (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER REFERENCES alert_rule(id),
  signal_id INTEGER REFERENCES signal(id),
  cluster_id INTEGER REFERENCES cluster(id),
  dedup_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('held', 'sent', 'logged', 'failed')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  error TEXT
);

CREATE TABLE poll_run (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  filings_new INTEGER NOT NULL DEFAULT 0,
  signals_new INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  backoff_until TEXT
);

CREATE TABLE ticker_map (
  cik TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  name TEXT,
  updated_at TEXT NOT NULL
);

-- Single row; the scheduler claims it so only one process polls.
CREATE TABLE scheduler_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT,
  heartbeat_at TEXT
);
INSERT INTO scheduler_lock (id) VALUES (1);
