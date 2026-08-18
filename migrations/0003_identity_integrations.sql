CREATE TABLE IF NOT EXISTS tenant_api_clients (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  client_name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_clients_tenant
ON tenant_api_clients(tenant_key, is_active);
