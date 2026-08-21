import { describe, it, expect } from 'vitest';
import {
  usable,
  todayLede,
  windowLede,
  directionLede,
  loadLede,
  recoveryLede,
  groundLede,
} from './ledes';
import type { MetricResult } from './analytics/types';

/** An `insufficient` MetricResult carries a fully-populated ZERO struct. */
function insufficient<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: '2026-08-21' } as MetricResult<T>;
}
function ok<T>(value: T, sampleSize = 30): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize, asOf: '2026-08-21' } as MetricResult<T>;
}

describe('usable', () => {
  it('refuses the zero-struct that an insufficient result carries', () => {
    expect(usable(insufficient({ acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const }))).toBe(false);
    expect(usable(ok({ acuteEWMA: 40, chronicEWMA: 40, ratio: 1.1, zone: 'optimal' as const }))).toBe(true);
    expect(usable(null)).toBe(false);
  });
});

describe('todayLede', () => {
  const base = {
    recovery: 81,
    hrv: 57,
    rhr: 43,
    slept: 7.2,
    rhrBaseline: 49,
    deltas: { recDelta: 9, hrvDeltaPct: 0, rhrDelta: -6, sleepDelta: 0 },
    readinessLabel: 'Ready to Push',
    syncedAgoSeconds: 900,
  };

  it('says what today is, in words, from the numbers', () => {
    const s = todayLede(base);
    expect(s).toContain('recovery at 81%');
    expect(s).toContain('6 bpm under baseline');
    expect(s).toContain('7.2 hours of sleep');
    expect(s).toContain('ready to push');
  });

  it('leads with the staleness when nothing has synced', () => {
    const s = todayLede({ ...base, syncedAgoSeconds: 3 * 86_400 });
    expect(s).toContain('3 days');
    expect(s).toContain('rather than where it is now');
    expect(s).not.toContain('recovery at');
  });

  it('says a resting heart rate ON its baseline is on it, not zero under it', () => {
    expect(todayLede({ ...base, rhr: 49 })).toContain('exactly on its 49 bpm baseline');
  });

  it('admits an empty day rather than inventing one', () => {
    expect(
      todayLede({ ...base, recovery: 0, hrv: 0, rhr: 0, slept: 0, readinessLabel: null }),
    ).toBe('No readings have landed for today yet.');
  });
});

describe('windowLede', () => {
  const day = (over: Partial<{ recovery: number; slept: number; strain: number; steps: number }> = {}) => ({
    recovery: 70,
    slept: 7,
    strain: 11,
    steps: 9000,
    ...over,
  });

  it('counts the days that carry a reading, not the days in the window', () => {
    const days = [...Array(20).fill(null).map(() => day()), ...Array(10).fill(null).map(() => day({ recovery: 0, slept: 0, steps: 0 }))];
    const s = windowLede({ days, workouts: 6 });
    expect(s).toContain('20 of the last 30 days');
    expect(s).toContain('6 sessions logged');
  });

  it('says so when the window is complete', () => {
    const s = windowLede({ days: Array(30).fill(null).map(() => day()), workouts: 1 });
    expect(s).toContain('Every one of the last 30 days');
    expect(s).toContain('1 session logged');
  });

  it('averages only over the days that have the reading', () => {
    // The middle day has no recovery but still has sleep and steps, so it
    // COUNTS as a day with a reading while contributing nothing to the mean:
    // (90 + 70) / 2, not (90 + 0 + 70) / 3.
    const days = [day({ recovery: 90 }), day({ recovery: 0 }), day({ recovery: 70 })];
    const s = windowLede({ days, workouts: 0 });
    expect(s).toContain('Recovery averaged 80%');
    expect(s).toContain('Every one of the last 3 days');
  });

  it('has an answer for an empty window', () => {
    expect(windowLede({ days: [], workouts: 0 })).toContain('No days in the window');
  });
});

describe('directionLede', () => {
  it('names each measure that has moved off its own baseline', () => {
    const s = directionLede({
      vo2: ok({ current: 41.2, trendSlopePerMonth: -0.11, percentile: 61, band: 'excellent' as const }),
      rhr: { latest7: 51, baseline28: 49 },
      hrv: { latest7: 65, baseline28: 58 },
      ef: { latest7: 1.1, baseline28: 1.0 },
    });
    expect(s).toContain('drifting down 0.11');
    expect(s).toContain('2 bpm above its month');
    expect(s).toContain('7 ms up on it');
    expect(s).toContain('10% more ground per heartbeat');
  });

  it('says flat rather than inventing a slope out of noise', () => {
    const s = directionLede({
      vo2: ok({ current: 41.2, trendSlopePerMonth: 0.01, percentile: 61, band: 'excellent' as const }),
      rhr: null,
      hrv: null,
      ef: null,
    });
    expect(s).toContain('flat');
  });

  it('ignores an insufficient VO₂max instead of reading its zero struct', () => {
    const s = directionLede({
      vo2: insufficient({ current: 0, trendSlopePerMonth: 0, percentile: 0, band: 'poor' as const }),
      rhr: null,
      hrv: null,
      ef: null,
    });
    expect(s).not.toContain('cardio fitness');
    expect(s).toContain('Nothing has moved far enough');
  });

  it('leaves a sub-threshold wobble out entirely', () => {
    const s = directionLede({ vo2: null, rhr: { latest7: 49.4, baseline28: 49 }, hrv: null, ef: null });
    expect(s).toContain('Nothing has moved far enough');
  });
});

describe('loadLede', () => {
  it('refuses to read the zero-struct of an insufficient ACWR', () => {
    const s = loadLede({
      acwr: insufficient({ acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const }),
      monotony: null,
      polarised: null,
      daysBanked: 9,
    });
    expect(s).toContain('9 of the 14 days');
    expect(s).not.toContain('detraining —');
  });

  it('states the ratio and what the band means', () => {
    const s = loadLede({
      acwr: ok({ acuteEWMA: 40, chronicEWMA: 40, ratio: 0.67, zone: 'undertraining' as const }),
      monotony: null,
      polarised: null,
      daysBanked: 40,
    });
    expect(s).toContain('0.67×');
    expect(s).toContain('there is room');
  });

  it('applies the monotony guard the service can never fail itself', () => {
    // getMonotony() zero-fills seven days, so sufficiency is always 'ok' — the
    // mean and sd are what actually say whether there is anything there.
    const empty = loadLede({
      acwr: ok({ acuteEWMA: 40, chronicEWMA: 40, ratio: 1.1, zone: 'optimal' as const }),
      monotony: ok({ mean: 0, sd: 0, monotony: 0, strain: 320, band: 'high' as const }),
      polarised: null,
      daysBanked: 40,
    });
    expect(empty).not.toContain('alike');

    const real = loadLede({
      acwr: ok({ acuteEWMA: 40, chronicEWMA: 40, ratio: 1.1, zone: 'optimal' as const }),
      monotony: ok({ mean: 40, sd: 5, monotony: 8, strain: 320, band: 'high' as const }),
      polarised: null,
      daysBanked: 40,
    });
    expect(real).toContain('very alike');
  });

  it('mentions a middle-heavy week only when the verdict says so', () => {
    const s = loadLede({
      acwr: ok({ acuteEWMA: 40, chronicEWMA: 40, ratio: 1.1, zone: 'optimal' as const }),
      monotony: null,
      polarised: ok({ easyPct: 40, midPct: 50, hardPct: 10, verdict: 'junk-middle' as const, totalMinutes: 600 }),
      daysBanked: 40,
    });
    expect(s).toContain('middle zones');
  });
});

describe('recoveryLede', () => {
  it('gets the sign of a sleep debt the right way round', () => {
    expect(recoveryLede({ debtHours: 4.2, autonomicLabel: null, sleepRegularity: null })).toContain(
      '4.2 hours of sleep down',
    );
    expect(recoveryLede({ debtHours: -3, autonomicLabel: null, sleepRegularity: null })).toContain(
      '3.0 hours of sleep ahead',
    );
  });

  it('ignores a debt too small to mention', () => {
    expect(recoveryLede({ debtHours: 0.2, autonomicLabel: null, sleepRegularity: null })).toContain(
      'Not enough sleep history',
    );
  });
});

describe('groundLede', () => {
  it('describes the outings, the ground and the bests', () => {
    const s = groundLede({
      outings: 5,
      distanceM: 40_780,
      types: ['walk', 'ride', 'run'],
      segments: 387,
      recentPrs: 2,
    });
    expect(s).toContain('last 5 outings covered 40.8 km across 3 sports');
    expect(s).toContain('387 stretches');
    expect(s).toContain('2 new bests');
  });

  it('is singular where it should be', () => {
    const s = groundLede({ outings: 1, distanceM: 0, types: ['run'], segments: 1, recentPrs: 1 });
    expect(s).toContain('last 1 outing');
    expect(s).toContain('1 stretch of ground');
    expect(s).toContain('1 new best ');
    expect(s).not.toContain('sports');
  });

  it('has an answer for an empty corpus', () => {
    expect(groundLede({ outings: 0, distanceM: 0, types: [], segments: 0, recentPrs: 0 })).toBe(
      'No outings on record yet.',
    );
  });
});
