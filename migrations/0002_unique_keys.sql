-- One signal per (filing, owner); one cluster per issuer window start.
CREATE UNIQUE INDEX signal_filing_owner ON signal (filing_id, owner_id);
CREATE UNIQUE INDEX cluster_issuer_window ON cluster (issuer_cik, window_start);
CREATE INDEX signal_issuer_txn ON signal (issuer_cik, txn_date);

-- Fields the rule evaluator and detail page need that 0001 lacked.
ALTER TABLE signal ADD COLUMN non_common INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signal ADD COLUMN indirect INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signal ADD COLUMN footnotes_json TEXT;

-- A 4/A names the filing date of its original; a 4/A can also remove a purchase without a new signal.
ALTER TABLE filing ADD COLUMN original_submission_date TEXT;
ALTER TABLE signal ADD COLUMN superseded_by_filing_id INTEGER REFERENCES filing(id);
