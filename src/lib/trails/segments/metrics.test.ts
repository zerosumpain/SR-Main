import { describe, it, expect } from 'vitest';
import { effortMetrics, windowHeartrate, beatsPerKm, rankEfforts, MIN_HR_COVERAGE } from './metrics';
import type { HrSample } from '$lib/health/analytics/series-intervals';

/** A steady series at 1 Hz. */
const steady = (from: number, to: number, bpm: number): HrSample[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, bpm] as HrSample);

describe('windowHeartrate', () => {
  it('averages only the window, not the whole workout', () => {
    const samples: HrSample[] = [...steady(0, 299, 120), ...steady(300, 599, 170)];
    expect(windowHeartrate(samples, 300, 600)?.avgBpm).toBeCloseTo(170, 0);
    expect(windowHeartrate(samples, 0, 300)?.avgBpm).toBeCloseTo(120, 0);
  });

  it('clips an interval that straddles the window edge', () => {
    // One sample at t=0 charged for 300 s at 100 bpm; the window is its last 100 s.
    const samples: HrSample[] = [[0, 100], [300, 200], [400, 200]];
    const window = windowHeartrate(samples, 200, 300);
    expect(window?.avgBpm).toBeCloseTo(100, 5);
    expect(window?.coveredS).toBeCloseTo(100, 5);
  });

  it('reports the peak inside the window', () => {
    const samples: HrSample[] = [...steady(0, 99, 130), [50, 181], ...steady(200, 299, 190)];
    expect(windowHeartrate(samples, 0, 100)?.maxBpm).toBe(181);
  });

  it('does not charge a dropout at the last-seen rate', () => {
    // A sample at t=0 then nothing until t=1800: only 300 s may be charged.
    const samples: HrSample[] = [[0, 150], [1800, 150]];
    expect(windowHeartrate(samples, 0, 1800)?.coveredS).toBeCloseTo(300, 5);
  });

  it('has nothing to say about an empty or backwards window', () => {
    expect(windowHeartrate([], 0, 100)).toBeNull();
    expect(windowHeartrate(steady(0, 99, 140), 100, 100)).toBeNull();
    expect(windowHeartrate(null, 0, 100)).toBeNull();
  });
});

describe('effortMetrics', () => {
  it('turns a window into time, speed and pace', () => {
    const m = effortMetrics({ startS: 100, endS: 400, distanceM: 1000 });
    expect(m?.durationS).toBe(300);
    expect(m?.speedMps).toBeCloseTo(3.333, 2);
    expect(m?.paceSPerKm).toBe(300);
  });

  it('computes efficiency and cost from the same heartbeats', () => {
    // 1000 m in 300 s at 150 bpm: 200 m/min ÷ 150 = 1.333 m·min⁻¹/bpm,
    // and 150 × 5 min = 750 beats over 1 km.
    const m = effortMetrics({
      startS: 0,
      endS: 300,
      distanceM: 1000,
      hrSamples: steady(0, 300, 150),
    });
    expect(m?.avgHeartrate).toBeCloseTo(150, 0);
    expect(m?.efficiencyFactor).toBeCloseTo(1.333, 2);
    expect(m?.beatsPerKm).toBeCloseTo(750, 0);
  });

  it('ranks a faster effort at the same heart rate as more efficient', () => {
    const slow = effortMetrics({ startS: 0, endS: 360, distanceM: 1000, hrSamples: steady(0, 360, 150) });
    const fast = effortMetrics({ startS: 0, endS: 300, distanceM: 1000, hrSamples: steady(0, 300, 150) });
    expect(fast!.efficiencyFactor!).toBeGreaterThan(slow!.efficiencyFactor!);
    expect(fast!.beatsPerKm!).toBeLessThan(slow!.beatsPerKm!);
  });

  it('refuses an average the series cannot support', () => {
    // 60 s of samples across a 300 s effort — well under the coverage floor.
    const m = effortMetrics({
      startS: 0,
      endS: 300,
      distanceM: 900,
      hrSamples: steady(0, 60, 150),
    });
    expect(MIN_HR_COVERAGE).toBe(0.5);
    expect(m?.avgHeartrate).toBeNull();
    expect(m?.efficiencyFactor).toBeNull();
    expect(m?.beatsPerKm).toBeNull();
    // The pace half of the effort is still perfectly good.
    expect(m?.paceSPerKm).toBeCloseTo(333.3, 0);
  });

  it('has nothing to report for a zero-length or zero-distance effort', () => {
    expect(effortMetrics({ startS: 100, endS: 100, distanceM: 500 })).toBeNull();
    expect(effortMetrics({ startS: 0, endS: 300, distanceM: 0 })).toBeNull();
  });
});

describe('beatsPerKm', () => {
  it('is null without a heart rate rather than zero', () => {
    expect(beatsPerKm(1000, 300, null)).toBeNull();
  });
});

describe('rankEfforts', () => {
  const rows = [
    { id: 'a', ef: 1.42, pace: 342 },
    { id: 'b', ef: 1.19, pace: 370 },
    { id: 'c', ef: 1.31, pace: 351 },
    { id: 'd', ef: null as number | null, pace: 400 },
  ];

  it('ranks efficiency highest-first', () => {
    const ranks = rankEfforts(rows, 'efficiencyFactor', (r) => r.ef);
    expect(ranks.get(rows[0])).toBe(1);
    expect(ranks.get(rows[2])).toBe(2);
    expect(ranks.get(rows[1])).toBe(3);
  });

  it('ranks time lowest-first', () => {
    const ranks = rankEfforts(rows, 'durationS', (r) => r.pace);
    expect(ranks.get(rows[0])).toBe(1);
    expect(ranks.get(rows[3])).toBe(4);
  });

  it('leaves an effort with no value unranked rather than last', () => {
    const ranks = rankEfforts(rows, 'efficiencyFactor', (r) => r.ef);
    expect(ranks.has(rows[3])).toBe(false);
  });

  it('gives tied efforts the same rank and skips the one after', () => {
    const tied = [{ v: 5 }, { v: 3 }, { v: 3 }, { v: 9 }];
    const ranks = rankEfforts(tied, 'speedMps', (r) => r.v);
    expect(ranks.get(tied[3])).toBe(1);
    expect(ranks.get(tied[0])).toBe(2);
    expect(ranks.get(tied[1])).toBe(3);
    expect(ranks.get(tied[2])).toBe(3);
  });
});
