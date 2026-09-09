-- Additive and repeatable.
--
-- `depth` is how many rounds of enquiry the reader asked for; every existing
-- analysis was run at the single-round standard depth.
ALTER TABLE policy_analyses ADD COLUMN IF NOT EXISTS depth text NOT NULL DEFAULT 'standard';

-- The model-call reuse probe filters on the input hash and the prompt version.
-- Without this index it is a sequential scan of every call ever made.
CREATE INDEX IF NOT EXISTS policy_model_calls_hash_idx ON policy_model_calls (input_hash, prompt_version);
