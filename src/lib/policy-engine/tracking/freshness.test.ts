import { describe, it, expect } from 'vitest';
import { freshnessState } from './freshness';

const now = new Date('2026-06-11T00:00:00Z');
const monthsAgo = (n: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString();
};

describe('freshnessState', () => {
  it('is no-data when there is no observation at all', () => {
    expect(freshnessState({ releaseDate: null, fetchedAt: null, live: true, expectedReleaseMonths: [10], now })).toBe('no-data');
  });

  it('is snapshot when the value is a fallback (not live)', () => {
    expect(freshnessState({ releaseDate: monthsAgo(1), fetchedAt: monthsAgo(1), live: false, expectedReleaseMonths: [10], now })).toBe('snapshot');
  });

  it('annual cadence: fresh within ~12 months', () => {
    expect(freshnessState({ releaseDate: monthsAgo(3), fetchedAt: monthsAgo(3), live: true, expectedReleaseMonths: [10], now })).toBe('fresh');
  });

  it('annual cadence: due between 12 and 18 months', () => {
    expect(freshnessState({ releaseDate: monthsAgo(13), fetchedAt: monthsAgo(13), live: true, expectedReleaseMonths: [10], now })).toBe('due');
  });

  it('annual cadence: stale beyond 18 months', () => {
    expect(freshnessState({ releaseDate: monthsAgo(20), fetchedAt: monthsAgo(20), live: true, expectedReleaseMonths: [10], now })).toBe('stale');
  });

  it('quarterly cadence (4 releases/yr): fresh within 3 months', () => {
    expect(freshnessState({ releaseDate: monthsAgo(2), fetchedAt: monthsAgo(2), live: true, expectedReleaseMonths: [2, 5, 8, 11], now })).toBe('fresh');
  });

  it('quarterly cadence: stale beyond ~4.5 months', () => {
    expect(freshnessState({ releaseDate: monthsAgo(6), fetchedAt: monthsAgo(6), live: true, expectedReleaseMonths: [2, 5, 8, 11], now })).toBe('stale');
  });

  it('falls back to fetchedAt when releaseDate is null', () => {
    expect(freshnessState({ releaseDate: null, fetchedAt: monthsAgo(2), live: true, expectedReleaseMonths: [10], now })).toBe('fresh');
  });
});
