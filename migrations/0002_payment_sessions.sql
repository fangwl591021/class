ALTER TABLE events ADD COLUMN payment_methods_json TEXT DEFAULT '["bank_transfer"]';
ALTER TABLE events ADD COLUMN bank_name TEXT;
ALTER TABLE events ADD COLUMN bank_code TEXT;
ALTER TABLE events ADD COLUMN bank_account TEXT;
ALTER TABLE events ADD COLUMN bank_account_name TEXT;
ALTER TABLE events ADD COLUMN payment_note TEXT;

ALTER TABLE registrations ADD COLUMN payment_submitted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_payment_status ON registrations(event_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_reg_expires ON registrations(registration_status, expires_at);
