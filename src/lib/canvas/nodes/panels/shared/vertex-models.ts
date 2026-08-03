// Shared model option lists for LLM-flavoured node panels.
//
// All LLM traffic now routes through OpenRouter (the direct z.ai subscription
// was decommissioned 2026-07-17). GLM models remain available via OpenRouter's
// `z-ai/*` slugs. Routing via `resolveLLMClient`
// (src/lib/workflows/nodes/llm-helpers.ts):
//
//   - empty / sentinel       → admin chat default (an OpenRouter slug)
//   - slashed id (e.g.       → OpenRouter, used verbatim
//     `z-ai/glm-5.2`, `openai/gpt-4o`)
//   - bare id (legacy, no    → mapped to its `z-ai/*` slug, then OpenRouter
//     slash, e.g. `glm-5.2`)
//
// So the panels list slashed OpenRouter ids (the default provider is
// OpenRouter) and the routing falls out automatically. This file just keeps
// the list in one place so all the panels render the same options.

export interface ModelOption {
  /** Stored as `config.model`. Empty string → admin default. */
  value: string;
  /** Human-readable label for the dropdown. */
  label: string;
}

/**
 * Default option list for jkai-flavoured LLM nodes (LlmCall, LlmAgent,
 * LlmRouter). Includes the empty "Default" sentinel so users can fall
 * back to the admin-configured chat default.
 */
export const VERTEX_MODEL_OPTIONS: ModelOption[] = [
  { value: '', label: 'Default (site setting)' },
  { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
  { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
  { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
  { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

// The Think panel used to have its own THINK_MODEL_OPTIONS list, which omitted
// the "Default" sentinel and labelled `z-ai/glm-5-turbo` as the jkai default —
// pushing every new Think node onto a model two generations stale. Once that was
// fixed the list was byte-identical to VERTEX_MODEL_OPTIONS, i.e. a second copy
// to keep in sync by hand. ThinkPanel now uses `fetchAllChatModels` directly,
// like the other LLM panels. Don't reintroduce a per-panel list.

/**
 * Fetcher for `<ModelSelect fetcher={...} />`. Returns the live OpenRouter
 * catalogue from /api/admin/models/openrouter PRECEDED by the curated GLM
 * + "Default" entries. Lifted from OpenRouterPanel so every LLM-flavoured
 * panel (LlmCall, LlmAgent, LlmRouter, Think) renders the same list and
 * users aren't constrained to the hand-picked subset.
 *
 * Static options come first so "Default" stays at the top and the curated
 * GLM slugs (`z-ai/*`) stay visible above the full catalogue. Dedups by value
 * to keep the list clean.
 */
export interface FetchedModel { value: string; label: string; meta?: string }

/**
 * Map a model's completion price (USD per token, as the OpenRouter catalogue
 * stores it) to a 1–5 cost tier shown in the dropdown label. Bands are
 * chosen against typical 2026-Q2 OpenRouter completion pricing so each
 * tier carves out a meaningful slice of the catalogue.
 *
 *   [1/5] ≤ $0.50 / 1M tok   small / fast (gemini-flash, gpt-4o-mini, llama)
 *   [2/5] ≤ $2.50            cheap mid    (haiku, llama-large, mistral)
 *   [3/5] ≤ $10              mid          (gpt-4o, sonnet, gemini-pro)
 *   [4/5] ≤ $30              expensive    (gpt-4-turbo, claude opus older)
 *   [5/5] > $30              top tier     (opus 4.x, o1, premium frontier)
 */
function costTier(completionPricePerToken: number | null): 1 | 2 | 3 | 4 | 5 | null {
  if (completionPricePerToken == null || !Number.isFinite(completionPricePerToken)) return null;
  const perM = completionPricePerToken * 1_000_000;
  if (perM <= 0) return null; // free / sponsored — no useful tier
  if (perM <= 0.5) return 1;
  if (perM <= 2.5) return 2;
  if (perM <= 10) return 3;
  if (perM <= 30) return 4;
  return 5;
}

async function fetchLiveCatalogue(): Promise<FetchedModel[]> {
  try {
    const res = await fetch('/api/admin/models/openrouter?pageSize=500&sortBy=id&sortDir=asc');
    if (!res.ok) return [];
    const data = (await res.json()) as {
      rows?: Array<{
        id: string;
        name: string | null;
        provider: string | null;
        completionPrice: string | number | null;
      }>;
    };
    return (data.rows ?? []).map((r) => {
      const price = r.completionPrice == null ? null : Number(r.completionPrice);
      const tier = costTier(price);
      const display = r.name && r.name !== r.id ? `${r.name} — ${r.id}` : r.id;
      const label = tier ? `[${tier}/5] ${display}` : display;
      return { value: r.id, label, meta: r.provider ?? undefined };
    });
  } catch {
    // Network/auth failure → fall back to the static list silently. The
    // panel will still render usable options.
    return [];
  }
}

/**
 * What the "" sentinel actually resolves to right now — the same value the
 * /jkai model picker's "site default" chip writes. Shown in the option label so
 * a node left on "Default" says which model it will run, without freezing that
 * id into the node's config (a stored snapshot would stop tracking the picker).
 */
async function fetchSiteDefaultModelId(): Promise<string | null> {
  try {
    const res = await fetch('/api/jkai/routing/overrides');
    if (!res.ok) return null;
    const data = (await res.json()) as { siteDefaultModelId?: string };
    return data.siteDefaultModelId ?? null;
  } catch {
    return null;
  }
}

export async function fetchAllChatModels(staticPrefix: ModelOption[] = VERTEX_MODEL_OPTIONS): Promise<FetchedModel[]> {
  const [live, siteDefaultModelId] = await Promise.all([fetchLiveCatalogue(), fetchSiteDefaultModelId()]);
  const prefix: FetchedModel[] = staticPrefix.map((o) =>
    o.value === '' && siteDefaultModelId
      ? { value: o.value, label: `Default (site setting → ${siteDefaultModelId})` }
      : { value: o.value, label: o.label },
  );
  const seen = new Set(prefix.map((o) => o.value));
  return [...prefix, ...live.filter((o) => !seen.has(o.value))];
}
