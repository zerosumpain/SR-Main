import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNewsCache,
  getNewsFeed,
  getNewsStory,
  normalizeHackerNews,
  normalizeLobsters,
} from './sources';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('news sources', () => {
  beforeEach(() => clearNewsCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('normalises a Hacker News self-post into a safe internal reading target', () => {
    const story = normalizeHackerNews({
      id: 42,
      type: 'story',
      title: 'Ask HN: A &amp; B',
      text: '<p>Some <b>submission</b> text.</p>',
      time: 1_700_000_000,
      score: 9,
      descendants: 3,
    });
    expect(story).toMatchObject({
      key: 'hacker-news:42',
      title: 'Ask HN: A & B',
      url: 'https://news.ycombinator.com/item?id=42',
      summary: 'Some submission text.',
    });
  });

  it('normalises Lobsters metadata and rejects unsafe article schemes', () => {
    const story = normalizeLobsters({
      short_id: 'abc123',
      title: 'A story',
      url: 'javascript:alert(1)',
      created_at: '2026-09-01T10:00:00Z',
      tags: ['web', 'security'],
      comments_url: 'https://lobste.rs/s/abc123/a_story',
    });
    expect(story).toMatchObject({
      source: 'lobsters',
      domain: 'lobste.rs',
      url: 'https://lobste.rs/s/abc123/a_story',
      tags: ['web', 'security'],
    });
  });

  it('interleaves healthy sources and reports a partial source failure', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) return response([101, 102]);
      if (url.endsWith('/item/101.json')) return response({ id: 101, type: 'story', title: 'HN one', url: 'https://one.example/', time: 1, score: 10 });
      if (url.endsWith('/item/102.json')) return response({ id: 102, type: 'story', title: 'HN two', url: 'https://two.example/', time: 2, score: 8 });
      if (url.endsWith('/hottest.json')) return response({}, 503);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const feed = await getNewsFeed('top', { force: true });
    expect(feed.stories.map((story) => story.id)).toEqual(['101', '102']);
    expect(feed.sources).toEqual([
      expect.objectContaining({ source: 'hacker-news', ok: true, count: 2 }),
      expect.objectContaining({ source: 'lobsters', ok: false, count: 0, error: 'HTTP 503' }),
    ]);
    expect(feed.newSinceLast).toBe(0);
  });

  it('counts stories added since the previous successful gather', async () => {
    let gather = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) {
        gather += 1;
        return response(gather === 1 ? [101] : [102, 101]);
      }
      if (url.endsWith('/hottest.json')) return response([]);
      if (url.includes('/item/')) {
        const id = Number(url.match(/item\/(\d+)/)?.[1]);
        return response({
          id,
          type: 'story',
          title: `Story ${id}`,
          url: `https://${id}.example/`,
          time: id,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await getNewsFeed('top', { force: true });
    const second = await getNewsFeed('top', { force: true });
    expect(first.newSinceLast).toBe(0);
    expect(second.newSinceLast).toBe(1);
  });

  it('builds Best from the highest-scoring stories in the rolling 24-hour window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) return response([101, 102, 103]);
      if (url.endsWith('/item/101.json')) {
        return response({ id: 101, type: 'story', title: 'HN ten', time: now - 60, score: 10 });
      }
      if (url.endsWith('/item/102.json')) {
        return response({ id: 102, type: 'story', title: 'HN eighty', time: now - 3_600, score: 80 });
      }
      if (url.endsWith('/item/103.json')) {
        return response({ id: 103, type: 'story', title: 'Old HN', time: now - 86_401, score: 999 });
      }
      if (url.endsWith('/hottest.json')) {
        return response([
          {
            short_id: 'hot001',
            title: 'Lobsters forty',
            created_at: '2026-09-02T08:00:00Z',
            score: 40,
            tags: ['systems'],
          },
        ]);
      }
      if (url.endsWith('/newest.json')) {
        return response([
          {
            short_id: 'new001',
            title: 'Lobsters sixty',
            created_at: '2026-09-02T10:00:00Z',
            score: 60,
            tags: ['web'],
          },
          {
            short_id: 'hot001',
            title: 'Duplicate lobster',
            created_at: '2026-09-02T08:00:00Z',
            score: 40,
          },
          {
            short_id: 'old001',
            title: 'Old Lobsters',
            created_at: '2026-09-01T11:59:59Z',
            score: 999,
          },
        ]);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const feed = await getNewsFeed('best', { force: true });

    expect(feed.view).toBe('best');
    expect(feed.stories.map((story) => [story.key, story.score])).toEqual([
      ['hacker-news:102', 80],
      ['lobsters:new001', 60],
      ['lobsters:hot001', 40],
      ['hacker-news:101', 10],
    ]);
  });

  it('rejects malformed ids before making an upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getNewsStory('lobsters', '../bad')).rejects.toThrow('Invalid news story id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
