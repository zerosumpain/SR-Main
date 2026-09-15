// Collapsing the same article carried by more than one wire.
//
// PURE — stories in, stories out. The interesting decisions are all about which
// row survives and what it inherits, and those are exactly the things a test
// should be able to pin down without a network.

import type { NewsStory } from './types';

/**
 * Merge stories that share a canonical URL.
 *
 * **The FIRST occurrence wins the row.** Not the highest score, not the oldest
 * post — first in the order it was handed to us. The caller has already ranked
 * the wire (interleaved, or sorted by score for the `best` view), and choosing
 * a different survivor here would silently re-rank the desk as a side effect of
 * deduplication. Ranking changes belong where they can be seen.
 *
 * The survivor inherits:
 *   - `alsoOn`, one entry per other wire, so the row can link both discussions;
 *   - the SUM of comment counts — two communities discussing one article really
 *     did produce that many comments between them;
 *   - the MAX score — the scores come from different voting populations and are
 *     not addable, so the strongest single showing stands for the article.
 */
export function dedupeStories(stories: readonly NewsStory[]): NewsStory[] {
  const byCanonical = new Map<string, NewsStory>();
  const order: string[] = [];

  for (const story of stories) {
    const key = story.canonicalUrl || story.key;
    const winner = byCanonical.get(key);
    if (!winner) {
      byCanonical.set(key, { ...story, alsoOn: [...story.alsoOn] });
      order.push(key);
      continue;
    }
    // The same wire listing one article twice is a duplicate, not corroboration.
    if (winner.source === story.source || winner.alsoOn.some((a) => a.source === story.source)) {
      continue;
    }
    winner.alsoOn.push({
      source: story.source,
      sourceLabel: story.sourceLabel,
      discussionUrl: story.discussionUrl,
      score: story.score,
      commentCount: story.commentCount,
    });
    winner.commentCount += story.commentCount;
    winner.score = Math.max(winner.score, story.score);
  }

  return order.map((key) => byCanonical.get(key)!);
}
