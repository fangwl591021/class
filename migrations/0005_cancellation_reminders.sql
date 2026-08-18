PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN cancel_policy TEXT NOT NULL DEFAULT 'allowed';
ALTER TABLE events ADD COLUMN cancel_deadline_hours INTEGER;
ALTER TABLE events ADD COLUMN paid_cancel_action TEXT NOT NULL DEFAULT 'manual_refund';
ALTER TABLE registrations ADD COLUMN payment_due_at TEXT;
ALTER TABLE registrations ADD COLUMN reminder_sent_at TEXT;

CREATE TABLE IF NOT EXISTS refund_requests (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','refunded')),
  reason TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  processed_by TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_refund_registration ON refund_requests(registration_id, status);
CREATE INDEX IF NOT EXISTS idx_registration_payment_due ON registrations(payment_status, payment_due_at, reminder_sent_at);
