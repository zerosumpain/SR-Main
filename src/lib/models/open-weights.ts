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
// This module layers three corrections over the raw field:
//
//   1. Sibling inheritance — a `:variant` row, or a hosted-variant suffix
//      (`-turbo`/`-thinking`/`-preview`), inherits the id of its base model
//      when that base is in the same catalogue. Self-maintaining: a future
//      `<something>-turbo` is picked up with no code change.
//   2. An explicit override map for models with no mapped sibling.
//   3. OpenRouter's own prose — a description that calls the model
//      "open-weight"/"open weights" is OpenRouter stating it outright, even
//      when it left the structured field blank. Measured across the live
//      345-model catalogue this adds exactly two rows (kimi-k3, minimax-m1)
//      and zero false positives, and it independently agrees with the
//      hand-curated entry for minimax-m1. Also self-maintaining.
//
// A model can be open with NO known repo (layer 3), so `open` is tracked
// separately from `huggingFaceId` — never infer one from the other.
//
// VERIFYING A REPO: use the listing APIs
//   https://huggingface.co/api/models?author=<org>&limit=200
//   https://huggingface.co/api/models?search=<name>
// and NOT `api/models/<id>`. That per-repo endpoint returns 401 for a missing
// repo and 401 for a gated one — a control request for an invented name
// returns 401 too, so a 401 proves nothing. An earlier pass used it as
// "not public" and wrongly wrote off kimi-k3 on that basis.
//
// Pure + dependency-free so it can be unit-tested and imported from either the
// admin API route or the routing selector.

/** Hosted-variant suffixes that denote the same weights served differently. */
const VARIANT_SUFFIXES = ['-turbo', '-thinking', '-preview'] as const;

/** OpenRouter saying so in prose. Deliberately narrow — "open-source" and
 *  "open model" are not matched, because vendors use those for API-only models
 *  with a permissive licence. */
const OPEN_WEIGHT_PROSE = /\bopen[-\s]weights?\b/i;

/**
 * Explicit id → Hugging Face repo for open-weight models OpenRouter leaves
 * blank. Verify a repo with the author/search listing APIs (see the header
 * note) — every id here was seen in one of those listings.
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
 * Treated as CLOSED, on evidence rather than absence: none appears in its org's
 * HF listing, and OpenRouter's description does not claim open weights. Listed
 * so a future pass re-checks rather than re-discovers. Not used at runtime.
 *
 * (`moonshotai/kimi-k3` was here and should not have been — OpenRouter calls it
 * open-weight in prose, which layer 3 now picks up. Its canonical repo is still
 * not discoverable on HF, so it resolves as open with a null repo.)
 */
export const UNRESOLVED = [
  'inclusionai/ling-3.0-flash:free', // no Ling-3.0-flash in the inclusionAI listing
  'minimax/minimax-m2-her', // MiniMaxAI lists M1/M2/M2.x/M3, no -her
  'z-ai/glm-5v-turbo', // no zai-org/GLM-5V; glm-5v is not in the catalogue to inherit from
] as const;

/** The raw `hugging_face_id` off a catalogue row's stored payload, trimmed. */
export function rawHuggingFaceId(raw: unknown): string | null {
  const hf = (raw as { hugging_face_id?: unknown } | null)?.hugging_face_id;
  if (typeof hf !== 'string') return null;
  const trimmed = hf.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The model description off a catalogue row's stored payload. */
function rawDescription(raw: unknown): string {
  const d = (raw as { description?: unknown } | null)?.description;
  return typeof d === 'string' ? d : '';
}

/** Minimal row shape the resolver needs — id plus the stored OpenRouter payload. */
export interface OpenWeightRow {
  id: string;
  raw: unknown;
}

/** Which layer decided a model is open — surfaced in the UI so a resolved
 *  override can be audited without reading this file. */
export type OpenWeightSource = 'openrouter' | 'override' | 'inherited' | 'description';

export interface OpenWeightVerdict {
  open: boolean;
  /** Null for an open model whose repo is not published or not discoverable. */
  huggingFaceId: string | null;
  source: OpenWeightSource | null;
}

const CLOSED: OpenWeightVerdict = { open: false, huggingFaceId: null, source: null };

/**
 * Build a resolver over a whole catalogue. Sibling inheritance and the prose
 * signal both need the other rows, so this is catalogue-scoped, not per-row.
 */
export function buildOpenWeightResolver(rows: readonly OpenWeightRow[]) {
  const direct = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const row of rows) {
    const hf = rawHuggingFaceId(row.raw);
    if (hf) direct.set(row.id, hf);
    const desc = rawDescription(row.raw);
    if (desc) descriptions.set(row.id, desc);
  }

  /** Base slug with any `:variant` suffix removed (`a/b:free` → `a/b`). */
  const baseOf = (id: string) => {
    const colon = id.indexOf(':');
    return colon > 0 ? id.slice(0, colon) : id;
  };

  const cache = new Map<string, OpenWeightVerdict>();

  function resolve(id: string): OpenWeightVerdict {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    const verdict = ((): OpenWeightVerdict => {
      const own = direct.get(id);
      if (own) return { open: true, huggingFaceId: own, source: 'openrouter' };
      const override = OPEN_WEIGHT_OVERRIDES[id];
      if (override) return { open: true, huggingFaceId: override, source: 'override' };

      const base = baseOf(id);
      // 1. `:variant` rows are the same model — inherit from the base row.
      if (base !== id) {
        const inherited = direct.get(base) ?? OPEN_WEIGHT_OVERRIDES[base];
        if (inherited) return { open: true, huggingFaceId: inherited, source: 'inherited' };
      }
      // 2. Hosted-variant suffix on the base slug.
      for (const suffix of VARIANT_SUFFIXES) {
        if (!base.endsWith(suffix)) continue;
        const stripped = base.slice(0, -suffix.length);
        const inherited = direct.get(stripped) ?? OPEN_WEIGHT_OVERRIDES[stripped];
        if (inherited) return { open: true, huggingFaceId: inherited, source: 'inherited' };
      }
      // 3. OpenRouter says so in prose but published no repo id. Open, repo unknown.
      const desc = descriptions.get(id) ?? descriptions.get(base) ?? '';
      if (OPEN_WEIGHT_PROSE.test(desc)) {
        return { open: true, huggingFaceId: null, source: 'description' };
      }
      return CLOSED;
    })();

    cache.set(id, verdict);
    return verdict;
  }

  return {
    /** Full verdict — open flag, repo (may be null even when open), and which
     *  layer decided it. */
    verdict: resolve,
    /** The Hugging Face repo backing this model, or null when it is closed OR
     *  open with no discoverable repo. NOT a substitute for `isOpen`. */
    huggingFaceId: (id: string) => resolve(id).huggingFaceId,
    /** True when the model's weights are published. */
    isOpen: (id: string) => resolve(id).open,
  };
}

export type OpenWeightResolver = ReturnType<typeof buildOpenWeightResolver>;
