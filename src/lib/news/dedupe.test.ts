import { describe, it, expect } from 'vitest';
import { dedupeStories } from './dedupe';
import type { NewsSource, NewsStory } from './types';

function story(partial: Partial<NewsStory> & { source: NewsSource; canonicalUrl: string }): NewsStory {
  return {
    key: partial.key ?? `${partial.source}:${partial.id ?? '1'}`,
    source: partial.source,
    sourceLabel: partial.sourceLabel ?? partial.source,
    id: partial.id ?? '1',
    title: partial.title ?? 'A story',
    url: partial.url ?? `https://${partial.canonicalUrl}`,
    canonicalUrl: partial.canonicalUrl,
    discussionUrl: partial.discussionUrl ?? `https://${partial.source}/d/${partial.id ?? '1'}`,
    domain: partial.domain ?? 'example.com',
    author: partial.author ?? null,
    publishedAt: partial.publishedAt ?? '2026-09-15T09:00:00.000Z',
    score: partial.score ?? 0,
    commentCount: partial.commentCount ?? 0,
    tags: partial.tags ?? [],
    summary: partial.summary ?? '',
    rank: partial.rank ?? 1,
    alsoOn: partial.alsoOn ?? [],
  };
}

describe('dedupeStories', () => {
  it('leaves distinct stories alone', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', canonicalUrl: 'example.com/a' }),
      story({ source: 'lobsters', canonicalUrl: 'example.com/b' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.alsoOn.length === 0)).toBe(true);
  });

  // The whole point: the caller has already ranked the wire, so deduplication
  // must not re-rank it as a side effect.
  it('keeps the FIRST occurrence, not the highest scoring one', () => {
    const out = dedupeStories([
      story({ source: 'lobsters', id: 'abc', canonicalUrl: 'example.com/a', score: 4 }),
      story({ source: 'hacker-news', id: '99', canonicalUrl: 'example.com/a', score: 900 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('lobsters');
    expect(out[0].id).toBe('abc');
  });

  it('records the other wire as corroboration rather than dropping it', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', id: '1', canonicalUrl: 'example.com/a' }),
      story({
        source: 'lobsters',
        id: 'abc',
        canonicalUrl: 'example.com/a',
        discussionUrl: 'https://lobste.rs/s/abc',
      }),
    ]);
    expect(out[0].alsoOn).toEqual([
      expect.objectContaining({ source: 'lobsters', discussionUrl: 'https://lobste.rs/s/abc' }),
    ]);
  });

  it('sums comments across wires and takes the strongest single score', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', canonicalUrl: 'example.com/a', score: 120, commentCount: 40 }),
      story({ source: 'lobsters', id: 'abc', canonicalUrl: 'example.com/a', score: 30, commentCount: 7 }),
    ]);
    expect(out[0].commentCount).toBe(47);
    expect(out[0].score).toBe(120);
  });

  it('merges all three wires onto one row', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', canonicalUrl: 'example.com/a' }),
      story({ source: 'lobsters', id: 'abc', canonicalUrl: 'example.com/a' }),
      story({ source: 'ars-technica', id: 'slug', canonicalUrl: 'example.com/a' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].alsoOn.map((a) => a.source)).toEqual(['lobsters', 'ars-technica']);
  });

  // One wire listing an article twice is a duplicate, not two communities
  // discussing it — counting it as corroboration would double its comments.
  it('ignores a repeat from the SAME wire', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', id: '1', canonicalUrl: 'example.com/a', commentCount: 10 }),
      story({ source: 'hacker-news', id: '2', canonicalUrl: 'example.com/a', commentCount: 10 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].commentCount).toBe(10);
    expect(out[0].alsoOn).toHaveLength(0);
  });

  it('falls back to the story key when a canonical URL is empty', () => {
    const out = dedupeStories([
      story({ source: 'hacker-news', id: '1', canonicalUrl: '' }),
      story({ source: 'lobsters', id: 'abc', canonicalUrl: '' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not mutate the stories it was given', () => {
    const a = story({ source: 'hacker-news', canonicalUrl: 'example.com/a', commentCount: 5 });
    dedupeStories([a, story({ source: 'lobsters', id: 'abc', canonicalUrl: 'example.com/a', commentCount: 5 })]);
    expect(a.commentCount).toBe(5);
    expect(a.alsoOn).toHaveLength(0);
  });
});
