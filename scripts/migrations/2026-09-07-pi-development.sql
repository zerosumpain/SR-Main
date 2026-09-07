BEGIN;
ALTER TABLE jkai_build_pending_messages ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE jkai_build_pending_messages ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
CREATE TABLE IF NOT EXISTS jkai_build_deliveries (
  build_id text PRIMARY KEY REFERENCES jkai_builds(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jkai_build_delivery_events (
  id serial PRIMARY KEY,
  build_id text NOT NULL REFERENCES jkai_builds(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jkai_build_delivery_events_build ON jkai_build_delivery_events(build_id, id);
CREATE TABLE IF NOT EXISTS jkai_build_lessons (
  id serial PRIMARY KEY,
  build_id text NOT NULL REFERENCES jkai_builds(id) ON DELETE CASCADE,
  area text NOT NULL,
  lesson text NOT NULL,
  evidence text NOT NULL,
  revision text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jkai_build_pending_messages ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
COMMIT;
