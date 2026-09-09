-- Additive and repeatable. Depth is how many rounds of enquiry the reader asked
-- for; every existing analysis was run at the single-round standard depth.
ALTER TABLE policy_analyses ADD COLUMN IF NOT EXISTS depth text NOT NULL DEFAULT 'standard';
