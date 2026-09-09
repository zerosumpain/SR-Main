-- Additive only. Same tables as the canonical Drizzle schema.
CREATE TABLE IF NOT EXISTS policy_lab_projects (
  id uuid PRIMARY KEY, owner text NOT NULL, title text NOT NULL,
  revision integer NOT NULL DEFAULT 0, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policy_lab_versions (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES policy_lab_projects(id),
  version integer NOT NULL, model_hash text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_lab_version_unique ON policy_lab_versions(project_id, version);
CREATE TABLE IF NOT EXISTS policy_lab_runs (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES policy_lab_projects(id),
  version_id uuid NOT NULL REFERENCES policy_lab_versions(id), engine_version text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
