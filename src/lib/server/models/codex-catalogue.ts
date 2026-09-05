/**
 * The Codex model catalogue.
 *
 * Unlike OpenRouter's ~340 models, this list is short, stable and NOT fetched
 * from a remote endpoint — there is no public catalogue API behind the Codex
 * subscription flow. It is a hand-maintained table, in the same spirit as
 * $lib/models/open-weights' override map.
 *
 * WHY A SEPARATE TABLE RATHER THAN ROWS IN `openrouter_models`:
 * `refreshOpenRouterCatalogue()` does a `delete()` + `insert()` of the whole
 * table from OpenRouter's /models response. Any Codex row parked in there would
 * be wiped by the next refresh (nightly, and on demand from the admin panel).
 * So Codex models live in code and are served by their own endpoint
 * (/api/admin/models/codex); the pickers render them as their own group.
 *
 * PRICING IS DELIBERATELY ABSENT. These models are billed against a ChatGPT
 * Pro subscription, not per token — the marginal cost of a call is zero but the
 * call still consumes a finite weekly/5-hourly quota. Writing 0 into the cost
 * columns would understate spend in exactly the way $lib/llm/pricing's
 * header warns against, so `priceFor` returns null for these and the usage
 * charts label them "subscription" instead of £0.00.
 *
 * QUOTA NOTE, measured 2026-08-08: every Codex call carries ~9,700 input tokens
 * of Codex's own agent instructions before your prompt, and that floor is not
 * reducible (disabling the built-in tools saved exactly zero; no prompt-cache
 * relief either). So Codex suits calls whose prompt is already substantial —
 * chat, research, document summarising — and badly suits high-frequency small
 * ones like entity extraction or title generation, where the overhead dwarfs
 * the work. See packages/jkai-codex-bridge/README.md for the measurements.
 *
 * CONTEXT LENGTHS are null: OpenAI does not publish per-model context windows
 * for the subscription-served Codex variants, and a guess here would show up in
 * the picker as though it were measured. Null renders as "—".
 */

import { isSubscriptionModelId } from '$lib/llm/usage-meter';

/**
 * Reasoning effort levels Codex accepts.
 *
 * WIDER than the SDK's own `ThreadOptions.modelReasoningEffort`, which stops at
 * `xhigh`. The bridge reaches Codex over the Responses API (see
 * responses-transport.ts), which takes `max` and `ultra` as well; only the
 * `sdk` rollback transport is bound by the SDK's spelling, and it clamps rather
 * than 400s.
 *
 * NOT every model accepts the top two — the per-model ceiling is
 * `CODEX_EFFORT_CEILING` in $lib/models/thinking, which lives there rather than
 * here because the chat picker needs it in the browser and `$lib/server/*`
 * cannot cross that boundary. codex-catalogue.test asserts the two agree.
 */
export const CODEX_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export interface CodexModel {
  /** Bare Codex slug, e.g. `gpt-5.6-terra`. Prefixed with `codex/` in a
   *  ModelContext-facing id so a Codex pick can never be mistaken for an
   *  OpenRouter one in persisted state. See toCodexModelId/isCodexModelId. */
  slug: string;
  name: string;
  description: string;
  /** Pro-subscription-only models are hidden for Plus accounts — we can't
   *  detect the tier, so this is advisory text on the badge, not a filter. */
  proOnly?: boolean;
  /** Superseded models kept selectable until OpenAI retires them. */
  retiresOn?: string;
}

/**
 * Source: the account's own catalogue, `GET
 * chatgpt.com/backend-api/codex/models?client_version=<v>`, read 2026-09-05.
 * Re-check when a GPT generation ships — nothing in the code detects a stale
 * entry, a retired slug simply fails at call time with the bridge surfacing
 * Codex's own error.
 *
 * THE CATALOGUE ENDPOINT HIDES NEW MODELS FROM OLD CLIENTS. Each row carries a
 * `minimal_client_version` and the listing is filtered by the `client_version`
 * query parameter: Astra (`minimal_client_version: 0.153.0`) is simply absent
 * when you ask as 0.147.0, which is the SDK version this repo pins. That gate
 * is on the LISTING only — the Responses API itself accepts Astra from any
 * client, verified end-to-end against the production bridge before this row was
 * added — so reading "not in my catalogue" as "not available to us" would have
 * been wrong. Pass a current `client_version` when checking for new models.
 */
export const CODEX_MODELS: CodexModel[] = [
  {
    slug: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    description:
      'GPT-6 flagship, and the site default. State of the art on coding, computer use, research and professional work; 272k context and the deepest reasoning ladder Codex offers.',
  },
  {
    slug: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description:
      'Flagship GPT-5.6 — strongest on complex coding, computer use, research and cybersecurity. Slowest and heaviest on quota.',
  },
  {
    slug: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'Balanced GPT-5.6 for everyday work. The Codex default.',
  },
  {
    slug: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'Fast GPT-5.6 — strong capability at the lowest quota cost. Best fit for background site tasks.',
  },
  {
    slug: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    description: 'Text-only research preview for real-time coding iteration.',
    proOnly: true,
  },
  {
    slug: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Previous-generation frontier model. Kept for comparison against the 5.6 line.',
  },
];

/**
 * The model a Codex pick falls back to when none is named.
 *
 * Astra since 2026-09-05, taking over from Terra: it is the frontier model on
 * the same subscription, so the fallback costs the same quota shape it always
 * did. This is also the model the OpenRouter failover lands on when credit runs
 * out ($lib/llm/client), which is the case that most wants the better model.
 */
export const DEFAULT_CODEX_MODEL_SLUG = 'gpt-6-astra';

/** ModelContext ids carry the `codex/` prefix so provider is recoverable from
 *  the id alone — persisted rows, localStorage and workflow node configs all
 *  store a bare string in places, and a bare `gpt-5.6-terra` would be sent to
 *  OpenRouter as an unknown slug. */
export function toCodexModelId(slug: string): string {
  return slug.startsWith('codex/') ? slug : `codex/${slug}`;
}

/** Delegates so the rule has one home: the header and the usage meter need the
 *  same test from the browser, and `$lib/server/*` cannot cross that boundary. */
export function isCodexModelId(modelId: string): boolean {
  return isSubscriptionModelId(modelId);
}

/** Strip the `codex/` prefix back to the slug the Codex CLI expects. */
export function toCodexSlug(modelId: string): string {
  return modelId.startsWith('codex/') ? modelId.slice('codex/'.length) : modelId;
}

export function findCodexModel(modelId: string): CodexModel | undefined {
  const slug = toCodexSlug(modelId);
  return CODEX_MODELS.find((m) => m.slug === slug);
}
