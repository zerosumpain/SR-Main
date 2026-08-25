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
 * already stored these six values and $lib/builds/settings re-exports them from
 * here, so a build's thinking level and a chat's are the same vocabulary rather
 * than two lists that drift.
 */
import type { ModelProvider } from '$lib/server/models/types';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === 'string' && (THINKING_LEVELS as readonly string[]).includes(v);
}

/**
 * The levels a picker should OFFER for a provider — not the whole ladder.
 *
 * Every level below still maps to something the provider honours (see
 * `thinkingRequestParams`), but an option that silently clamps onto its
 * neighbour is a lie in a dropdown. Two levels are missing per provider:
 *
 *  - Codex has no "off": the Codex agent always reasons, and the GPT-5.6 line
 *    additionally 400s on `minimal` (see piThinkingLevel, PR #151).
 *  - OpenRouter's unified effort enum is low/medium/high. `minimal` and `xhigh`
 *    are OpenAI-only spellings that do not survive the translation layer.
 */
const OPENROUTER_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
const CODEX_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'];

export function thinkingLevelsFor(provider: ModelProvider): ThinkingLevel[] {
  return provider === 'codex' ? CODEX_LEVELS : OPENROUTER_LEVELS;
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
 * The request fields that carry a thinking level, ready to spread into a
 * chat-completions body. Empty object for "no level chosen" — the provider's
 * own default then applies, which is what every call did before this existed.
 *
 * Levels outside a provider's offered list are clamped rather than dropped: a
 * conversation can carry a level chosen while it was pinned to the other
 * provider, and clamping keeps the user's INTENT (think hard / think little)
 * instead of silently reverting them to the default.
 */
export function thinkingRequestParams(
  provider: ModelProvider,
  level: ThinkingLevel | null | undefined,
): Record<string, unknown> {
  if (!level) return {};
  if (provider === 'codex') {
    return { reasoning_effort: level === 'off' || level === 'minimal' ? 'low' : level };
  }
  // `enabled: false` is OpenRouter's own switch for models where reasoning is
  // optional — the fix for a GLM reply truncated because reasoning tokens ate
  // the max_tokens budget. Models that cannot stop reasoning ignore it.
  if (level === 'off') return { reasoning: { enabled: false } };
  const effort = level === 'minimal' ? 'low' : level === 'xhigh' ? 'high' : level;
  return { reasoning: { effort } };
}
