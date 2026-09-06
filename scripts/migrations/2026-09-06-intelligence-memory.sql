BEGIN;
ALTER TABLE intel_match_decisions ADD COLUMN IF NOT EXISTS evidence_version text;
ALTER TABLE intel_match_decisions ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS intel_mentions (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, note_id text NOT NULL REFERENCES intel_notes(id) ON DELETE CASCADE,
 entity_id text REFERENCES intel_entities(id) ON DELETE SET NULL, surface text NOT NULL, start_offset integer, end_offset integer,
 excerpt text, proposed_type text NOT NULL, status text NOT NULL, reason text NOT NULL, candidates jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS intel_mentions_note_idx ON intel_mentions(note_id);
CREATE INDEX IF NOT EXISTS intel_mentions_status_idx ON intel_mentions(status);
CREATE TABLE IF NOT EXISTS intel_assertions (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, entity_id text NOT NULL REFERENCES intel_entities(id) ON DELETE CASCADE,
 note_id text REFERENCES intel_notes(id) ON DELETE CASCADE, predicate text NOT NULL, value jsonb NOT NULL,
 status text NOT NULL DEFAULT 'observed', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS intel_assertions_entity_idx ON intel_assertions(entity_id);
CREATE TABLE IF NOT EXISTS jkai_memory_entities (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, memory_id text NOT NULL REFERENCES jkai_memories(id) ON DELETE CASCADE,
 entity_id text NOT NULL REFERENCES intel_entities(id) ON DELETE CASCADE, method text NOT NULL DEFAULT 'review', created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS jkai_memory_entities_pair_idx ON jkai_memory_entities(memory_id, entity_id);
CREATE TABLE IF NOT EXISTS intel_taxonomy_changes (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, kind text NOT NULL, action text NOT NULL, from_id text NOT NULL, into_id text NOT NULL,
 snapshot jsonb NOT NULL, undone_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS intel_taxonomy_links (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, kind text NOT NULL, from_id text NOT NULL, into_id text NOT NULL, relation text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS intel_taxonomy_links_pair_idx ON intel_taxonomy_links(kind, from_id, into_id, relation);
CREATE TABLE IF NOT EXISTS intel_resolution_labels (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, pair_key text NOT NULL, verdict text NOT NULL,
 decided_by text NOT NULL, features jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
COMMIT;
