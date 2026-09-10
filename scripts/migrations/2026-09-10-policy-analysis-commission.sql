-- The Codex model and reasoning effort an assessment was commissioned with.
--
-- Both nullable and both without a default: NULL means "whatever the
-- research-deep workload resolves to", which is what every assessment before
-- 2026-09-10 ran on and what a submission that names neither still gets. Text
-- rather than an enum for the same reason `conversations.thinking_level` is
-- text — a new rung on the ladder, or a new model, needs no migration.
ALTER TABLE policy_analyses ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE policy_analyses ADD COLUMN IF NOT EXISTS thinking_level text;
