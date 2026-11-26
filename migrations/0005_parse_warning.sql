-- Problems that did not block a filing (for example a malformed Table II row).
ALTER TABLE filing ADD COLUMN parse_warning TEXT;

-- Filings that failed before the parser became lenient are fetched and parsed again on the next poll.
-- A parse-error filing has no owners, lines or signals, so nothing refers to it.
DELETE FROM filing WHERE parse_error IS NOT NULL;
DELETE FROM fetch_failure;
