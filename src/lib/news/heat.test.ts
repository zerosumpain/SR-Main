import { describe, it, expect } from 'vitest';
import { withHeat } from './heat';
import type { NewsSource, NewsStory } from './types';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function story(partial: Partial<NewsStory> & { source: NewsSource; key: string }): NewsStory {
  return {
    key: partial.key,
    source: partial.source,
    sourceLabel: partial.source,
    id: partial.id ?? partial.key,
    title: partial.title ?? 'A story',
    url: 'https://example.com/a',
    canonicalUrl: 'example.com/a',
    discussionUrl: 'https://example.com/d',
    domain: 'example.com',
    author: null,
    publishedAt: partial.publishedAt ?? hoursAgo(1),
    score: partial.score ?? 0,
    commentCount: 0,
    tags: [],
    summary: '',
    rank: partial.rank ?? 1,
    heat: 0,
    alsoOn: [],
  };
}

const heatOf = (stories: NewsStory[], key: string) => stories.find((s) => s.key === key)!.heat;

describe('withHeat', () => {
  it('ranks a story by its standing within its own wire', () => {
    const out = withHeat(
      [
        story({ source: 'hacker-news', key: 'a', score: 10 }),
        story({ source: 'hacker-news', key: 'b', score: 50 }),
        story({ source: 'hacker-news', key: 'c', score: 100 }),
      ],
      NOW,
    );
    expect(heatOf(out, 'c')).toBeGreaterThan(heatOf(out, 'b'));
    expect(heatOf(out, 'b')).toBeGreaterThan(heatOf(out, 'a'));
  });

  // The whole reason this module exists. Ars reports no votes, so every story
  // is score 0 and a raw-score sort buried the entire wire permanently.
  it('ranks a scoreless wire by its own recency instead of leaving it at zero', () => {
    const out = withHeat(
      [
        story({ source: 'ars-technica', key: 'old', score: 0, publishedAt: hoursAgo(20) }),
        story({ source: 'ars-technica', key: 'mid', score: 0, publishedAt: hoursAgo(10) }),
        story({ source: 'ars-technica', key: 'fresh', score: 0, publishedAt: hoursAgo(1) }),
      ],
      NOW,
    );
    expect(heatOf(out, 'fresh')).toBeGreaterThan(heatOf(out, 'mid'));
    expect(heatOf(out, 'mid')).toBeGreaterThan(heatOf(out, 'old'));
    expect(heatOf(out, 'fresh')).toBeGreaterThan(0);
  });

  it('lets a top scoreless story outrank a weak story on a voting wire', () => {
    const out = withHeat(
      [
        story({ source: 'hacker-news', key: 'weak', score: 1, publishedAt: hoursAgo(1) }),
        story({ source: 'hacker-news', key: 'strong', score: 500, publishedAt: hoursAgo(1) }),
        story({ source: 'ars-technica', key: 'ars-top', score: 0, publishedAt: hoursAgo(1) }),
        story({ source: 'ars-technica', key: 'ars-old', score: 0, publishedAt: hoursAgo(30) }),
      ],
      NOW,
    );
    expect(heatOf(out, 'ars-top')).toBeGreaterThan(heatOf(out, 'weak'));
    // ...but it does not beat a wire-topping story either.
    expect(heatOf(out, 'strong')).toBeGreaterThanOrEqual(heatOf(out, 'ars-top'));
  });

  it('scores each wire against itself, not against the other wires', () => {
    // 40 points tops Lobsters and is mid-table on Hacker News.
    const out = withHeat(
      [
        story({ source: 'lobsters', key: 'l-top', score: 40 }),
        story({ source: 'lobsters', key: 'l-low', score: 2 }),
        story({ source: 'hacker-news', key: 'h-mid', score: 40 }),
        story({ source: 'hacker-news', key: 'h-top', score: 900 }),
      ],
      NOW,
    );
    expect(heatOf(out, 'l-top')).toBeGreaterThan(heatOf(out, 'h-mid'));
  });

  it('decays an old story even when it topped its wire', () => {
    const out = withHeat(
      [
        story({ source: 'hacker-news', key: 'fresh-top', score: 100, publishedAt: hoursAgo(1) }),
        story({ source: 'hacker-news', key: 'stale-top', score: 100, publishedAt: hoursAgo(47) }),
        story({ source: 'hacker-news', key: 'floor', score: 1, publishedAt: hoursAgo(1) }),
      ],
      NOW,
    );
    expect(heatOf(out, 'fresh-top')).toBeGreaterThan(heatOf(out, 'stale-top'));
  });

  it('gives tied scores the same standing', () => {
    const out = withHeat(
      [
        story({ source: 'hacker-news', key: 'x', score: 50, publishedAt: hoursAgo(2) }),
        story({ source: 'hacker-news', key: 'y', score: 50, publishedAt: hoursAgo(2) }),
        story({ source: 'hacker-news', key: 'z', score: 1, publishedAt: hoursAgo(2) }),
      ],
      NOW,
    );
    expect(heatOf(out, 'x')).toBe(heatOf(out, 'y'));
  });

  it('stays within 0 and 1, including for a story dated in the future', () => {
    const out = withHeat(
      [
        story({ source: 'hacker-news', key: 'future', score: 10, publishedAt: hoursAgo(-5) }),
        story({ source: 'hacker-news', key: 'ancient', score: 0, publishedAt: hoursAgo(5000) }),
      ],
      NOW,
    );
    for (const s of out) {
      expect(s.heat).toBeGreaterThanOrEqual(0);
      expect(s.heat).toBeLessThanOrEqual(1);
    }
  });

  it('handles a lone story on a wire and an empty input', () => {
    expect(withHeat([], NOW)).toEqual([]);
    const out = withHeat([story({ source: 'lobsters', key: 'only', score: 3 })], NOW);
    expect(out[0].heat).toBeGreaterThan(0);
  });

  it('does not mutate the stories it was given', () => {
    const a = story({ source: 'hacker-news', key: 'a', score: 10 });
    withHeat([a], NOW);
    expect(a.heat).toBe(0);
  });
});
