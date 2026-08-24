import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';

/**
 * Toolsets carried forward from earlier turns in this conversation.
 *
 * `inferToolsets` only ever reads the CURRENT message, and `activatedToolsets`
 * is a fresh Set every turn, so nothing survives a terse follow-up. Measured
 * 2026-08-13: after a deck was designed using the real deck vocabulary, "build
 * it" matched only `builds` — the jkai app builder — and UNLOADED `decks` and
 * `presentations`. The deck was never created. "yes" and "go on then" match
 * nothing at all, and the model then spends tool rounds rediscovering the
 * toolset it was using a minute ago. Each of those rounds costs a full Codex
 * round trip (~4.3s floor, measured), so this is a latency fix as much as a
 * correctness one.
 *
 * Deliberately derived from history rather than stored: the conversation is
 * already loaded, so this needs no cache, no schema change and nothing to
 * invalidate. Bounded on both axes — how far back it looks, and how much it
 * may add — because every carried toolset is more schemas in the prompt, and
 * `builds` alone is ~14KB of definitions.
 */
const CARRY_LOOKBACK_TURNS = 3;
const MAX_CARRIED_TOOLSETS = 3;

export function carriedToolsets(
  history: Array<{ role: string; content: string }>,
  currentMatches: string[],
): string[] {
  const already = new Set(currentMatches);
  const recentUserTurns = history
    .filter((m) => m.role === 'user' && typeof m.content === 'string')
    .slice(-CARRY_LOOKBACK_TURNS)
    .reverse(); // most recent first — the nearest turn's context wins the budget

  const carried: string[] = [];
  for (const turn of recentUserTurns) {
    for (const ts of inferToolsets(turn.content)) {
      if (already.has(ts)) continue;
      already.add(ts);
      carried.push(ts);
      if (carried.length >= MAX_CARRIED_TOOLSETS) return carried;
    }
  }
  return carried;
}
