-- Additive commissioning envelope, immutable plans, lineage and outbox.
-- Run with the migration role. No historical idea is approved by this migration.
BEGIN;
CREATE TABLE IF NOT EXISTS daydream_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id text NOT NULL,
  thought_id text NOT NULL REFERENCES daydream_thoughts(id) ON DELETE CASCADE,
  backlog_slug text NOT NULL,
  state text NOT NULL DEFAULT 'awaiting_approval',
  revision integer NOT NULL DEFAULT 1,
  spec_hash text NOT NULL,
  spec jsonb NOT NULL,
  approved_at timestamptz,
  approved_by text,
  attempts integer NOT NULL DEFAULT 0,
  generation integer NOT NULL DEFAULT 0,
  workflow_run_id text,
  result jsonb,
  last_error text,
  deferred_until timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daydream_commissions_state_check CHECK (state IN
    ('awaiting_approval','deferred','declined','queued','running','needs_attention','completed','cancelled')),
  CONSTRAINT daydream_commissions_revisions_check CHECK (revision > 0 AND attempts >= 0 AND generation >= 0),
  CONSTRAINT daydream_commissions_origin_unique UNIQUE (principal_id, thought_id, spec_hash)
);
CREATE INDEX IF NOT EXISTS daydream_commissions_principal_updated_idx ON daydream_commissions(principal_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS daydream_commission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL REFERENCES daydream_commissions(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  kind text NOT NULL,
  actor text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (commission_id, sequence)
);
CREATE TABLE IF NOT EXISTS daydream_commission_commands (
  principal_id text NOT NULL,
  operation_key text NOT NULL,
  commission_id uuid NOT NULL REFERENCES daydream_commissions(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, operation_key)
);
CREATE TABLE IF NOT EXISTS daydream_commission_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL REFERENCES daydream_commissions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES daydream_commission_events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notification','dispatch')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  UNIQUE (event_id, kind)
);
CREATE INDEX IF NOT EXISTS daydream_commission_outbox_pending_idx ON daydream_commission_outbox(available_at) WHERE delivered_at IS NULL;
-- The runtime-role rollout is optional; grant only the Main role if installed.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON daydream_commissions, daydream_commission_commands, daydream_commission_outbox TO sr_main_runtime;
    GRANT SELECT, INSERT, DELETE ON daydream_commission_events TO sr_main_runtime;
  END IF;
END $$;
COMMIT;
