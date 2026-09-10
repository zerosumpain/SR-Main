-- The persona library: bodies the reader keeps meeting, remembered between
-- assessments.
--
-- Purely additive. No unique index on the persona name on purpose — identity is
-- decided by the site's own identity policy, not by string equality, and a
-- unique constraint would either merge two bodies that share a name or refuse a
-- legitimate second one.
CREATE TABLE IF NOT EXISTS policy_personas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner         text NOT NULL,
  name          text NOT NULL,
  entity_type   text NOT NULL DEFAULT 'concept',
  aliases       jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary       text,
  dossier       jsonb NOT NULL DEFAULT '[]'::jsonb,
  jurisdiction  text,
  sightings     integer NOT NULL DEFAULT 0,
  researched_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_personas_owner_idx ON policy_personas (owner, name);

-- `analysis_id` is nullable and cascades: deleting an assessment removes what it
-- observed, and the persona survives with a lower sighting count.
CREATE TABLE IF NOT EXISTS policy_persona_observations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid NOT NULL REFERENCES policy_personas (id) ON DELETE CASCADE,
  analysis_id    uuid REFERENCES policy_analyses (id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'assessment',
  analysis_title text,
  actor_id       text,
  traits         jsonb NOT NULL DEFAULT '[]'::jsonb,
  plays          jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources        jsonb NOT NULL DEFAULT '[]'::jsonb,
  note           text,
  observed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_persona_observations_persona_idx ON policy_persona_observations (persona_id, observed_at);
CREATE INDEX IF NOT EXISTS policy_persona_observations_analysis_idx ON policy_persona_observations (analysis_id);

-- The two composite foreign keys on policy_provenance are dropped in the same
-- change, and drizzle-kit push does this too. They pointed at policy_artefacts'
-- composite primary key, and on drizzle-kit 0.31.10 that pairing makes EVERY
-- push fail: it recreates both the FKs and the PK unconditionally and orders the
-- FK re-creation BEFORE the PK drop, so Postgres refuses with
--   cannot drop constraint policy_artefacts_analysis_id_id_pk ...
-- Reproduced against a database drizzle had itself created from schema.ts
-- seconds earlier, so it is not drift. See the comment on `policyProvenance` in
-- src/lib/db/schema.ts for what replaces the guarantee.
ALTER TABLE policy_provenance DROP CONSTRAINT IF EXISTS policy_provenance_from_fk;
ALTER TABLE policy_provenance DROP CONSTRAINT IF EXISTS policy_provenance_to_fk;
