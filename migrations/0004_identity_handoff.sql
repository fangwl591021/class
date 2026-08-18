PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identity_handoffs (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  identity_session_id TEXT NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
  handoff_code_hash TEXT NOT NULL UNIQUE,
  return_path TEXT NOT NULL DEFAULT '/events',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_by_client_id TEXT REFERENCES api_clients(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_identity_handoff_tenant_expiry
ON identity_handoffs(tenant_key, expires_at, consumed_at);
