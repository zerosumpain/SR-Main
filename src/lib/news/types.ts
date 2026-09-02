export type NewsSource = 'hacker-news' | 'lobsters';
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
