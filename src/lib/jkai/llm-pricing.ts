/**
 * Per-million-token pricing for LLM providers used by the workflow engine.
 *
 * Best-effort hard-coded table. Unknown (provider, model) pairs return null
 * and the gateway wrapper writes null cost — never a fabricated zero, which
 * would silently understate spend in charts.
 *
 * Refresh when providers change prices or when you start using a new model.
 * All prices in USD per 1,000,000 tokens (the universal vendor unit).
 *
 * For Phase 2 the simple model is `cost = input * inputRate + output * outputRate`.
 * `cacheReadTokens` and `reasoningTokens` are captured as columns for later
 * breakdown but are NOT re-priced here — cache reads are folded into
 * prompt_tokens by every provider, and reasoning tokens are folded into
 * completion_tokens. A future pass can apply per-bucket discounts/surcharges.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PER_MILLION = 1_000_000;

// z.ai GLM family — coding paas endpoint. Prices as of 2026-05.
const ZAI_PRICES: Record<string, ModelPricing> = {
  'glm-5.2': { inputPerMillion: 0.6, outputPerMillion: 2.2 }, // est. — mirrors glm-5.1 (same tier)
  'glm-5.1': { inputPerMillion: 0.6, outputPerMillion: 2.2 },
  'glm-5-turbo': { inputPerMillion: 0.1, outputPerMillion: 0.3 },
  'glm-5-air': { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  'glm-4.5': { inputPerMillion: 0.6, outputPerMillion: 2.2 },
  'glm-4.5v': { inputPerMillion: 1.5, outputPerMillion: 4.5 },
  'glm-4.5-air': { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  'glm-4-flash': { inputPerMillion: 0, outputPerMillion: 0 },
};

// OpenRouter — the subset actually configured / referenced in this project.
// Prices reflect OpenRouter's posted rates at time of writing.
const OPENROUTER_PRICES: Record<string, ModelPricing> = {
  'openai/gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'openai/gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'openai/gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'openai/o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'anthropic/claude-4-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'anthropic/claude-4-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'anthropic/claude-4.5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'anthropic/claude-haiku-4': { inputPerMillion: 1, outputPerMillion: 5 },
  'anthropic/claude-haiku-4.5': { inputPerMillion: 1, outputPerMillion: 5 },
  'google/gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'google/gemini-2.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'google/gemini-2.0-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  // z.ai rate-limit/timeout fallback (see getFallbackModel). OpenRouter posted rates 2026-07.
  'google/gemini-3.1-flash-lite-preview': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'deepseek/deepseek-chat': { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  'deepseek/deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'meta-llama/llama-3.3-70b-instruct': { inputPerMillion: 0.13, outputPerMillion: 0.4 },
};

/** Returns null when the (provider, model) is unknown. Caller writes null
 *  cost in that case — that's a visible "we don't know" signal in charts,
 *  not a silently understated zero. */
export function priceFor(provider: string, model: string): ModelPricing | null {
  if (provider === 'zai') return ZAI_PRICES[model] ?? null;
  if (provider === 'openrouter') return OPENROUTER_PRICES[model] ?? null;
  return null;
}

export function computeCost(
  pricing: ModelPricing,
  tokensInput: number,
  tokensOutput: number,
): number {
  return (
    (tokensInput * pricing.inputPerMillion) / PER_MILLION +
    (tokensOutput * pricing.outputPerMillion) / PER_MILLION
  );
}
