import { describe, it, expect } from 'vitest';
import type { HubDigest } from '$lib/server/health-hub-contract';
import { APPLE_SERIES, WHOOP_SERIES, boundDays, renderHub, renderSeries } from './health';

describe('boundDays', () => {
  it('aggregates each day by its rule, oldest first', () => {
    const byDay = new Map([
      ['2026-09-02', [4000, 3000]],
      ['2026-09-01', [5000]],
    ]);
    expect(boundDays(byDay, 'sum', 0, 100_000).days).toEqual([
      { day: '2026-09-01', value: 5000 },
      { day: '2026-09-02', value: 7000 },
    ]);
  });

  it('drops and counts a day a unit error put out of bounds', () => {
    // A ×100 that was never undone: 6,000 bpm resting.
    const byDay = new Map([
      ['2026-09-01', [58]],
      ['2026-09-02', [5800]],
    ]);
    const out = boundDays(byDay, 'mean', WHOOP_SERIES.rhr.lo, WHOOP_SERIES.rhr.hi);
    expect(out.days).toEqual([{ day: '2026-09-01', value: 58 }]);
    expect(out.dropped).toBe(1);
  });

  it('bounds sleep so milliseconds-as-minutes cannot survive', () => {
    // 27,841,092 ms read as minutes is the 464,018-hour night.
    const out = boundDays(new Map([['2026-09-01', [27_841_092 / 60]]]), 'mean', WHOOP_SERIES.sleep_hours.lo, WHOOP_SERIES.sleep_hours.hi);
    expect(out.days).toEqual([]);
    expect(out.dropped).toBe(1);
  });
});

describe('renderSeries', () => {
  it('says there is nothing rather than showing zeros', () => {
    expect(renderSeries('hrv', 'ms', [], 0, 28)).toMatch(/no readings/);
  });

  it('compares the last week with the weeks before', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i < 7 ? 50 : 40 }));
    const text = renderSeries('hrv', 'ms', days, 0, 28);
    expect(text).toMatch(/Last 7 recorded days average 40 against 50 before/);
    expect(text).toMatch(/2026-09-14 40/);
  });

  it('reports dropped days as a source fault', () => {
    expect(renderSeries('rhr', 'bpm', [{ day: '2026-09-01', value: 58 }], 2, 28)).toMatch(/2 day\(s\) dropped/);
  });
});

describe('the series catalogue', () => {
  it('has no key in both sources', () => {
    for (const k of Object.keys(APPLE_SERIES)) expect(WHOOP_SERIES).not.toHaveProperty(k);
  });
});

describe('renderHub', () => {
  const digest: HubDigest = {
    generatedAt: '2026-09-25T18:00:00Z',
    syncedAgoSeconds: 600,
    isMock: false,
    lede: 'Recovered, but the load is climbing.',
    readiness: { score: 71, label: 'Ready', recommendation: 'Train as planned', factors: [{ key: 'hrv', label: 'HRV', score: 80, weight: 0.4 }] },
    planner: null,
    tiles: [],
    instruments: [{ key: 'acwr', label: 'Load ratio', window: '28d', display: '1.4', unit: null, tone: 'watch', reading: '1.4 · above the sweet spot', meaning: 'Load is rising faster than fitness.' }],
    forecasts: [],
    moves: [{ rank: 1, title: 'Hold intensity this week', buys: 'recovery', costs: 'one hard session', leverage: 'high' }],
    tripwires: [{ key: 'rhr', state: 'close', signal: 'Resting HR', window: '7d', trigger: '+5 bpm', now: '+4 bpm', meaning: 'Illness or overreach often shows here first.' }],
    segments: null,
    plan: null,
    experiments: [{ status: 'live', title: 'Earlier bedtime', change: 'lights out 22:30', hold: '2 weeks', measure: 'HRV', stop: 'if HRV falls', counter: 'day 5 of 14' }],
    verdict: { headline: ['Fitness up,', 'fatigue up faster.'], body: ['Ease off.'], quote: null, reviewOn: '2026-10-01' },
  };

  it('carries every tripwire with its meaning', () => {
    const text = renderHub(digest);
    expect(text).toMatch(/Resting HR \[close\].*Means: Illness or overreach/);
  });

  it('carries moves, experiments and the verdict', () => {
    const text = renderHub(digest);
    expect(text).toMatch(/1\. Hold intensity this week/);
    expect(text).toMatch(/\[live\] Earlier bedtime/);
    expect(text).toMatch(/Verdict: Fitness up, fatigue up faster\. Ease off\./);
  });

  it('says so when the series is demo data', () => {
    expect(renderHub({ ...digest, isMock: true })).toMatch(/DEMO DATA/);
  });

  it('renders only the sections asked for', () => {
    const text = renderHub(digest, ['tripwires']);
    expect(text).toMatch(/Tripwires/);
    expect(text).not.toMatch(/Ranked moves/);
  });
});
