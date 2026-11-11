import { getNewsFeed } from '$lib/news/sources';
import { newsStoryLane, searchNewsStories } from '$lib/news/search';
import type { NewsSource, NewsWireView } from '$lib/news/types';
import { NEWS_SOURCES, NEWS_SOURCE_DEFS, isNewsSource, type NewsLane } from '$lib/constants/news-sources';
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
  if (typeof value === 'string' && isNewsSource(value)) return value;
  if (/\bhacker\s+news\b/i.test(query) && !/\blobsters\b/i.test(query)) return 'hacker-news';
  if (/\blobsters\b/i.test(query) && !/\bhacker\s+news\b/i.test(query)) return 'lobsters';
  return 'all';
}

// Generated from the source list, so a lane added there is searchable here.
const NEWS_LANES = [...new Set(NEWS_SOURCE_DEFS.map((d) => d.lane))] as NewsLane[];

function requestedLane(value: unknown): NewsLane | 'all' {
  return typeof value === 'string' && (NEWS_LANES as string[]).includes(value) ? (value as NewsLane) : 'all';
}

function requestedLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.trunc(parsed))) : 8;
}

export async function searchNews(args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const view = requestedView(args.view, query);
  const source = requestedSource(args.source, query);
  const lane = requestedLane(args.lane);
  const limit = requestedLimit(args.limit);
  const feed = await getNewsFeed(view);

  if (feed.stories.length === 0 && feed.sources.every((item) => !item.ok)) {
    return {
      success: false,
      error: `News sources unavailable: ${feed.sources.map((item) => `${item.label}: ${item.error ?? 'unavailable'}`).join('; ')}`,
    };
  }

  const matches = searchNewsStories(feed.stories, { query, source, lane, limit });
  return {
    success: true,
    data: {
      query,
      view,
      source,
      lane,
      count: matches.length,
      searchedCount: feed.stories.filter(
        (story) => (source === 'all' || story.source === source) && (lane === 'all' || newsStoryLane(story) === lane),
      ).length,
      updatedAt: feed.updatedAt,
      cached: feed.cached,
      sources: feed.sources,
      results: matches.map(({ story, relevance }) => ({
        id: story.id,
        source: story.source,
        sourceLabel: story.sourceLabel,
        lane: newsStoryLane(story),
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
          : 'No matching story is on the currently fetched wire.',
    },
  };
}

register({
  name: 'news_search',
  effect: 'read',
  description:
    `Search the live news desk. It carries three lanes: tech (technical wires and discussion sites), public (UK government and public-sector feeds) and interests (personal-interest feeds). Use when the user asks for news, headlines, recent stories, or what these sources are discussing. Pass lane to keep the answer to one lane — lane="public" for government and schools news, lane="tech" for technical news — or source for a single feed. Returns story metadata with original, discussion and internal reader links so the answer can cite its sources. Omit query for the current headlines; view="new" gives the newest stories and view="best" the strongest of the last 24 hours.`,
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
        // Generated, not listed: a hand-written enum here is how a newly added
        // source stays invisible to the model that is meant to search it.
        enum: ['all', ...NEWS_SOURCES],
        description: `Limit results to one source. Defaults to every source. Available: ${NEWS_SOURCE_DEFS.map((d) => `${d.id} (${d.label}, ${d.lane})`).join(', ')}.`,
      },
      lane: {
        type: 'string',
        enum: ['all', ...NEWS_LANES],
        description: `Limit results to one lane of the desk. Defaults to every lane. ${NEWS_LANES.map((l) => `${l}: ${NEWS_SOURCE_DEFS.filter((d) => d.lane === l).map((d) => d.label).join(', ')}`).join('; ')}.`,
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
