// How hot a story is, on a scale every wire can be measured against.
//
// PURE — stories in, stories out.
//
// THE PROBLEM THIS SOLVES. Ars Technica is an RSS feed with no votes, so
// `ars.ts` hardcodes `score: 0`. The `best` view and the Points sort both order
// by raw score, which means Ars could never rank above ANY Hacker News or
// Lobsters story — not because its articles were worse, but because RSS has no
// voting. The page papered over it with the word "Unscored".
//
// Raw scores are not comparable anyway. A Lobsters story at 40 points is near
// the top of Lobsters; a Hacker News story at 40 is mid-page. Ranking the merged
// desk on the raw number silently ranks the wires against each other rather than
// the stories.
//
// So heat is a story's standing WITHIN ITS OWN WIRE, blended with recency. Each
// wire is scored against itself and the results are comparable, which is the
// only honest way to interleave three populations that do not share a unit.

import type { NewsStory } from './types';

/** Age at which a story contributes no recency at all. */
const RECENCY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * How much of heat is standing within the wire versus freshness.
 *
 * Weighted towards standing: the desk already has a Time sort for people who
 * want the newest thing, so heat earns its place by answering the other
 * question. Recency is still a third of it, because a story that topped the
 * wire two days ago is not what "hot" means.
 */
const STANDING_WEIGHT = 0.65;
const RECENCY_WEIGHT = 0.35;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function recencyOf(publishedAt: string, now: number): number {
  const age = now - Date.parse(publishedAt);
  if (!Number.isFinite(age)) return 0;
  return clamp01(1 - age / RECENCY_WINDOW_MS);
}

/**
 * Attach `heat` to every story, computed per source against that source's own
 * current pull.
 *
 * **A wire whose scores are all identical falls back to recency order within
 * itself.** That is not a special case bolted on for Ars — it is what standing
 * means when a population has no spread. It is the line that lets a scoreless
 * feed rank fairly, and it keeps working for any future RSS source without
 * anything being told about it.
 */
export function withHeat(stories: readonly NewsStory[], now = Date.now()): NewsStory[] {
  const bySource = new Map<string, NewsStory[]>();
  for (const story of stories) {
    const group = bySource.get(story.source);
    if (group) group.push(story);
    else bySource.set(story.source, [story]);
  }

  const standing = new Map<string, number>();
  for (const group of bySource.values()) {
    const scores = group.map((story) => story.score);
    const spread = Math.max(...scores) !== Math.min(...scores);

    if (spread) {
      // Fraction of this wire that this story outscores. Ties share a rank
      // rather than being split arbitrarily by array order.
      const ascending = [...scores].sort((a, b) => a - b);
      for (const story of group) {
        const below = lowerBound(ascending, story.score);
        standing.set(story.key, group.length > 1 ? below / (group.length - 1) : 1);
      }
      continue;
    }

    // No spread — the wire does not vote. Rank it by its own recency instead,
    // so it competes on the one axis it actually reports.
    const byTime = [...group].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    byTime.forEach((story, index) => {
      standing.set(story.key, group.length > 1 ? 1 - index / (group.length - 1) : 1);
    });
  }

  return stories.map((story) => ({
    ...story,
    heat: Number(
      (
        STANDING_WEIGHT * clamp01(standing.get(story.key) ?? 0) +
        RECENCY_WEIGHT * recencyOf(story.publishedAt, now)
      ).toFixed(4),
    ),
  }));
}

/** Index of the first element not less than `value` in an ascending array. */
function lowerBound(ascending: readonly number[], value: number): number {
  let lo = 0;
  let hi = ascending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ascending[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
