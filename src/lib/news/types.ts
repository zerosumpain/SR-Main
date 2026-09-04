/**
 * The wired-in news sources.
 *
 * An array rather than a bare union so the set is readable at RUN time: the
 * daydream appetite scan states what the site can already reach, and a source
 * list it cannot enumerate is a source list it will propose again. Adding a
 * feed is a code change — that is the honest thing for the pack to say, and it
 * is why a news source goes down the /build lane rather than a registration.
 */
export const NEWS_SOURCES = ['hacker-news', 'lobsters'] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
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
