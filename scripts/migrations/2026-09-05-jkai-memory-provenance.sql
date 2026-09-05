ALTER TABLE jkai_memories ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE jkai_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS jkai_memory_lexical_idx ON jkai_memories USING gin(to_tsvector('english', content)) WHERE superseded_by IS NULL;
