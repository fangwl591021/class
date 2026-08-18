PRAGMA foreign_keys = ON;

-- refund_requests already includes requested_at, processed_at, processed_by and note
-- in 0005_cancellation_reminders.sql. This migration is intentionally a no-op
-- so existing migration order remains stable.
