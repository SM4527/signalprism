-- Plan buys: why a signal is not a discretionary buy (10b5-1 box, ESPP, DRIP, 401k). Null for a normal signal.
ALTER TABLE signal ADD COLUMN plan_kind TEXT;
UPDATE signal SET plan_kind = '10b5-1' WHERE plan_10b51 = 1;
ALTER TABLE signal DROP COLUMN plan_10b51;

-- One-time startup steps that have run (see src/lib/signals/reclassify.ts).
CREATE TABLE maintenance_done (
  name TEXT PRIMARY KEY,
  done_at TEXT NOT NULL
);
