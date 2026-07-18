// Site-wide OpenRouter model defaults. All LLM traffic routes through
// OpenRouter — the direct z.ai subscription was decommissioned 2026-07-17.
// GLM models remain available via OpenRouter's z-ai/* slugs (billed to
// OpenRouter). The live defaults are admin-configurable via app_settings
// ('jkai.chat.default_model' etc.); these constants are the code fallbacks.

export const DEFAULT_CHAT_MODEL_ID = 'z-ai/glm-5.2';

// Agentic paths (autonomous builder, plan-debate, Hermes delegation children)
// stay on the fast model: glm-5.2 is ~4x slower and times out on tool-heavy
// delegation (see reference_glm52_agentic_slowness).
export const DEFAULT_AGENTIC_MODEL_ID = 'z-ai/glm-5-turbo';

// Bare GLM ids from the direct-z.ai era → OpenRouter slugs. Persisted state
// (jkai_conversations/jkai_builds rows, saved workflow node configs, client
// localStorage) can still carry bare ids; coerce instead of 400ing at OpenRouter.
export const LEGACY_GLM_TO_OPENROUTER: Record<string, string> = {
  'glm-5.2': 'z-ai/glm-5.2',
  'glm-5.1': 'z-ai/glm-5.1',
  'glm-5': 'z-ai/glm-5',
  'glm-5-turbo': 'z-ai/glm-5-turbo',
  'glm-5v-turbo': 'z-ai/glm-5v-turbo',
  'glm-4.7': 'z-ai/glm-4.7',
  'glm-4.7-flash': 'z-ai/glm-4.7-flash',
  'glm-4.6': 'z-ai/glm-4.6',
  'glm-4.6v': 'z-ai/glm-4.6v',
  'glm-4.5': 'z-ai/glm-4.5',
  'glm-4.5v': 'z-ai/glm-4.5v',
  'glm-4.5-air': 'z-ai/glm-4.5-air',
};

export function mapLegacyModelId(modelId: string): string {
  return LEGACY_GLM_TO_OPENROUTER[modelId] ?? modelId;
}

/** Coerce any persisted model context (possibly legacy provider 'zai' with a
 *  bare GLM id) into a valid OpenRouter context. */
export function coerceModelContext(ctx: { provider?: string; modelId: string }): {
  provider: 'openrouter';
  modelId: string;
} {
  return { provider: 'openrouter', modelId: mapLegacyModelId(ctx.modelId) };
}

/** True for GLM-family models (via OpenRouter). GLM burns reasoning tokens out
 *  of max_tokens, so callers keep generous budgets for these (see
 *  feedback_glm_reasoning_tokens). */
export function isGlmModel(modelId: string): boolean {
  return modelId.startsWith('z-ai/glm') || modelId.startsWith('glm-');
}
