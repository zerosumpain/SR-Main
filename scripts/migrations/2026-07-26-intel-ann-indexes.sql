-- Intel: ANN + trigram indexes for the entity graph.
--
-- Run MANUALLY against production, not via drizzle-kit push: `.using('hnsw', …)`
-- support varies by drizzle version, and both indexes need an extension present
-- first. Everything here is idempotent and safe to re-run.
--
-- Why it matters: `extract.ts` retrieves entity-resolution candidates with
-- `ORDER BY embedding <=> $1`, on the critical path of every ingest, and
-- `grep -rE 'ivfflat|hnsw'` across the repo returned ZERO hits — every vector
-- search in intel was a sequential scan over the whole table. Fine at 500
-- entities, not at 5,000.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Approximate-nearest-neighbour over entity embeddings.
-- HNSW rather than IVFFlat: no training step, and it stays accurate as the
-- table grows, which matters when the corpus is added to continuously rather
-- than loaded once.
CREATE INDEX IF NOT EXISTS intel_entities_embedding_hnsw
  ON intel_entities USING hnsw (embedding vector_cosine_ops);

-- Fuzzy name blocking for the duplicate detector, so candidate generation
-- does not have to load every entity name into the application.
CREATE INDEX IF NOT EXISTS intel_entities_name_trgm_idx
  ON intel_entities USING gin (lower(name) gin_trgm_ops);

-- Note embeddings are searched the same way by unified recall.
CREATE INDEX IF NOT EXISTS intel_notes_embedding_hnsw
  ON intel_notes USING hnsw (embedding vector_cosine_ops);

ANALYZE intel_entities;
ANALYZE intel_notes;
