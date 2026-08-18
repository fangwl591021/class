PRAGMA foreign_keys = ON;

ALTER TABLE refund_requests ADD COLUMN processed_note TEXT;
ALTER TABLE refund_requests ADD COLUMN processed_at TEXT;
