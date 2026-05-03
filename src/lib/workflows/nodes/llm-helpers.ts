import type OpenAI from 'openai';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

/**
 * Names that obviously belong to a non-z.ai provider. A bare id matching any
 * of these means the config is wrong (usually an LLM hallucination or
 * stale setting) — we should NOT pass it through to the admin provider
 * as a modelId; fall back to the admin default instead.
 */
const FOREIGN_MODEL_PREFIXES = [
  'gpt-', 'o1-', 'o3-', 'chatgpt-', // OpenAI
  'claude-',                          // Anthropic
  'gemini-',                           // Google
  'mistral-', 'mixtral-', 'codestral-',
  'llama-', 'llama2', 'llama3',
  'deepseek-',
  'qwen-', 'qwen2',
  'yi-',
  'grok-',
];
function looksForeign(m: string): boolean {
  const lower = m.toLowerCase();
  return FOREIGN_MODEL_PREFIXES.some((p) => lower.startsWith(p)) || lower === 'gpt-4o';
}

/**
 * Resolve an LLM client + model ID from a node's `config.model` string.
 *
 * Routing rules:
 *   - empty / missing / "default" / "jkai-default" → admin chat default
 *     (e.g. `{ provider: 'zai', modelId: 'glm-5-turbo' }`)
 *   - contains "/" (e.g. "openai/gpt-4o") → OpenRouter
 *   - bare id that looks like a foreign provider's model (gpt-*, claude-*,
 *     gemini-*, etc.) → IGNORE and fall back to admin default. Forcing
 *     those through z.ai just produces a 400 "Unknown Model".
 *   - otherwise (bare id like "glm-5-turbo") → admin default's provider,
 *     with the given modelId (lets users pick any z.ai model without a '/')
 *
 * This keeps /admin/models as the source of truth for the default provider,
 * while still letting config override the specific modelId with a real one.
 */
export async function resolveLLMClient(
  configuredModel: string | undefined,
): Promise<{ client: OpenAI; model: string }> {
  const m = (configuredModel ?? '').trim();

  // Use admin default (full provider + modelId) when empty or sentinel.
  if (!m || m === 'default' || m === 'jkai-default') {
    const ctx = await resolveDefaultModel('chat');
    return getLLMClient(ctx);
  }

  // OpenRouter-formatted model IDs always have a '/' (e.g. openai/gpt-4o).
  // Route through the unified getLLMClient so the OpenRouter key is read
  // from app_settings.openrouter.api_key (admin UI) AND keys.json/env. The
  // legacy getOpenRouterClient() only saw keys.json/env, which made
  // admin-UI-only configs silently fail with "OpenRouter API key not configured".
  if (m.includes('/')) {
    return getLLMClient({ provider: 'openrouter', modelId: m });
  }

  // Bare id that clearly belongs to a foreign provider — don't pipe it
  // into z.ai as a modelId. Fall back to admin default with a warning so
  // the bug surfaces in logs instead of becoming a 400 runtime error.
  if (looksForeign(m)) {
    console.warn(
      `[llm-helpers] configured model "${m}" is not a z.ai model and has no provider prefix — falling back to admin default. ` +
      `Fix: prefix with the provider (e.g. "openai/${m}") or leave the field blank.`,
    );
    const ctx = await resolveDefaultModel('chat');
    return getLLMClient(ctx);
  }

  // Bare model ID → admin default's provider, with this modelId.
  const ctx = await resolveDefaultModel('chat');
  return getLLMClient({ provider: ctx.provider, modelId: m });
}
