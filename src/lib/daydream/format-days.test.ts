import { describe, it, expect } from 'vitest';
import { clock, groupByDay, londonDay } from './format';

describe('London days', () => {
  it('reads the calendar day in Europe/London, not UTC', () => {
    // 23:30 UTC in BST is 00:30 the next day in London.
    expect(londonDay('2026-09-24T23:30:00Z')).toBe('2026-09-25');
    expect(clock('2026-09-24T23:30:00Z')).toBe('00:30');
  });

  it('groups newest day first, one group per day even when the input is not sorted', () => {
    const now = new Date('2026-09-25T18:00:00Z');
    const items = [
      { id: 'a', createdAt: '2026-09-25T17:00:00Z' },
      { id: 'b', createdAt: '2026-09-23T09:00:00Z' },
      { id: 'c', createdAt: '2026-09-24T12:00:00Z' },
      { id: 'd', createdAt: '2026-09-25T08:00:00Z' },
    ];
    const groups = groupByDay(items, now);
    expect(groups.map((g) => g.heading).slice(0, 2)).toEqual(['Today', 'Yesterday']);
    // ICU spells September "Sep" or "Sept" depending on its version.
    expect(groups[2].heading).toMatch(/^Wed 23 Sept?$/);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'd']);
  });
});
