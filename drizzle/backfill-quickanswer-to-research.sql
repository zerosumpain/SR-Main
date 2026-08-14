-- Backfill quick_answer rows into research_session as depth='scan'.
--
-- v3 consolidated five research surfaces onto one table so downstream code
-- stops carrying a branch per tier. This moves the history across.
--
-- The row id is PRESERVED. That is the whole trick: /quickanswer/<id> can then
-- 308 straight to /research/<id> with no lookup table and no dead links.
--
-- Idempotent: re-running inserts nothing new. Non-destructive: quick_answer is
-- left exactly as it was, so this is revertible by deleting the inserted
-- research_session rows (they are the ones with depth='scan' AND an id present
-- in quick_answer).

BEGIN;

INSERT INTO research_session (
  id, topic, goals, status, depth, config, report,
  duration_ms, error_message, created_at, completed_at
)
SELECT
  qa.id,
  qa.topic,
  COALESCE(qa.goals, '[]'::jsonb),
  CASE
    WHEN qa.status = 'complete' THEN 'complete'
    WHEN qa.status = 'failed'   THEN 'failed'
    -- Anything still mid-flight in the old engine has no worker any more.
    ELSE 'failed'
  END,
  'scan',
  '{}'::jsonb,
  CASE
    WHEN qa.answer IS NOT NULL AND qa.answer <> '' THEN
      jsonb_build_object(
        'ranked_facts', '[]'::jsonb,
        'timeline',     '[]'::jsonb,
        'clusters',     '[]'::jsonb,
        'entity_centrality', '{}'::jsonb,
        'executive_summary', qa.answer
      )
    ELSE NULL
  END,
  qa.duration_ms,
  CASE
    WHEN qa.status NOT IN ('complete', 'failed')
      THEN 'Abandoned when the quick-answer engine was retired'
    ELSE qa.error_message
  END,
  qa.created_at,
  qa.completed_at
FROM quick_answer qa
WHERE NOT EXISTS (SELECT 1 FROM research_session rs WHERE rs.id = qa.id);

-- The old table stored sources as a jsonb array on the row; the unified schema
-- gives every source its own row so citations, credibility and the desk all
-- read one shape.
INSERT INTO source (
  session_id, url, title, snippet, domain, phase,
  credibility_score, credibility_type
)
SELECT
  qa.id,
  s->>'url',
  s->>'title',
  s->>'snippet',
  s->>'domain',
  1,
  NULLIF(s->>'credibilityScore', '')::double precision,
  s->>'credibilityType'
FROM quick_answer qa
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(qa.sources, '[]'::jsonb)) AS s
WHERE s->>'url' IS NOT NULL
  AND EXISTS (SELECT 1 FROM research_session rs WHERE rs.id = qa.id)
  AND NOT EXISTS (
    SELECT 1 FROM source src WHERE src.session_id = qa.id AND src.url = s->>'url'
  );

COMMIT;
