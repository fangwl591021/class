PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["events:read","registrations:write"]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_clients_tenant ON api_clients(tenant_key, is_active);

CREATE TABLE IF NOT EXISTS identity_sessions (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL,
  external_member_id TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_sessions_lookup
ON identity_sessions(tenant_key, provider, external_member_id);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_tenant_time
ON integration_audit_logs(tenant_key, created_at DESC);
