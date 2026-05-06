/**
 * Lightweight cost estimation for heartbeat LLM turns. Uses
 * priceSnapshot.{promptPrice,completionPrice} when available (set on
 * conversations using OpenRouter), falls back to a baked-in zai map for
 * the GLM family.
 *
 * Prices are USD per 1M tokens. Refine if zai publishes a SKU page.
 */

const ZAI_PRICES_USD_PER_M: Record<string, [number, number]> = {
  'glm-5-turbo': [0.5, 1.5],
  'glm-5.1': [0.5, 1.5],
  'glm-5': [0.6, 1.6],
  'glm-4.6': [0.4, 1.2],
  'glm-4.5': [0.3, 1.0],
};

export interface PriceLike {
  /** USD per token (NOT per 1M) — to match openrouter_models semantics. */
  promptPrice: number;
  completionPrice: number;
}

export function getModelDefaultPrice(modelId: string): PriceLike {
  const entry = ZAI_PRICES_USD_PER_M[modelId];
  if (!entry) return { promptPrice: 0.5e-6, completionPrice: 1.5e-6 };
  return { promptPrice: entry[0] / 1_000_000, completionPrice: entry[1] / 1_000_000 };
}

export function costFromUsage(price: PriceLike, promptTokens: number, completionTokens: number): number {
  return promptTokens * price.promptPrice + completionTokens * price.completionPrice;
}
