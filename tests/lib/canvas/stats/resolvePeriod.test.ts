import { describe, it, expect } from 'vitest';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

// Anchor: Mon 2026-04-20 12:00:00 UTC
const NOW = new Date('2026-04-20T12:00:00Z');

describe('resolvePeriod', () => {
  it('unknown/empty preset defaults to 30d', () => {
    const r = resolvePeriod('bogus', NOW);
    expect(r.preset).toBe('30d');
    expect(r.granularity).toBe('day');
    expect(r.to.toISOString()).toBe('2026-04-20T12:00:00.000Z');
    expect(r.from.toISOString()).toBe('2026-03-21T12:00:00.000Z');
  });

  it('24h returns hour granularity', () => {
    const r = resolvePeriod('24h', NOW);
    expect(r.granularity).toBe('hour');
    expect(r.from.toISOString()).toBe('2026-04-19T12:00:00.000Z');
  });

  it('this-week starts on Monday 00:00 UTC', () => {
    const r = resolvePeriod('this-week', NOW);
    expect(r.granularity).toBe('day');
    expect(r.from.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  it('last-week spans the previous Monday..Sunday', () => {
    const r = resolvePeriod('last-week', NOW);
    expect(r.from.toISOString()).toBe('2026-04-13T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  it('last-month spans the previous calendar month', () => {
    const r = resolvePeriod('last-month', NOW);
    expect(r.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('all with 100d span uses week granularity', () => {
    const earliest = new Date('2026-01-01T00:00:00Z');
    const r = resolvePeriod('all', NOW, earliest);
    expect(r.granularity).toBe('week');
  });

  it('all with 10d span uses day granularity', () => {
    const earliest = new Date('2026-04-10T00:00:00Z');
    const r = resolvePeriod('all', NOW, earliest);
    expect(r.granularity).toBe('day');
  });
});
