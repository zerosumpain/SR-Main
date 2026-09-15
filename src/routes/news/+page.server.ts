import type { PageServerLoad } from './$types';
import {
  getNewsFeed,
  MAX_NEWS_STORIES_PER_SOURCE,
  normalizeNewsLimit,
} from '$lib/news/sources';
import { getNewsStats } from '$lib/news/stats';
import { listNewsFavourites, newsOwnerKey } from '$lib/news/favourites';
import { readKeysFor } from '$lib/news/store';
import { correlateStories } from '$lib/news/correlate';
import { loadAnchors } from '$lib/news/correlate.server';
import { NEWS_SOURCES, NEWS_SOURCE_LABELS } from '$lib/constants/news-sources';
import type { NewsFeed, NewsSort, NewsView, NewsWireView } from '$lib/news/types';

/** What a row needs to say why it surfaced, and nothing more. */
export interface StoryCorrelation {
  score: number;
  names: string[];
  why: string;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const requestedView = url.searchParams.get('view');
  const view: NewsView =
    requestedView === 'new' || requestedView === 'best' || requestedView === 'favourites'
      ? requestedView
      : 'top';
  const requestedSort = url.searchParams.get('sort');
  const sort: NewsSort =
    requestedSort === 'points' || requestedSort === 'time'
      ? requestedSort
      : view === 'best'
        ? 'points'
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
      : getNewsFeed(view as NewsWireView, { force, limit });
  const [feed, stats] = await Promise.all([feedPromise, getNewsStats(ownerKey)]);

  // Both are best-effort decoration on a desk that must render without them.
  const [correlations, readKeys] = await Promise.all([
    correlationsFor(feed),
    readKeysFor(ownerKey, feed.stories.map((story) => story.key)),
  ]);

  return {
    feed,
    stats,
    sort,
    limit,
    maxLimit: MAX_NEWS_STORIES_PER_SOURCE,
    correlations,
    readKeys: [...readKeys],
  };
};

async function correlationsFor(feed: NewsFeed): Promise<Record<string, StoryCorrelation>> {
  try {
    const { anchors } = await loadAnchors();
    if (anchors.length === 0) return {};
    // No limit: the page wants to know about every row it is going to draw,
    // not the top eight the tool answer wants.
    const correlated = correlateStories(feed.stories, anchors, { limit: feed.stories.length });
    return Object.fromEntries(
      correlated.map((entry) => [
        entry.story.key,
        {
          score: entry.score,
          names: entry.matches.map((match) => match.anchor.name),
          why: entry.matches[0].anchor.why,
        },
      ]),
    );
  } catch (err) {
    console.error('[news] correlation failed:', err instanceof Error ? err.message : err);
    return {};
  }
}
