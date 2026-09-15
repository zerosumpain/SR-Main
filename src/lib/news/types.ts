// The source list lives in the foundation layer so anything that merely needs
// to KNOW what feeds exist can read it without importing $lib/news — which
// imports $lib/daydream, and would close a cycle. Re-exported here because
// every consumer of this module already expects `NewsSource` from it.
import type { NewsSource } from '$lib/constants/news-sources';
export { NEWS_SOURCES } from '$lib/constants/news-sources';
export type { NewsSource };
export type NewsView = 'top' | 'new' | 'best' | 'for-you' | 'favourites';
/**
 * The views that correspond to an actual fetch.
 *
 * `for-you` is not one: it is the top wire REORDERED by what the knowledge
 * graph cares about, not a different request. Letting it reach a fetcher would
 * mean inventing a fourth upstream feed that does not exist.
 */
export type NewsWireView = Exclude<NewsView, 'favourites' | 'for-you'>;
export type NewsSort = 'time' | 'points' | 'heat';

/**
 * The same article, carried by another wire.
 *
 * A story on two front pages is a STRONGER signal than a story on one — so the
 * desk keeps the second sighting as evidence on the surviving row rather than
 * dropping it, and the row can link both discussions.
 */
export interface NewsAlso {
  source: NewsSource;
  sourceLabel: string;
  discussionUrl: string;
  score: number;
  commentCount: number;
}

export interface NewsStory {
  key: string;
  source: NewsSource;
  sourceLabel: string;
  id: string;
  title: string;
  url: string;
  /** `canonicalUrl(url)` — the cross-wire grouping key, not a link. */
  canonicalUrl: string;
  discussionUrl: string;
  domain: string;
  author: string | null;
  publishedAt: string;
  score: number;
  commentCount: number;
  tags: string[];
  summary: string;
  rank: number;
  /**
   * 0-1 standing within this story's OWN wire, blended with recency. Raw scores
   * are not comparable across wires and one wire has none at all, so this is
   * what the desk ranks on. Set by `withHeat`; 0 until then.
   */
  heat: number;
  /** Other wires carrying this same article. Empty for all but duplicates. */
  alsoOn: NewsAlso[];
}

export interface NewsSourceState {
  source: NewsSource;
  label: string;
  count: number;
  ok: boolean;
  error: string | null;
}

export interface NewsFeed {
  view: NewsView;
  stories: NewsStory[];
  sources: NewsSourceState[];
  updatedAt: string;
  newSinceLast: number;
  cached: boolean;
}

export interface NewsArticle {
  story: NewsStory;
  content: string;
  summary: string;
  contentTitle: string | null;
  finalUrl: string;
  mode: 'article' | 'submission' | 'external';
  truncated: boolean;
  message: string | null;
}
