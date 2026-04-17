CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channels_kind_idx ON channels (kind);
