import { describe, it, expect } from 'vitest';
import { computeVerdict, type VerdictInput } from './verdict';
import { computeMoves } from './moves';
import { computeExperiments } from './experiments';
import type { MetricResult } from './analytics/types';

const TODAY = '2026-08-30';

function ok<T>(value: T, sampleSize = 28): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize, asOf: TODAY };
}
function thin<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: TODAY };
}

const INSTRUMENTS = {
  acwr: ok({ acuteEWMA: 6.2, chronicEWMA: 10, ratio: 0.62, zone: 'undertraining' as const }),
  monotony: ok({ monotony: 1.4, strain: 90, mean: 9, sd: 6.4, band: 'moderate' as const }),
  polarised: ok({ easyPct: 84, midPct: 9, hardPct: 7, verdict: 'pyramid' as const, totalMinutes: 210 }),
  sri: ok(71),
  circadian: ok({ driftHours: 1.3, baselineMidpointMin: 190, recentMidpointMin: 268, flag: 'drift-late' as const }),
  autonomic: ok({ score: 44, hrvZ: -0.36, rhrZ: 0.12, hrv7dMean: 42, rhr7dMean: 50, hrvBaselineMean: 44, rhrBaselineMean: 49 }),
  recoveryDebt: ok({ sleepDebtMin: 612, strainRecoveryBalance: 2.6, overdrawn: true, series: [] }),
  vo2: ok({ current: 41.2, trendSlopePerMonth: -0.14, percentile: 63, band: 'excellent' as const }),
};

function prototypeInput(): VerdictInput {
  const shared = {
    ...INSTRUMENTS,
    efficiency: { latest7: 742, baseline28: 728 },
    volume: { weekKm: 7.7, medianKm: 20 },
    readiness: { score: 68, label: 'Moderate' },
  };
  return {
    today: TODAY,
    ...shared,
    moves: computeMoves(shared),
    experiments: computeExperiments({ today: TODAY, ...shared }),
    rhr: { latest7: 50, baseline28: 50 },
    records: [
      { label: 'Longest Run', value: 40.8, unit: 'km', date: '2026-05-04' },
      { label: 'Most Elevation', value: 1723, unit: 'm', date: '2026-05-04' },
    ],
  };
}

describe('computeVerdict — the headline', () => {
  const v = computeVerdict(prototypeInput())!;

  it('is two lines, the second one the problem', () => {
    expect(v.headline).toHaveLength(2);
    expect(v.headline[0]).toBe('CAPABLE.');
    expect(v.headline[1]).toBe('UNDER-SLEPT.');
  });

  it('changes the second line when the problem changes', () => {
    const detraining = computeVerdict({
      ...prototypeInput(),
      sri: ok(92),
      circadian: ok({ driftHours: 0.1, baselineMidpointMin: 190, recentMidpointMin: 196, flag: 'aligned' as const }),
      recoveryDebt: ok({ sleepDebtMin: 20, strainRecoveryBalance: 1, overdrawn: false, series: [] }),
      acwr: ok({ acuteEWMA: 3, chronicEWMA: 10, ratio: 0.3, zone: 'detraining' as const }),
    })!;
    expect(detraining.headline[1]).toBe('DETRAINING.');
  });

  it('says so when nothing is wrong', () => {
    const clean = computeVerdict({
      ...prototypeInput(),
      sri: ok(92),
      circadian: ok({ driftHours: 0.1, baselineMidpointMin: 190, recentMidpointMin: 196, flag: 'aligned' as const }),
      recoveryDebt: ok({ sleepDebtMin: 20, strainRecoveryBalance: 1, overdrawn: false, series: [] }),
      acwr: ok({ acuteEWMA: 10, chronicEWMA: 10, ratio: 1.05, zone: 'optimal' as const }),
      volume: { weekKm: 21, medianKm: 20 },
      monotony: ok({ monotony: 1.4, strain: 90, mean: 9, sd: 6.4, band: 'moderate' as const }),
    })!;
    expect(clean.headline[1]).toBe('AND HOLDING.');
  });
});

describe('computeVerdict — the body', () => {
  const v = computeVerdict(prototypeInput())!;

  it('traces every claim to a number that was passed in', () => {
    const all = v.body.join(' ');
    expect(all).toContain('50 bpm');       // resting heart rate baseline
    expect(all).toContain('63rd');         // VO₂max percentile
    expect(all).toContain('612');          // sleep debt
    expect(all).toContain('71');           // SRI
    expect(all).toContain('40.8 km');      // the capability on record
    expect(all).toContain('1,723 m');
  });

  it('never invents a record it was not given', () => {
    const v2 = computeVerdict({ ...prototypeInput(), records: null })!;
    expect(v2.body.join(' ')).not.toContain('km day');
  });
});

describe('computeVerdict — the pull quote', () => {
  const v = computeVerdict(prototypeInput())!;

  it('is the top moves said as instructions', () => {
    expect(v.pullQuoteLabel).toBe('IF ONLY ONE THING CHANGES');
    expect(v.pullQuote).toContain('Go to bed at the same time');
    expect(v.pullQuote).toContain('long, dull walk');
  });

  it('counts the instruments those moves actually touch', () => {
    expect(v.pullQuoteFollow).toContain('five of the eight instruments');
  });
});

describe('computeVerdict — the review rows', () => {
  const v = computeVerdict(prototypeInput())!;

  it('dates one row per experiment, then the standing checks', () => {
    expect(v.reviews.length).toBeGreaterThanOrEqual(3);
    expect(v.reviews[0].label).toBe('Review E1');
    // The debt fixture here carries no dated series, so E1 is on day 1 of 21
    // and its own last day is 20 days out — the counter never claims a run it
    // cannot evidence.
    expect(v.reviews[0].date).toBe('19 SEP 2026');
    expect(v.reviews[1].label).toBe('Review E2 · start E3');
  });

  it('puts the VO₂max regression check a full window out', () => {
    const row = v.reviews.find((r) => r.label.startsWith('VO₂max'))!;
    expect(row.iso).toBe('2026-11-28');
    expect(row.date).toBe('28 NOV 2026');
  });

  it('books the big day at the end of the fifth month out', () => {
    const row = v.reviews.find((r) => r.label.startsWith('Big day'))!;
    expect(row.iso).toBe('2027-01-31');
  });

  it('keeps the rows in date order', () => {
    const isos = v.reviews.map((r) => r.iso);
    expect([...isos].sort()).toEqual(isos);
  });
});

describe('computeVerdict — sufficiency', () => {
  it('says nothing at all when nothing can be read', () => {
    expect(
      computeVerdict({
        today: TODAY,
        moves: [],
        experiments: [],
        readiness: null,
        acwr: thin({ acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const }),
        monotony: thin({ monotony: 0, strain: 0, mean: 0, sd: 0, band: 'low' as const }),
        polarised: thin({ easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume' as const, totalMinutes: 0 }),
        sri: thin(0),
        circadian: thin({ driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' as const }),
        autonomic: null,
        recoveryDebt: thin({ sleepDebtMin: 0, strainRecoveryBalance: 0, overdrawn: false, series: [] }),
        vo2: thin({ current: 0, trendSlopePerMonth: 0, percentile: 0, band: 'poor' as const }),
        efficiency: null,
        volume: null,
        rhr: null,
        records: null,
      }),
    ).toBeNull();
  });

  it('does not read a zero struct as a 0 bpm resting heart rate', () => {
    const v = computeVerdict({ ...prototypeInput(), rhr: null })!;
    expect(v.body.join(' ')).not.toContain('0 bpm');
  });
});
