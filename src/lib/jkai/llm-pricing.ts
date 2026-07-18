/**
 * Per-million-token pricing for LLM calls (OpenRouter-only since 2026-07-17).
 *
 * Primary source: the openrouter_models catalogue table (refreshed from
 * OpenRouter's /api/v1/models), loaded into an in-memory map on first use so
 * `priceFor` stays synchronous for the usage-capture hot path. The small
 * hard-coded table below is the fallback while the catalogue warm-up is in
 * flight (first call after boot) or if the DB is unavailable.
 *
 * Unknown models return null and the gateway wrapper writes null cost — never
 * a fabricated zero, which would silently understate spend in charts.
 *
 * `cacheReadTokens` and `reasoningTokens` are captured as columns for later
 * breakdown but are NOT re-priced here — cache reads are folded into
 * prompt_tokens by every provider, and reasoning tokens are folded into
 * completion_tokens.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PER_MILLION = 1_000_000;

// Static fallback subset — models referenced by code defaults. OpenRouter
// posted rates 2026-07.
const OPENROUTER_PRICES: Record<string, ModelPricing> = {
  'z-ai/glm-5.2': { inputPerMillion: 0.92, outputPerMillion: 2.89 },
  'z-ai/glm-5.1': { inputPerMillion: 0.97, outputPerMillion: 3.04 },
  'z-ai/glm-5': { inputPerMillion: 0.95, outputPerMillion: 3.15 },
  'z-ai/glm-5-turbo': { inputPerMillion: 1.2, outputPerMillion: 4 },
  'z-ai/glm-4.7': { inputPerMillion: 0.4, outputPerMillion: 1.75 },
  'z-ai/glm-4.7-flash': { inputPerMillion: 0.06, outputPerMillion: 0.4 },
  'z-ai/glm-4.6': { inputPerMillion: 0.5, outputPerMillion: 2 },
  'google/gemini-3.1-flash-lite-preview': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'google/gemini-2.0-flash-001': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

// In-memory price map warmed from the openrouter_models catalogue. priceFor()
// is called synchronously inside usage capture, so the warm-up is fire-and-
// forget: the first few calls after boot may fall back to the static table.
let cataloguePrices: Map<string, ModelPricing> | null = null;
let warmInFlight = false;

function warmCataloguePrices(): void {
  if (cataloguePrices || warmInFlight) return;
  warmInFlight = true;
  (async () => {
    const { db } = await import('$lib/db');
    const { openrouterModels } = await import('$lib/db/schema');
    const rows = await db
      .select({
        id: openrouterModels.id,
        promptPrice: openrouterModels.promptPrice,
        completionPrice: openrouterModels.completionPrice,
      })
      .from(openrouterModels);
    const map = new Map<string, ModelPricing>();
    for (const r of rows) {
      const input = Number(r.promptPrice);
      const output = Number(r.completionPrice);
      if (Number.isFinite(input) && Number.isFinite(output)) {
        // Catalogue stores USD per token; convert to per-million.
        map.set(r.id, { inputPerMillion: input * PER_MILLION, outputPerMillion: output * PER_MILLION });
      }
    }
    if (map.size > 0) cataloguePrices = map;
  })().catch(() => {
    // DB unavailable — stay on the static fallback; retry on a later call.
    warmInFlight = false;
  });
}

/** Test/refresh hook: drop the warmed catalogue map. */
export function clearPriceCache(): void {
  cataloguePrices = null;
  warmInFlight = false;
}

/** Returns null when the model is unknown. Caller writes null cost in that
 *  case — that's a visible "we don't know" signal in charts, not a silently
 *  understated zero. */
export function priceFor(provider: string, model: string): ModelPricing | null {
  if (provider !== 'openrouter') return null;
  warmCataloguePrices();
  return cataloguePrices?.get(model) ?? OPENROUTER_PRICES[model] ?? null;
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
