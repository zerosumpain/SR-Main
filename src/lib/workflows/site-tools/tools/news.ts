import { getNewsFeed } from '$lib/news/sources';
import { searchNewsStories } from '$lib/news/search';
import type { NewsSource, NewsWireView } from '$lib/news/types';
import { register } from '../registry-internal';

function requestedView(value: unknown, query: string): NewsWireView {
  if (value === 'new' || value === 'best' || value === 'top') return value;
  if (/\b(?:latest|newest|just\s+in)\b/i.test(query)) return 'new';
  if (/\bbest\b|\bstrongest\b|\bmost\s+popular\b/i.test(query)) return 'best';
  return 'top';
}

function requestedSource(value: unknown, query: string): NewsSource | 'all' {
  if (value === 'all') return 'all';
  if (value == null && /\bars(?:\s+technica)?\b/i.test(query) && !/\bhacker\s+news\b|\blobsters\b/i.test(query)) return 'ars-technica';
  if (value === 'hacker-news' || value === 'lobsters' || value === 'ars-technica') return value;
  if (/\bhacker\s+news\b/i.test(query) && !/\blobsters\b/i.test(query)) return 'hacker-news';
  if (/\blobsters\b/i.test(query) && !/\bhacker\s+news\b/i.test(query)) return 'lobsters';
  return 'all';
}

function requestedLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.trunc(parsed))) : 8;
}

export async function searchNews(args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const view = requestedView(args.view, query);
  const source = requestedSource(args.source, query);
  const limit = requestedLimit(args.limit);
  const feed = await getNewsFeed(view);

  if (feed.stories.length === 0 && feed.sources.every((item) => !item.ok)) {
    return {
      success: false,
      error: `News sources unavailable: ${feed.sources.map((item) => `${item.label}: ${item.error ?? 'unavailable'}`).join('; ')}`,
    };
  }

  const matches = searchNewsStories(feed.stories, { query, source, limit });
  return {
    success: true,
    data: {
      query,
      view,
      source,
      count: matches.length,
      searchedCount: feed.stories.filter((story) => source === 'all' || story.source === source).length,
      updatedAt: feed.updatedAt,
      cached: feed.cached,
      sources: feed.sources,
      results: matches.map(({ story, relevance }) => ({
        id: story.id,
        source: story.source,
        sourceLabel: story.sourceLabel,
        title: story.title,
        summary:
          story.summary.length > 600 ? `${story.summary.slice(0, 600).trimEnd()}…` : story.summary,
        publishedAt: story.publishedAt,
        domain: story.domain,
        author: story.author,
        tags: story.tags,
        score: story.score,
        commentCount: story.commentCount,
        url: story.url,
        discussionUrl: story.discussionUrl,
        readerUrl: `/news/${story.source}/${story.id}`,
        relevance,
      })),
      message:
        matches.length > 0
          ? 'Use the returned original or discussion URLs as inline sources in the answer.'
          : 'No matching story is on the currently fetched Hacker News, Lobsters, or Ars Technica wire.',
    },
  };
}

register({
  name: 'news_search',
  description:
    'Search the live news desk backed by Hacker News, Lobsters, and Ars Technica. Use when the user specifically asks for news, headlines, recent stories, or what these sources is discussing. Returns relevant story metadata plus original, discussion, and internal reader links so the answer can cite its sources. Omit query for the current headlines; use view="new" for newest stories and view="best" for the strongest stories from the last 24 hours.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional topic or keywords. Omit for an unfiltered current-news request.',
      },
      view: {
        type: 'string',
        enum: ['top', 'new', 'best'],
        description: 'Feed to search. Defaults to top.',
      },
      source: {
        type: 'string',
        enum: ['all', 'hacker-news', 'lobsters', 'ars-technica'],
        description: 'Limit results to one source. Defaults to all three.',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        description: 'Maximum results. Defaults to 8.',
      },
    },
    required: [],
  },
  category: 'News',
  toolset: 'news',
  handler: searchNews,
});
