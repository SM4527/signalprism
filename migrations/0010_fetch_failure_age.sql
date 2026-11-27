-- When a fetch last failed, so retention can purge old rows. Existing rows start aging from the upgrade.
ALTER TABLE fetch_failure ADD COLUMN updated_at TEXT;
UPDATE fetch_failure SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
