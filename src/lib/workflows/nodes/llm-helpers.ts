import type OpenAI from 'openai';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/llm/client';
import {
  DEFAULT_NODE_MAX_TOKENS,
  LEGACY_GLM_TO_OPENROUTER,
  coerceModelContext,
} from '$lib/constants/default-models';
import type { ModelProvider } from '$lib/server/models/types';

export { DEFAULT_NODE_MAX_TOKENS };

/**
 * Resolve an LLM client + model ID from a node's `config.model` string.
 *
 * Routing rules:
 *   - empty / missing / "default" / "jkai-default" → admin site default
 *     (set from /admin/ai/models, key `jkai.chat.default_model`)
 *   - starts with "codex/" → the Codex bridge (ChatGPT Pro subscription)
 *   - contains "/" (e.g. "openai/gpt-4o") → used verbatim as an OpenRouter slug
 *   - bare legacy GLM id (e.g. "glm-5-turbo", from configs saved in the
 *     direct-z.ai era) → mapped to its z-ai/* OpenRouter slug
 *   - any other bare id → IGNORE and fall back to the admin default. A bare id
 *     sent to OpenRouter is a 400 "Unknown Model"; warn so the bad config
 *     surfaces in logs instead of a runtime error.
 *
 * The returned `provider` is the one actually used, not a constant: callers
 * record it against the run, and a Codex call logged as OpenRouter would put
 * subscription work into the per-token cost charts.
 */
export async function resolveLLMClient(
  configuredModel: string | undefined,
): Promise<{ client: OpenAI; model: string; provider: ModelProvider }> {
  const m = (configuredModel ?? '').trim();

  if (m && m !== 'default' && m !== 'jkai-default') {
    // Both provider ids contain a '/', so let coerceModelContext decide which
    // one this is rather than re-implementing the prefix rule here.
    if (m.includes('/')) {
      const ctx = coerceModelContext({ modelId: m });
      return { ...(await getLLMClient(ctx)), provider: ctx.provider };
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
  return { ...(await getLLMClient(ctx)), provider: ctx.provider };
}

/**
 * Resolve the output budget from a node's `config.maxTokens`.
 *
 * A positive number wins; anything else (missing, 0, negative, non-numeric)
 * falls back to DEFAULT_NODE_MAX_TOKENS. Deliberately pure — the per-model
 * ceiling is applied downstream by `withProviderCap` in
 * $lib/llm/usage-capture, so every LLM path gets clamped, not just the four
 * node executors that call this.
 */
export function resolveMaxTokens(configuredMaxTokens: unknown): number {
  const n = typeof configuredMaxTokens === 'number' ? configuredMaxTokens : Number(configuredMaxTokens);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return DEFAULT_NODE_MAX_TOKENS;
}
