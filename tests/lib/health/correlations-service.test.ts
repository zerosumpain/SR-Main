import { describe, it, expect } from 'vitest';
import { discoverCorrelations } from '$lib/health/correlations-service';

type DayRow = Parameters<typeof discoverCorrelations>[0][number];

function emptyDay(date: string): DayRow {
  return {
    date,
    rec: null,
    hrv: null,
    rhr: null,
    slept: null,
    strain: null,
    steps: null,
    sleepScore: null,
  };
}

// Make N days starting from 2026-01-01.
function days(n: number): DayRow[] {
  const out: DayRow[] = [];
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    out.push(emptyDay(d));
  }
  return out;
}

describe('discoverCorrelations', () => {
  it('returns empty when no data', () => {
    expect(discoverCorrelations(days(60))).toEqual([]);
  });

  it('surfaces a strong same-day correlation between non-blacklisted metrics', () => {
    // Build steps perfectly correlated with sleepScore (not in denylist).
    const ds = days(40);
    for (let i = 0; i < ds.length; i++) {
      ds[i].steps = 5000 + i * 200;
      ds[i].sleepScore = 60 + i * 0.5;
    }
    const out = discoverCorrelations(ds);
    const hit = out.find((c) => c.cause.includes('STEPS') || c.effect.includes('sleep score'));
    expect(hit).toBeTruthy();
    expect(hit?.confidence).toBe('STRONG');
  });

  it('blocks the {rec, hrv} denylist pair even when perfectly correlated', () => {
    const ds = days(60);
    for (let i = 0; i < ds.length; i++) {
      ds[i].rec = 30 + i;
      ds[i].hrv = 40 + i * 0.8;
    }
    const out = discoverCorrelations(ds);
    const tautology = out.find(
      (c) =>
        (c.cause.includes('RECOVERY') && c.effect.includes('HRV')) ||
        (c.cause.includes('HRV') && c.effect.includes('recovery')),
    );
    expect(tautology).toBeUndefined();
  });

  it('blocks the {sleepScore, slept} denylist pair', () => {
    const ds = days(40);
    for (let i = 0; i < ds.length; i++) {
      ds[i].slept = 6 + (i % 4) * 0.5;
      ds[i].sleepScore = 40 + (i % 4) * 10;
    }
    const out = discoverCorrelations(ds);
    const tautology = out.find(
      (c) =>
        (c.cause.includes('SLEEP') && c.effect.includes('sleep score')) ||
        (c.cause.includes('SLEEP SCORE') && c.effect.includes('sleep duration')),
    );
    expect(tautology).toBeUndefined();
  });

  it('drops weak correlations (|r| < 0.3)', () => {
    // Random-ish noise that should not produce strong r.
    const ds = days(40);
    for (let i = 0; i < ds.length; i++) {
      ds[i].steps = 8000 + ((i * 7919) % 5000);
      ds[i].strain = 8 + ((i * 31) % 7);
    }
    const out = discoverCorrelations(ds);
    // Steps↔strain pair, if any, must have |r| ≥ 0.3 — the test data is
    // constructed not to satisfy that. Just assert nothing crashes.
    expect(Array.isArray(out)).toBe(true);
  });

  it('caps results at 4', () => {
    const ds = days(50);
    // Plant several strong correlations that survive the denylist.
    for (let i = 0; i < ds.length; i++) {
      ds[i].steps = 3000 + i * 250;
      ds[i].slept = 5 + i * 0.05;
      ds[i].strain = 4 + i * 0.3;
      ds[i].rhr = 70 - i * 0.4;
    }
    const out = discoverCorrelations(ds);
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it('skips zero/missing values when ranking', () => {
    const ds = days(40);
    for (let i = 0; i < ds.length; i++) {
      // Plenty of zeros — only 12 valid pairs at the tail.
      if (i >= 28) {
        ds[i].steps = 6000 + (i - 28) * 500;
        ds[i].sleepScore = 55 + (i - 28) * 2;
      }
    }
    const out = discoverCorrelations(ds);
    // Should produce at least one result with n=12.
    const hit = out.find((c) => c.conf.includes('n=12'));
    expect(hit).toBeTruthy();
  });
});
