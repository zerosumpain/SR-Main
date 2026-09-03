import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsFeed, NewsStory } from '$lib/news/types';

vi.mock('$lib/news/sources', () => ({ getNewsFeed: vi.fn() }));

import { getNewsFeed } from '$lib/news/sources';
import { inferToolsets } from '../keyword-classifier';
import { getToolsetDefinitions } from '../registry';
import { newsQueryTerms, searchNewsStories } from '$lib/news/search';
import { searchNews } from './news';

function story(overrides: Partial<NewsStory> = {}): NewsStory {
  return {
    key: 'hacker-news:1',
    source: 'hacker-news',
    sourceLabel: 'Hacker News',
    id: '1',
    title: 'Rust compiler gets faster incremental builds',
    url: 'https://example.com/rust-compiler',
    discussionUrl: 'https://news.ycombinator.com/item?id=1',
    domain: 'example.com',
    author: 'alice',
    publishedAt: '2026-09-03T09:00:00.000Z',
    score: 80,
    commentCount: 12,
    tags: ['rust', 'compilers'],
    summary: 'The compiler team describes a new optimisation.',
    rank: 1,
    ...overrides,
  };
}

const feed: NewsFeed = {
  view: 'top',
  stories: [
    story(),
    story({
      key: 'lobsters:abc123',
      source: 'lobsters',
      sourceLabel: 'Lobsters',
      id: 'abc123',
      title: 'OpenAI publishes a new model specification',
      url: 'https://openai.com/model-spec',
      discussionUrl: 'https://lobste.rs/s/abc123',
      domain: 'openai.com',
      tags: ['ai'],
      rank: 2,
    }),
  ],
  sources: [
    { source: 'hacker-news', label: 'Hacker News', count: 1, ok: true, error: null },
    { source: 'lobsters', label: 'Lobsters', count: 1, ok: true, error: null },
  ],
  updatedAt: '2026-09-03T10:00:00.000Z',
  newSinceLast: 0,
  cached: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNewsFeed).mockResolvedValue(feed);
});

describe('news search', () => {
  it('drops news-request filler and ranks actual topic matches', () => {
    expect(newsQueryTerms('What is the latest news about AI today?')).toEqual(['ai']);
    const matches = searchNewsStories(feed.stories, { query: 'latest AI news' });
    expect(matches.map((match) => match.story.id)).toEqual(['abc123']);
  });

  it('keeps the feed order for generic headlines and can filter one source', () => {
    expect(
      searchNewsStories(feed.stories, { query: 'latest tech news', source: 'lobsters' }).map(
        (match) => match.story.id,
      ),
    ).toEqual(['abc123']);
  });

  it('returns sourceable links and infers an explicitly named community', async () => {
    const result = await searchNews({ query: 'What is the latest on Lobsters?', limit: 4 });
    expect(getNewsFeed).toHaveBeenCalledWith('new');
    expect(result).toMatchObject({
      success: true,
      data: {
        source: 'lobsters',
        count: 1,
        results: [
          {
            sourceLabel: 'Lobsters',
            url: 'https://openai.com/model-spec',
            discussionUrl: 'https://lobste.rs/s/abc123',
            readerUrl: '/news/lobsters/abc123',
          },
        ],
      },
    });
  });

  it('is registered as a read-only JKAI tool', () => {
    const definitions = getToolsetDefinitions('news');
    expect(definitions.map((tool) => tool.function.name)).toEqual(['news_search']);
  });
});

describe('news toolset routing', () => {
  it.each([
    'show me the latest news about AI',
    "what are today's headlines?",
    'anything interesting on Hacker News?',
    'find Lobsters stories about Rust',
    'news',
  ])('activates for %j', (message) => {
    expect(inferToolsets(message)).toContain('news');
  });

  it.each(['good news, that fixed it', 'this newsletter is too long', 'thanks, carry on'])(
    'does not activate for %j',
    (message) => {
      expect(inferToolsets(message)).not.toContain('news');
    },
  );
});
