/**
 * Thinking levels — one ladder, two wire formats.
 *
 * A reasoning model can be told how hard to think. Both providers accept that
 * instruction and neither spells it the same way, so the mapping lives here
 * rather than at the call site:
 *
 *  - OpenRouter takes its unified `reasoning` object. It is the right field to
 *    send even for models that advertise OpenAI's `reasoning_effort`, because
 *    OpenRouter translates `reasoning.effort` per provider — into a thinking
 *    token budget for Anthropic, into `reasoning_effort` for OpenAI — and the
 *    catalogue says 206 of 338 models take `reasoning` against only 83 that
 *    take `reasoning_effort`. Sending the narrow field would silently skip
 *    every Claude model.
 *  - The Codex bridge takes `reasoning_effort` (packages/jkai-codex-bridge),
 *    which it hands to the SDK as `modelReasoningEffort`.
 *
 * THE LADDER IS SHARED WITH BUILDS on purpose. `jkai_builds.thinking_level`
 * already stored these values and $lib/builds/settings re-exports them from
 * here, so a build's thinking level and a chat's are the same vocabulary rather
 * than two lists that drift. It is a `text` column, so adding a rung needs no
 * migration — but pi does not accept the top two, see `piThinkingLevel`.
 */
import type { ModelProvider } from '$lib/server/models/types';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === 'string' && (THINKING_LEVELS as readonly string[]).includes(v);
}

/**
 * The levels a picker should OFFER for a provider — not the whole ladder.
 *
 * Every level below still maps to something the provider honours (see
 * `thinkingRequestParams`), but an option that silently clamps onto its
 * neighbour is a lie in a dropdown. What each provider does not get:
 *
 *  - Codex has no "off": the Codex agent always reasons, and the GPT-5.6 line
 *    additionally 400s on `minimal` (see piThinkingLevel, PR #151).
 *  - OpenRouter's unified effort enum is low/medium/high. `minimal`, `xhigh`
 *    and `max` are OpenAI-only spellings that do not survive the translation
 *    layer.
 *  - `max` is per-MODEL on Codex rather than per-provider — the 5.6 line and
 *    Astra take it, everything older answers `Unsupported value: 'max' is not
 *    supported with the '<model>' model`. That is what `modelId` is for; omit
 *    it and you get the conservative list, which is what every caller got
 *    before Astra landed.
 */
const OPENROUTER_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
const CODEX_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The deepest effort each Codex model accepts, by bare slug.
 *
 * Source: what the API actually ACCEPTED, one call per model against the
 * production bridge on 2026-09-05 — not the catalogue's own
 * `supported_reasoning_levels`, which is where the first version of this table
 * came from and was wrong. The catalogue advertises `ultra` on Astra, Sol and
 * Terra; the Responses API refuses it on all three with `Invalid value:
 * 'ultra'. Supported values are: 'none', 'minimal', 'low', 'medium', 'high',
 * 'xhigh', and 'max'`. So the catalogue describes a rung this transport cannot
 * reach, and the ladder stops at `max`. Re-measure rather than re-read when a
 * model ships.
 *
 * The table lives on THIS side of the server boundary because the chat picker
 * runs in the browser and cannot import `$lib/server/*`; codex-catalogue.test
 * asserts every catalogued model has an entry here, so the two cannot drift
 * apart silently.
 *
 * An unknown slug gets `xhigh` — every Codex model has always accepted that, so
 * a model nobody has catalogued is never offered an effort that 400s.
 */
export const CODEX_EFFORT_CEILING: Record<string, ThinkingLevel> = {
  'gpt-6-astra': 'max',
  'gpt-5.6-sol': 'max',
  'gpt-5.6-terra': 'max',
  'gpt-5.6-luna': 'max',
  'gpt-5.5': 'xhigh',
  'gpt-5.3-codex-spark': 'xhigh',
};

/** Bare slug from a possibly-prefixed id. `toCodexSlug` does the same job, but
 *  it lives in `$lib/server/*` and this module is imported by the chat UI. */
function codexSlug(modelId: string | null | undefined): string {
  const id = modelId ?? '';
  return id.startsWith('codex/') ? id.slice('codex/'.length) : id;
}

export function thinkingLevelsFor(
  provider: ModelProvider,
  modelId?: string | null,
): ThinkingLevel[] {
  if (provider !== 'codex') return OPENROUTER_LEVELS;
  const ceiling = CODEX_EFFORT_CEILING[codexSlug(modelId)] ?? 'xhigh';
  return CODEX_LEVELS.slice(0, CODEX_LEVELS.indexOf(ceiling) + 1);
}

/**
 * Whether a model will do anything with a thinking level.
 *
 * `raw` is the OpenRouter catalogue record (`openrouter_models.raw`). The gate
 * is `supported_parameters` containing `reasoning`, read the same way the model
 * table reads `tools` — the catalogue is refreshed nightly, so this answer
 * tracks OpenRouter instead of a hand-kept list going stale the way the old
 * capability map did.
 *
 * Every Codex model reasons, and the bridge validates the effort itself, so
 * Codex needs no catalogue row (it has none — see codex-catalogue).
 */
export function supportsThinking(provider: ModelProvider, raw: unknown): boolean {
  if (provider === 'codex') return true;
  const params = (raw as { supported_parameters?: unknown } | null)?.supported_parameters;
  return Array.isArray(params) && params.includes('reasoning');
}

/**
 * The ladder collapsed onto OpenRouter's unified enum.
 *
 * Total on purpose: adding a rung to THINKING_LEVELS now fails the typecheck
 * here rather than quietly sending OpenRouter an effort it has never heard of,
 * which is how `xhigh` used to reach it before the explicit ternary was added.
 */
const OPENROUTER_EFFORT: Record<Exclude<ThinkingLevel, 'off'>, 'low' | 'medium' | 'high'> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

/**
 * The request fields that carry a thinking level, ready to spread into a
 * chat-completions body. Empty object for "no level chosen" — the provider's
 * own default then applies, which is what every call did before this existed.
 *
 * Levels outside a provider's offered list are clamped rather than dropped: a
 * conversation can carry a level chosen while it was pinned to the other
 * provider, and clamping keeps the user's INTENT (think hard / think little)
 * instead of silently reverting them to the default. `modelId` extends that to
 * the per-model Codex ceiling — pass it wherever you know it.
 */
export function thinkingRequestParams(
  provider: ModelProvider,
  level: ThinkingLevel | null | undefined,
  modelId?: string | null,
): Record<string, unknown> {
  if (!level) return {};
  if (provider === 'codex') {
    if (level === 'off' || level === 'minimal') return { reasoning_effort: 'low' };
    // A conversation can carry `max` from a model that reasons that deep and
    // then be pointed at one that does not: gpt-5.5 answers `max` with a 400,
    // not with less thinking. Clamp to this model's own ceiling.
    const offered = thinkingLevelsFor('codex', modelId);
    const effort = offered.includes(level) ? level : offered[offered.length - 1];
    return { reasoning_effort: effort };
  }
  // `enabled: false` is OpenRouter's own switch for models where reasoning is
  // optional — the fix for a GLM reply truncated because reasoning tokens ate
  // the max_tokens budget. Models that cannot stop reasoning ignore it.
  if (level === 'off') return { reasoning: { enabled: false } };
  return { reasoning: { effort: OPENROUTER_EFFORT[level] } };
}
