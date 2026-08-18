PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  banner_url TEXT,
  location_name TEXT,
  starts_at TEXT,
  ends_at TEXT,
  registration_opens_at TEXT,
  registration_closes_at TEXT,
  capacity INTEGER,
  identity_mode TEXT NOT NULL DEFAULT 'hybrid' CHECK(identity_mode IN ('login_required','guest_only','hybrid')),
  registration_success_mode TEXT NOT NULL DEFAULT 'free' CHECK(registration_success_mode IN ('free','register_then_pay','pay_then_confirm')),
  payment_hold_minutes INTEGER,
  payment_due_days INTEGER,
  attendee_data_mode TEXT NOT NULL DEFAULT 'contact_only' CHECK(attendee_data_mode IN ('contact_only','names_only','full')),
  duplicate_rule TEXT NOT NULL DEFAULT 'none' CHECK(duplicate_rule IN ('none','member','phone','email')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed','finished','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_key, slug)
);

CREATE TABLE IF NOT EXISTS event_sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  capacity INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_items (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES event_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  unit_label TEXT NOT NULL DEFAULT '人',
  unit_price INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  max_quantity INTEGER,
  capacity INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_form_fields (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'contact' CHECK(scope IN ('contact','attendee')),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK(field_type IN ('text','number','tel','email','date','select','radio','checkbox','textarea')),
  options_json TEXT,
  is_required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, scope, field_key)
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  identity_type TEXT NOT NULL CHECK(identity_type IN ('member','guest')),
  provider TEXT,
  external_member_id TEXT,
  display_name TEXT,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_external
ON identities(tenant_key, provider, external_member_id)
WHERE external_member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  registration_no TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  event_id TEXT NOT NULL REFERENCES events(id),
  session_id TEXT REFERENCES event_sessions(id),
  identity_id TEXT REFERENCES identities(id),
  external_source TEXT,
  external_member_id TEXT,
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  registration_status TEXT NOT NULL CHECK(registration_status IN ('draft','pending_payment','confirmed','waitlist','cancelled','expired','checked_in','no_show')),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('not_required','unpaid','pending','paid','failed','refunded')),
  expires_at TEXT,
  custom_data_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reg_event_status ON registrations(event_id, registration_status);
CREATE INDEX IF NOT EXISTS idx_reg_identity ON registrations(identity_id);

CREATE TABLE IF NOT EXISTS registration_items (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES event_items(id),
  item_name_snapshot TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL,
  unit_label_snapshot TEXT NOT NULL DEFAULT '人',
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_attendees (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES event_items(id),
  attendee_index INTEGER NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  custom_data_json TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  original_amount INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  payable_amount INTEGER NOT NULL,
  payment_method TEXT,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('not_required','unpaid','pending','paid','failed','refunded')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded')),
  bank_last5 TEXT,
  paid_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_by TEXT,
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_registration ON checkins(registration_id);
