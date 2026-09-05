import type { PageServerLoad } from './$types';
import {
  getNewsFeed,
  MAX_NEWS_STORIES_PER_SOURCE,
  normalizeNewsLimit,
} from '$lib/news/sources';
import { getNewsStats } from '$lib/news/stats';
import { listNewsFavourites, newsOwnerKey } from '$lib/news/favourites';
import type { NewsFeed, NewsSort, NewsView, NewsWireView } from '$lib/news/types';

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
          sources: [
            { source: 'ars-technica' as const, label: 'Ars Technica', count: stories.filter((story) => story.source === 'ars-technica').length, ok: true, error: null },
            {
              source: 'hacker-news' as const,
              label: 'Hacker News',
              count: stories.filter((story) => story.source === 'hacker-news').length,
              ok: true,
              error: null,
            },
            {
              source: 'lobsters' as const,
              label: 'Lobsters',
              count: stories.filter((story) => story.source === 'lobsters').length,
              ok: true,
              error: null,
            },
          ],
          updatedAt: new Date().toISOString(),
          newSinceLast: 0,
          cached: true,
        }))
      : getNewsFeed(view as NewsWireView, { force, limit });
  const [feed, stats] = await Promise.all([feedPromise, getNewsStats(ownerKey)]);
  return { feed, stats, sort, limit, maxLimit: MAX_NEWS_STORIES_PER_SOURCE };
};
