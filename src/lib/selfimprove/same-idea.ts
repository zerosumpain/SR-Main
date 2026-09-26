// src/lib/selfimprove/same-idea.ts
//
// PURE. "Is this the idea we already have?" — asked at the two doors an idea
// can come through on its way to a build: the improvement backlog's intake
// (`intakeIdeas`) and the change-request lane (`createChangeRequest`).
//
// Exact slug equality was the only test before D3 (spec 2026-09-25). That
// merges the same idea arriving under the same words and nothing else, so the
// think loop, the workflow doctor and the nightly question-miner could each
// queue the one idea under three titles — and each queued title could become
// its own £2 build.
//
// No new NLP. The comparison is `titleSimilarity` at `TITLE_ECHO_SIMILARITY`,
// the rule the think loop already uses (`refutations.liveEchoOf`) to call two
// notes the same claim. Titles only: detail is generated prose, and prose
// matches on its template rather than its subject (the lesson written up in
// `narrative.looksSameSubject`).

import { TITLE_ECHO_SIMILARITY, titleSimilarity } from '$lib/utils/title-similarity';

/** The bar two titles must clear to be one idea. Named, so a test can pin it
 *  to the think loop's own threshold rather than to a copy of the number. */
export const SAME_IDEA_SIMILARITY = TITLE_ECHO_SIMILARITY;

/** Do these two titles name the same idea? */
export function isSameIdea(a: string, b: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return titleSimilarity(a, b) >= SAME_IDEA_SIMILARITY;
}

/**
 * The closest item whose title names the same idea, or null.
 *
 * Best score wins rather than first match, so an idea lands on the twin that
 * reads most like it when two older items both clear the bar.
 */
export function findSameIdea<T extends { title: string }>(title: string, items: readonly T[]): T | null {
  if (!title?.trim()) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = titleSimilarity(title, item.title ?? '');
    if (score < SAME_IDEA_SIMILARITY) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}
