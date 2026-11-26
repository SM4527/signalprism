-- P lines under a ticked 10b5-1 box now form signals. They are shown, never alerted, never in clusters.
ALTER TABLE signal ADD COLUMN plan_10b51 INTEGER NOT NULL DEFAULT 0;
