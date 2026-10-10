import { describe, expect, it } from 'vitest';
import { byYear, firstYear, isoDay, longDate, marginDate, postCount, subjects, yearOf } from './contents';

describe('blog contents helpers', () => {
  it('writes the margin date without its year, in London time on both sides', () => {
    expect(marginDate('2026-09-28T10:00:00Z')).toBe('28 Sept');
    // Half past midnight in London is still the evening before in UTC.
    expect(marginDate('2026-10-04T23:30:00Z')).toBe('5 Oct');
    expect(isoDay('2026-10-04T23:30:00Z')).toBe('2026-10-05');
    expect(longDate('2025-12-12T09:00:00Z')).toBe('12 Dec 2025');
    expect(marginDate(null)).toBe('');
    expect(marginDate('not a date')).toBe('');
    expect(yearOf(undefined)).toBeNull();
  });

  it('splits the run where the year changes and remembers each group’s place', () => {
    const posts = [
      { publishedAt: '2026-10-04T09:00:00Z' },
      { publishedAt: '2026-03-02T09:00:00Z' },
      { publishedAt: '2025-12-12T09:00:00Z' },
      { publishedAt: null },
    ];
    const groups = byYear(posts);
    expect(groups.map((g) => [g.year, g.start, g.posts.length])).toEqual([
      ['2026', 1, 2],
      ['2025', 3, 1],
      [null, 4, 1],
    ]);
    expect(byYear([])).toEqual([]);
  });

  it('counts subjects once a post, most used first then A to Z', () => {
    const list = subjects([
      { tags: ['notes', 'essays'] },
      { tags: ['essays', 'essays'] },
      { tags: ['craft'] },
      { tags: [] },
    ]);
    expect(list).toEqual([
      { tag: 'essays', count: 2 },
      { tag: 'craft', count: 1 },
      { tag: 'notes', count: 1 },
    ]);
  });

  it('says a count in words a screen reader can use', () => {
    expect(postCount(1)).toBe('one post');
    expect(postCount(6)).toBe('6 posts');
    expect(postCount(0)).toBe('no posts');
  });

  it('finds the year of the oldest dated post', () => {
    const run = [
      { publishedAt: '2026-10-04T09:00:00Z' },
      { publishedAt: '2025-12-12T09:00:00Z' },
      { publishedAt: null },
    ];
    expect(firstYear(run)).toBe('2025');
    expect(firstYear([{ publishedAt: null }])).toBeNull();
    expect(firstYear([])).toBeNull();
  });
});
