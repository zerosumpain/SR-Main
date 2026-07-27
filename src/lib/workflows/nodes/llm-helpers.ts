import type OpenAI from 'openai';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';
import { LEGACY_GLM_TO_OPENROUTER } from '$lib/constants/default-models';

/**
 * Resolve an LLM client + model ID from a node's `config.model` string.
 *
 * Routing rules (OpenRouter is the only provider):
 *   - empty / missing / "default" / "jkai-default" → admin site default
 *     (set from /admin/ai/models, key `jkai.chat.default_model`)
 *   - contains "/" (e.g. "openai/gpt-4o") → used verbatim as an OpenRouter slug
 *   - bare legacy GLM id (e.g. "glm-5-turbo", from configs saved in the
 *     direct-z.ai era) → mapped to its z-ai/* OpenRouter slug
 *   - any other bare id → IGNORE and fall back to the admin default. A bare id
 *     sent to OpenRouter is a 400 "Unknown Model"; warn so the bad config
 *     surfaces in logs instead of a runtime error.
 */
export async function resolveLLMClient(
  configuredModel: string | undefined,
): Promise<{ client: OpenAI; model: string; provider: 'openrouter' }> {
  const m = (configuredModel ?? '').trim();

  if (m && m !== 'default' && m !== 'jkai-default') {
    // OpenRouter-formatted model IDs always have a '/'. Route through the
    // unified getLLMClient so the OpenRouter key is read from
    // app_settings.openrouter.api_key (admin UI) AND keys.json/env.
    if (m.includes('/')) {
      return { ...(await getLLMClient({ provider: 'openrouter', modelId: m })), provider: 'openrouter' };
    }
    const mapped = LEGACY_GLM_TO_OPENROUTER[m];
    if (mapped) {
      return { ...(await getLLMClient({ provider: 'openrouter', modelId: mapped })), provider: 'openrouter' };
    }
    console.warn(
      `[llm-helpers] configured model "${m}" has no provider prefix and is not a known legacy GLM id — falling back to the admin default. ` +
        `Fix: use a full OpenRouter slug (e.g. "openai/${m}") or leave the field blank.`,
    );
  }

  const ctx = await resolveDefaultModel();
  return { ...(await getLLMClient(ctx)), provider: 'openrouter' };
}
