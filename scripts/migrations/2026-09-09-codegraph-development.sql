BEGIN;
ALTER TABLE codegraph_queries ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS codegraph_snapshots (
 id text PRIMARY KEY, repo text NOT NULL, revision text NOT NULL, scope text NOT NULL,
 build_id text REFERENCES jkai_builds(id) ON DELETE SET NULL, baseline text,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE codegraph_snapshots ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS codegraph_snapshots_repo_idx ON codegraph_snapshots(repo, scope, created_at);
CREATE TABLE IF NOT EXISTS codegraph_sources (
 id text PRIMARY KEY, repo text NOT NULL, kind text NOT NULL, title text NOT NULL,
 url text, revision text NOT NULL, license text, access text NOT NULL DEFAULT 'owner',
 status text NOT NULL DEFAULT 'reference', payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS codegraph_assessments (
 id text PRIMARY KEY, build_id text REFERENCES jkai_builds(id) ON DELETE SET NULL,
 target_id text NOT NULL, verdict text NOT NULL, evidence text NOT NULL, revision text,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
