-- Claude Code changelog tables. Applied directly (not via drizzle-kit push) because
-- the local/VPS DBs carry a pre-existing unique-constraint drift on jkai_conversations
-- that makes non-interactive `drizzle-kit push` prompt+abort (see
-- reference_drizzle_unique_push_gotcha). This DDL matches src/lib/db/schema.ts exactly,
-- so a future successful push sees no diff for these tables. Idempotent.

CREATE TABLE IF NOT EXISTS claude_sessions (
  id text PRIMARY KEY,
  project text NOT NULL DEFAULT 'unknown',
  title text,
  first_prompt text,
  cwd text,
  git_branch text,
  started_at timestamptz,
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'completed',
  message_count integer NOT NULL DEFAULT 0,
  user_msg_count integer NOT NULL DEFAULT 0,
  assistant_msg_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  models jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  est_cost_usd numeric(12,4),
  cost_known boolean NOT NULL DEFAULT true,
  feature_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  term_freq jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_histogram jsonb NOT NULL DEFAULT '{}'::jsonb,
  touched_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  ai_summary text,
  transcript_path text,
  content_hash text,
  file_mtime timestamptz,
  file_size bigint,
  schema_version integer NOT NULL DEFAULT 1,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claude_sessions_project_started_idx ON claude_sessions (project, started_at);
CREATE INDEX IF NOT EXISTS claude_sessions_started_idx ON claude_sessions (started_at);
CREATE INDEX IF NOT EXISTS claude_sessions_hash_idx ON claude_sessions (content_hash);

-- Added in schema v2 (cost audit + full transcript). Idempotent.
ALTER TABLE claude_sessions ADD COLUMN IF NOT EXISTS cost_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE claude_sessions ADD COLUMN IF NOT EXISTS full_transcript text;

-- Added in schema v3 (per-stage cost sparkline). Idempotent.
ALTER TABLE claude_session_stages ADD COLUMN IF NOT EXISTS cost_usd numeric(12,4);

CREATE TABLE IF NOT EXISTS claude_session_stages (
  id serial PRIMARY KEY,
  session_id text NOT NULL REFERENCES claude_sessions(id) ON DELETE CASCADE,
  stage text NOT NULL,
  ordinal integer NOT NULL,
  title text,
  summary text,
  ai_summary text,
  raw_text text,
  started_at timestamptz,
  ended_at timestamptz,
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_count integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS claude_session_stages_session_ordinal_idx ON claude_session_stages (session_id, ordinal);
CREATE INDEX IF NOT EXISTS claude_session_stages_stage_idx ON claude_session_stages (stage);
CREATE INDEX IF NOT EXISTS claude_session_stages_started_idx ON claude_session_stages (started_at);
