-- `npm run poll:now` sets this; the scheduler that holds the lock sees it on its next heartbeat and polls.
ALTER TABLE scheduler_lock ADD COLUMN poll_requested_at TEXT;
