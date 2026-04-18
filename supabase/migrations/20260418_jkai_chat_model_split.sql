-- Split the single chat default into two slots: GLM default + OpenRouter alternate.
-- Seed GLM default as glm-5-turbo (per user preference) and OR alt as null.
-- Leave jkai.builder.default_model untouched (builder keeps the combined dropdown).

INSERT INTO app_settings (key, value) VALUES
  ('jkai.chat.default_glm_model',    '{"modelId":"glm-5-turbo"}'::jsonb),
  ('jkai.chat.alt_openrouter_model', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Retire the old combined chat default. resolveDefaultModel('chat') now
-- reads jkai.chat.default_glm_model.
DELETE FROM app_settings WHERE key = 'jkai.chat.default_model';
