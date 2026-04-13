CREATE TABLE IF NOT EXISTS workflow_data_store (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_data_store_workflow_key_idx
  ON workflow_data_store (workflow_id, key);
