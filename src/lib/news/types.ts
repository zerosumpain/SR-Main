// The source list lives in the foundation layer so anything that merely needs
// to KNOW what feeds exist can read it without importing $lib/news — which
// imports $lib/daydream, and would close a cycle. Re-exported here because
// every consumer of this module already expects `NewsSource` from it.
import type { NewsSource } from '$lib/constants/news-sources';
export { NEWS_SOURCES } from '$lib/constants/news-sources';
export type { NewsSource };
export type NewsView = 'top' | 'new' | 'best' | 'favourites';
export type NewsWireView = Exclude<NewsView, 'favourites'>;
export type NewsSort = 'time' | 'points';

export interface NewsStory {
  key: string;
  source: NewsSource;
  sourceLabel: string;
  id: string;
  title: string;
  url: string;
  discussionUrl: string;
  domain: string;
  author: string | null;
  publishedAt: string;
  score: number;
  commentCount: number;
  tags: string[];
  summary: string;
  rank: number;
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
