import type { PageServerLoad } from './$types';
import {
  getNewsFeed,
  MAX_NEWS_STORIES_PER_SOURCE,
  normalizeNewsLimit,
} from '$lib/news/sources';
import { getNewsStats, keptKeysFor } from '$lib/news/stats';
import { listNewsFavourites, newsOwnerKey } from '$lib/news/favourites';
import { newSinceLastVisit, readKeysFor } from '$lib/news/store';
import { correlateStories } from '$lib/news/correlate';
import { loadAnchors } from '$lib/news/correlate.server';
import { NEWS_SOURCES, NEWS_SOURCE_LABELS } from '$lib/constants/news-sources';
import type { NewsFeed, NewsSort, NewsStory, NewsView, NewsWireView } from '$lib/news/types';

/** What a row needs to say why it surfaced, and nothing more. */
export interface StoryCorrelation {
  score: number;
  names: string[];
  why: string;
  /** What the knowledge base already holds on the strongest match. */
  evidence: { notes: number; lastSeen: string | null } | null;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const requestedView = url.searchParams.get('view');
  const view: NewsView =
    requestedView === 'new' ||
    requestedView === 'best' ||
    requestedView === 'for-you' ||
    requestedView === 'favourites'
      ? requestedView
      : 'top';
  const requestedSort = url.searchParams.get('sort');
  const sort: NewsSort =
    requestedSort === 'points' || requestedSort === 'time' || requestedSort === 'heat'
      ? requestedSort
      : view === 'best'
        // Heat, not points. Raw scores are not comparable across wires and one
        // wire reports none at all, so a points default made "best" mean "best
        // on the two wires that vote".
        ? 'heat'
        : 'time';
  const force = url.searchParams.has('fresh');
  const limit = normalizeNewsLimit(url.searchParams.get('limit'));
  const ownerKey = await newsOwnerKey(locals);
  const feedPromise: Promise<NewsFeed> =
    view === 'favourites'
      ? listNewsFavourites(ownerKey).then((stories) => ({
          view,
          stories,
          // Derived from the source list, not a hand-written triple — the old
          // literal would have under-reported the moment a fourth wire existed.
          sources: NEWS_SOURCES.map((source) => ({
            source,
            label: NEWS_SOURCE_LABELS[source],
            count: stories.filter((story) => story.source === source).length,
            ok: true,
            error: null,
          })),
          updatedAt: new Date().toISOString(),
          newSinceLast: 0,
          cached: true,
        }))
      // `for-you` reorders the top wire rather than fetching its own.
      : getNewsFeed(view === 'for-you' ? 'top' : (view as NewsWireView), { force, limit });
  const [feed, stats] = await Promise.all([feedPromise, getNewsStats(ownerKey)]);

  // All best-effort decoration on a desk that must render without any of it.
  const keys = feed.stories.map((story) => story.key);
  const [correlated, readKeys, keptKeys, newSince] = await Promise.all([
    correlationsFor(feed),
    readKeysFor(ownerKey, keys),
    keptKeysFor(keys),
    // A saved list has no arrival time of its own — every row got there because
    // the owner put it there, so "new since you looked" is not a question about it.
    view === 'favourites'
      ? Promise.resolve({ count: 0, since: null })
      : newSinceLastVisit(ownerKey, feed.stories),
  ]);
  const { correlations, anchorCount } = correlated;

  const stories =
    view === 'for-you' ? rankForYou(feed.stories, correlations) : feed.stories;

  return {
    feed: { ...feed, view, stories, newSinceLast: newSince.count },
    newSince,
    stats,
    sort,
    limit,
    maxLimit: MAX_NEWS_STORIES_PER_SOURCE,
    correlations,
    anchorCount,
    readKeys: [...readKeys],
    keptKeys: [...keptKeys],
  };
};

/**
 * Correlated stories first, everything else in the order it already had.
 *
 * RANKS, never filters. A desk that hides what did not correlate loses the
 * serendipity that makes a wire worth reading at all, and gives you no way to
 * notice what it dropped — so the uncorrelated stories stay, below the fold.
 */
function rankForYou(
  stories: readonly NewsStory[],
  correlations: Record<string, StoryCorrelation>,
): NewsStory[] {
  return [...stories].sort((a, b) => {
    const scoreA = correlations[a.key]?.score ?? 0;
    const scoreB = correlations[b.key]?.score ?? 0;
    return scoreB - scoreA || b.heat - a.heat;
  });
}

async function correlationsFor(
  feed: NewsFeed,
): Promise<{ correlations: Record<string, StoryCorrelation>; anchorCount: number }> {
  try {
    const { anchors } = await loadAnchors();
    if (anchors.length === 0) return { correlations: {}, anchorCount: 0 };
    // No limit: the page wants to know about every row it is going to draw,
    // not the top eight the tool answer wants.
    const correlated = correlateStories(feed.stories, anchors, { limit: feed.stories.length });
    return {
      anchorCount: anchors.length,
      correlations: Object.fromEntries(
        correlated.map((entry) => [
          entry.story.key,
          {
            score: entry.score,
            names: entry.matches.map((match) => match.anchor.name),
            why: entry.matches[0].anchor.why,
            evidence: entry.matches[0].anchor.evidence ?? null,
          },
        ]),
      ),
    };
  } catch (err) {
    console.error('[news] correlation failed:', err instanceof Error ? err.message : err);
    return { correlations: {}, anchorCount: 0 };
  }
}
