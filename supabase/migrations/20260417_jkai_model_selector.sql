-- app_settings: generic key/value store
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('jkai.chat.default_model',    '{"provider":"zai","modelId":"glm-5.1"}'::jsonb),
  ('jkai.builder.default_model', '{"provider":"zai","modelId":"glm-5.1"}'::jsonb),
  ('openrouter.api_key',         '{"value":""}'::jsonb),
  ('openrouter.last_refreshed_at', 'null'::jsonb);

-- openrouter_models: cached OpenRouter catalogue
CREATE TABLE openrouter_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  context_length INTEGER,
  prompt_price NUMERIC(20,12),
  completion_price NUMERIC(20,12),
  image_price NUMERIC(20,12),
  modality TEXT,
  provider TEXT,
  raw JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX openrouter_models_provider_idx ON openrouter_models (provider);
CREATE INDEX openrouter_models_modality_idx ON openrouter_models (modality);

-- Conversations: model pin + cost tracking
ALTER TABLE jkai_conversations
  ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'zai',
  ADD COLUMN model_id TEXT NOT NULL DEFAULT 'glm-5.1',
  ADD COLUMN prompt_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN price_snapshot JSONB;

-- Builds: model pin + cost tracking
ALTER TABLE jkai_builds
  ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'zai',
  ADD COLUMN model_id TEXT NOT NULL DEFAULT 'glm-5.1',
  ADD COLUMN cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN price_snapshot JSONB;
