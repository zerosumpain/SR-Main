-- Capability links to one assessment, for a reader with no account.
--
-- Only the SHA-256 of the raw token is stored. `expires_at` is NOT NULL on
-- purpose: the drive's first capability table had it nullable and never wrote
-- it, so every link it minted was permanent and unkillable.
CREATE TABLE IF NOT EXISTS policy_share (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id  uuid NOT NULL REFERENCES policy_analyses (id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  label        text,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_share_token_hash_idx ON policy_share (token_hash);
CREATE INDEX IF NOT EXISTS policy_share_analysis_idx ON policy_share (analysis_id);
