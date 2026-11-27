-- Milestone 6: alerts.

-- A signal is historical when it came from a company's first poll or its filing was already old at ingest.
-- Historical signals are never alerted. Everything stored before this migration counts as historical.
ALTER TABLE signal ADD COLUMN historical INTEGER NOT NULL DEFAULT 0;
UPDATE signal SET historical = 1;

-- Set on the first poll whose submissions request succeeded; a company without it is still in its first run.
ALTER TABLE company_cursor ADD COLUMN first_polled_at TEXT;
UPDATE company_cursor SET first_polled_at = last_polled_at
  WHERE last_polled_at IS NOT NULL AND (last_error IS NULL OR last_accession IS NOT NULL);
-- A fetch that failed during a first poll stays historical when a later poll retries it.
ALTER TABLE fetch_failure ADD COLUMN historical INTEGER NOT NULL DEFAULT 0;

-- The outbox. Ingest inserts 'held' rows; the scheduler lock holder claims a row ('sending'), sends, and marks it.
-- payload_json holds only title, body, URL and priority. Never tokens or keys. Empty before this migration.
DROP TABLE notification_log;
CREATE TABLE notification_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('signal', 'cluster', 'digest', 'test')),
  rule_id INTEGER REFERENCES alert_rule(id),
  signal_id INTEGER REFERENCES signal(id),
  -- Clusters are deleted and rebuilt on recompute, so no foreign key.
  cluster_id INTEGER,
  issuer_cik TEXT,
  -- Cluster rows: the sorted insider keys, to tell a new insider from a reshuffled set.
  insiders_json TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('held', 'sending', 'sent', 'logged', 'failed')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  -- Waiting for the digest (over the cap, or digest mode).
  digest INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  digested_in INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  error TEXT
);
CREATE INDEX notification_log_status ON notification_log (status, created_at);
CREATE INDEX notification_log_cluster ON notification_log (issuer_cik, kind, created_at);

ALTER TABLE notification_config ADD COLUMN digest_time TEXT NOT NULL DEFAULT '08:00';
-- Last Pushover usage headers seen (X-Limit-App-*); reset is an ISO time.
ALTER TABLE notification_config ADD COLUMN usage_limit INTEGER;
ALTER TABLE notification_config ADD COLUMN usage_remaining INTEGER;
ALTER TABLE notification_config ADD COLUMN usage_reset_at TEXT;
ALTER TABLE notification_config ADD COLUMN usage_seen_at TEXT;

-- When a company stopped being active (retention deletes data of companies inactive for 90+ days).
ALTER TABLE company ADD COLUMN inactive_since TEXT;
UPDATE company SET inactive_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE active = 0;
CREATE TRIGGER company_inactive_since AFTER UPDATE OF active ON company
BEGIN
  UPDATE company
    SET inactive_since = CASE WHEN NEW.active = 0 THEN coalesce(OLD.inactive_since, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END
    WHERE cik = NEW.cik;
END;
