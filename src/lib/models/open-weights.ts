// Open-weight detection for the OpenRouter catalogue.
//
// OpenRouter's own signal is the `hugging_face_id` field on /api/v1/models —
// populated for open-weight models only, so it needs no curated vendor list.
// The problem is that it is populated INCONSISTENTLY: hosted variants of an
// open model (`z-ai/glm-5-turbo`) and a handful of older/newer entries ship
// with the field blank even though the weights are public. Those models then
// lose the OPEN badge, fall out of the "open only" filter, and miss the
// open-weight bonus in nightly routing selection.
//
// This module layers two corrections over the raw field:
//
//   1. Sibling inheritance — a `:variant` row, or a hosted-variant suffix
//      (`-turbo`/`-thinking`/`-preview`), inherits the id of its base model
//      when that base is in the same catalogue. Self-maintaining: a future
//      `<something>-turbo` is picked up with no code change.
//   2. An explicit override map for models with no mapped sibling.
//
// Every override was checked against the live Hugging Face API (2026-07-26) —
// only repos returning 200 are listed. Models that LOOK open but have no
// public repo under any tried name are deliberately absent, and listed in
// UNRESOLVED below so the next pass doesn't re-litigate them.
//
// Pure + dependency-free so it can be unit-tested and imported from either the
// admin API route or the routing selector.

/** Hosted-variant suffixes that denote the same weights served differently. */
const VARIANT_SUFFIXES = ['-turbo', '-thinking', '-preview'] as const;

/**
 * Explicit id → Hugging Face repo for open-weight models OpenRouter leaves
 * blank. Keep entries verified: `curl -o /dev/null -w '%{http_code}'
 * https://huggingface.co/api/models/<repo>` must return 200.
 */
export const OPEN_WEIGHT_OVERRIDES: Readonly<Record<string, string>> = {
  'minimax/minimax-m1': 'MiniMaxAI/MiniMax-M1-80k',
  'inclusionai/ling-2.6-flash': 'inclusionAI/Ling-2.6-flash',
  'inclusionai/ling-2.6-1t': 'inclusionAI/Ling-2.6-1T',
  'inclusionai/ring-2.6-1t': 'inclusionAI/Ring-2.6-1T',
  // Cohere moved its org from CohereForAI to CohereLabs — the old paths 307.
  'cohere/command-r-08-2024': 'CohereLabs/c4ai-command-r-08-2024',
  'cohere/command-r-plus-08-2024': 'CohereLabs/c4ai-command-r-plus-08-2024',
  'cohere/command-r7b-12-2024': 'CohereLabs/c4ai-command-r7b-12-2024',
};

/**
 * Checked and NOT mapped — no public HF repo found (the API 401s, which is what
 * it returns for both missing and gated repos). Documented so a future pass can
 * re-check rather than re-discover. Not used at runtime.
 */
export const UNRESOLVED = [
  'moonshotai/kimi-k3', // no Kimi-K3 / -Instruct / -Base repo
  'inclusionai/ling-3.0-flash:free', // no Ling-3.0-flash repo under any casing
  'minimax/minimax-m2-her',
  'z-ai/glm-5v-turbo', // zai-org/GLM-5V is not public; glm-5v is not in the catalogue
] as const;

/** The raw `hugging_face_id` off a catalogue row's stored payload, trimmed. */
export function rawHuggingFaceId(raw: unknown): string | null {
  const hf = (raw as { hugging_face_id?: unknown } | null)?.hugging_face_id;
  if (typeof hf !== 'string') return null;
  const trimmed = hf.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Minimal row shape the resolver needs — id plus the stored OpenRouter payload. */
export interface OpenWeightRow {
  id: string;
  raw: unknown;
}

/**
 * Build a resolver over a whole catalogue. Sibling inheritance needs to see the
 * other rows, so this is catalogue-scoped rather than per-row.
 *
 * Returns a function id → HF repo id (or null), and a convenience predicate.
 */
export function buildOpenWeightResolver(rows: readonly OpenWeightRow[]) {
  const direct = new Map<string, string>();
  for (const row of rows) {
    const hf = rawHuggingFaceId(row.raw);
    if (hf) direct.set(row.id, hf);
  }

  /** Base slug with any `:variant` suffix removed (`a/b:free` → `a/b`). */
  const baseOf = (id: string) => {
    const colon = id.indexOf(':');
    return colon > 0 ? id.slice(0, colon) : id;
  };

  const cache = new Map<string, string | null>();

  function resolve(id: string): string | null {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    let hf: string | null = direct.get(id) ?? OPEN_WEIGHT_OVERRIDES[id] ?? null;

    if (!hf) {
      const base = baseOf(id);
      // 1. `:variant` rows are the same model — inherit from the base row.
      if (base !== id) hf = direct.get(base) ?? OPEN_WEIGHT_OVERRIDES[base] ?? null;
      // 2. Hosted-variant suffix on the base slug.
      if (!hf) {
        for (const suffix of VARIANT_SUFFIXES) {
          if (!base.endsWith(suffix)) continue;
          const stripped = base.slice(0, -suffix.length);
          hf = direct.get(stripped) ?? OPEN_WEIGHT_OVERRIDES[stripped] ?? null;
          if (hf) break;
        }
      }
    }

    cache.set(id, hf);
    return hf;
  }

  return {
    /** The Hugging Face repo backing this model id, or null when closed-weight. */
    huggingFaceId: resolve,
    /** True when the model's weights are published. */
    isOpen: (id: string) => resolve(id) !== null,
  };
}

export type OpenWeightResolver = ReturnType<typeof buildOpenWeightResolver>;
