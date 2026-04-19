import type OpenAI from 'openai';
import { getOpenRouterClient } from '$lib/deepdive/keys';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

/**
 * Resolve an LLM client + model ID from a node's `config.model` string.
 *
 * Routing rules:
 *   - empty / missing / "default" / "jkai-default" → admin chat default
 *     (e.g. `{ provider: 'zai', modelId: 'glm-5-turbo' }`)
 *   - contains "/" (e.g. "openai/gpt-4o") → OpenRouter
 *   - otherwise (bare ID like "glm-5-turbo") → admin default's provider,
 *     with the given modelId (lets users pick any Z.AI model without an '/')
 *
 * This keeps /admin/models as the source of truth for the default provider,
 * while still letting config override the specific modelId.
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
  if (m.includes('/')) {
    return { client: getOpenRouterClient(), model: m };
  }

  // Bare model ID → admin default's provider, with this modelId.
  const ctx = await resolveDefaultModel('chat');
  return getLLMClient({ provider: ctx.provider, modelId: m });
}
