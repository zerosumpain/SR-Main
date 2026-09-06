-- Additive; preserves existing questions and their last recorded conclusions.
ALTER TABLE daydream_hypotheses ADD COLUMN IF NOT EXISTS investigation_plan jsonb;
CREATE TABLE IF NOT EXISTS daydream_hypothesis_assessments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hypothesis_id text NOT NULL REFERENCES daydream_hypotheses(id) ON DELETE CASCADE,
  assessed_at timestamptz NOT NULL,
  phase text NOT NULL,
  verdict text NOT NULL,
  summary text NOT NULL,
  window_days integer NOT NULL,
  r double precision NOT NULL,
  p_value double precision NOT NULL,
  q_value double precision NOT NULL,
  pairs integer NOT NULL,
  family_size integer NOT NULL,
  fdr double precision NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS daydream_assessments_hypothesis_idx
  ON daydream_hypothesis_assessments(hypothesis_id, assessed_at);
-- Preserve the old conclusion before changing its terminology. No original
-- observations or exact window survive for these rows: phase=legacy says so.
INSERT INTO daydream_hypothesis_assessments
  (id, hypothesis_id, assessed_at, phase, verdict, summary, window_days,
   r, p_value, q_value, pairs, family_size, fdr, evidence)
SELECT 'legacy:' || h.id, h.id, coalesce(h.last_retested_at, h.tested_at),
  'legacy', coalesce(h.verdict, 'inconclusive'), coalesce(h.summary, 'Legacy assessment; original evidence was not retained.'),
  120, coalesce(h.r, 0), coalesce(h.p_value, 1), coalesce(h.q_value, 1),
  coalesce(h.pairs, 0), coalesce(h.family_size, 0), coalesce(h.fdr, 0.1), '[]'::jsonb
FROM daydream_hypotheses h
WHERE h.tested_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM daydream_hypothesis_assessments a WHERE a.hypothesis_id = h.id)
ON CONFLICT (id) DO NOTHING;
-- Non-significant results were labelled refuted; absence of support is not disproof.
UPDATE daydream_hypotheses
SET verdict = 'inconclusive', summary = 'Legacy assessment: this relationship was not established; it was not disproved. ' || coalesce(summary, '')
WHERE verdict = 'refuted';
