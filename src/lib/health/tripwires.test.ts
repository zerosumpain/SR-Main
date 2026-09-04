import { describe, it, expect } from 'vitest';
import { computeTripwires, TRIPWIRE_IDS, type TripwireInput } from './tripwires';
import type { MetricResult } from './analytics/types';
import type { DayPoint } from './analytics/rolling';

const TODAY = '2026-08-30';

function ok<T>(value: T, sampleSize = 28): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize, asOf: TODAY };
}
function thin<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: TODAY };
}

function days(n: number, at: (i: number) => number, endsOn = TODAY): DayPoint[] {
  const end = Date.parse(endsOn + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: at(i),
  }));
}

/** Weeks oldest first; the LAST one is the in-progress week, as weeklyVolume ships them. */
function weeks(distancesKm: number[]): TripwireInput['weeks'] {
  const thisMonday = Date.parse('2026-08-24T00:00:00Z');
  const n = distancesKm.length;
  return distancesKm.map((km, i) => ({
    weekStart: new Date(thisMonday - (n - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
    totalDistanceM: km * 1000,
  }));
}

const ACWR_ZERO = { acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const };
const BALANCE_ZERO = {
  averageBalanceMin: 0,
  averageActualMin: 0,
  averageNeedMin: 0,
  trendActualMin: null,
  nightsBelowNeed: 0,
  latestWhoopDebtAdjustmentMin: null,
  strainRecoveryBalance: 0,
  short: false,
  series: [],
};
const VO2_ZERO = { current: 0, trendSlopePerMonth: 0, percentile: 0, band: 'poor' as const };

/** The prototype's illustrative reading — two TRIPPED, two CLOSE, five ARMED. */
function prototypeInput(): TripwireInput {
  return {
    today: TODAY,
    recoveryDebt: ok({
      averageBalanceMin: -60,
      averageActualMin: 420,
      averageNeedMin: 480,
      trendActualMin: -15,
      nightsBelowNeed: 7,
      latestWhoopDebtAdjustmentMin: 90,
      strainRecoveryBalance: 2.6,
      short: true,
      series: [],
    }),
    acwr: ok({ acuteEWMA: 6.2, chronicEWMA: 10, ratio: 0.62, zone: 'undertraining' }),
    vo2: ok({ current: 41.2, trendSlopePerMonth: -0.14, percentile: 63, band: 'excellent' }),
    hrv: { daily: days(28, () => 42), rolling7: days(28, () => 42), latest7: 42, baseline28: 44 },
    rhr: { daily: days(28, () => 50), rolling7: days(28, () => 50), latest7: 50, baseline28: 50 },
    recovery: days(28, () => 64),
    weeks: weeks([20, 19, 21, 18, 22, 20, 19, 21, 20, 18, 7.7, 2.1]),
    segments: null,
  };
}

describe('computeTripwires — the table', () => {
  it('is the nine rows of section E, in order, always', () => {
    const rows = computeTripwires(prototypeInput());
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.id)).toEqual([...TRIPWIRE_IDS]);
  });

  it('still renders nine rows when every input is missing', () => {
    const rows = computeTripwires({ today: TODAY });
    expect(rows).toHaveLength(9);
    // A number nobody can read has not tripped — but it says so rather than
    // presenting an unread wire as armed and healthy.
    expect(rows.every((r) => r.state === 'ARMED')).toBe(true);
    expect(rows.every((r) => r.readable === false)).toBe(true);
    expect(rows.every((r) => r.now === '—')).toBe(true);
  });

  it('refuses to read an insufficient metric, zero struct and all', () => {
    const rows = computeTripwires({
      today: TODAY,
      recoveryDebt: thin(BALANCE_ZERO),
      acwr: thin(ACWR_ZERO),
      vo2: thin(VO2_ZERO),
    });
    const balance = rows.find((r) => r.id === 'sleep-balance')!;
    expect(balance.readable).toBe(false);
    expect(balance.state).toBe('ARMED');
    expect(balance.now).toBe('—');
    // A zero balance is what the zero struct says; it must not print as good news.
    expect(balance.now).not.toContain('0 min');
  });
});

describe('computeTripwires — states against the prototype reading', () => {
  const rows = computeTripwires(prototypeInput());
  const at = (id: string) => rows.find((r) => r.id === id)!;

  it('trips sleep balance when the seven-night mean is over 30 minutes short', () => {
    expect(at('sleep-balance').state).toBe('TRIPPED');
    expect(at('sleep-balance').trigger).toBe('< −30 min/night');
    expect(at('sleep-balance').now).toBe('−60 min/night');
    expect(at('sleep-balance').meaning).toContain('7 of 7 nights');
  });

  it('trips weekly volume on a seven-point-seven kilometre week', () => {
    const r = at('weekly-volume');
    expect(r.state).toBe('TRIPPED');
    expect(r.trigger).toBe('< 50%');
    expect(r.now).toBe('7.7 km · 39%');
  });

  it('calls ACWR CLOSE at 0.62 — under the band, above the trigger', () => {
    const r = at('acwr');
    expect(r.state).toBe('CLOSE');
    expect(r.trigger).toBe('< 0.50');
    expect(r.now).toBe('0.62');
  });

  it('calls an HRV mean inside the noise band CLOSE, not TRIPPED', () => {
    const r = at('hrv-crossing');
    expect(r.state).toBe('CLOSE');
    expect(r.now).toBe('42 vs 44');
  });

  it('leaves resting heart rate ARMED when it is on its baseline', () => {
    const r = at('resting-hr');
    expect(r.state).toBe('ARMED');
    expect(r.now).toBe('50 · on base');
  });

  it('leaves recovery reds ARMED at none in a row', () => {
    const r = at('recovery-reds');
    expect(r.state).toBe('ARMED');
    expect(r.now).toBe('0 · 64% today');
  });

  it('leaves the strain-recovery balance ARMED well under 8', () => {
    const r = at('strain-balance');
    expect(r.state).toBe('ARMED');
    expect(r.now).toBe('2.6');
  });

  it('leaves the VO₂max slope ARMED at −0.14, inside the −0.20 trigger', () => {
    const r = at('vo2-slope');
    expect(r.state).toBe('ARMED');
    expect(r.trigger).toBe('< −0.20/mo');
    expect(r.now).toBe('−0.14/mo');
  });

  it('keeps the one positive tripwire armed with no segment feed', () => {
    const r = at('segment-pb');
    expect(r.state).toBe('ARMED');
    expect(r.trigger).toBe('gap < 3% & improving');
    expect(r.meaning).toContain('positive');
  });
});

describe('computeTripwires — the edges', () => {
  it('trips the ACWR wire once the ratio is actually under the detraining edge', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      acwr: ok({ acuteEWMA: 4, chronicEWMA: 10, ratio: 0.4, zone: 'detraining' }),
    });
    expect(rows.find((r) => r.id === 'acwr')!.state).toBe('TRIPPED');
  });

  it('goes CLOSE on sleep balance at four fifths of the action line', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      recoveryDebt: ok({
        ...BALANCE_ZERO,
        averageBalanceMin: -25,
        averageActualMin: 455,
        averageNeedMin: 480,
        nightsBelowNeed: 5,
        strainRecoveryBalance: 1,
      }),
    });
    expect(rows.find((r) => r.id === 'sleep-balance')!.state).toBe('CLOSE');
  });

  it('trips resting heart rate only on the third consecutive day over baseline', () => {
    const two = computeTripwires({
      ...prototypeInput(),
      rhr: {
        daily: days(28, (i) => (i >= 26 ? 55 : 50)),
        rolling7: days(28, () => 50),
        latest7: 52,
        baseline28: 50,
      },
    });
    expect(two.find((r) => r.id === 'resting-hr')!.state).toBe('CLOSE');

    const three = computeTripwires({
      ...prototypeInput(),
      rhr: {
        daily: days(28, (i) => (i >= 25 ? 55 : 50)),
        rolling7: days(28, () => 50),
        latest7: 53,
        baseline28: 50,
      },
    });
    const r = three.find((r) => r.id === 'resting-hr')!;
    expect(r.state).toBe('TRIPPED');
    expect(r.now).toBe('55 · +5 bpm');
  });

  it('trips recovery reds on three in a row and calls two CLOSE', () => {
    const twoReds = computeTripwires({
      ...prototypeInput(),
      recovery: days(28, (i) => (i >= 26 ? 25 : 70)),
    });
    expect(twoReds.find((r) => r.id === 'recovery-reds')!.state).toBe('CLOSE');

    const threeReds = computeTripwires({
      ...prototypeInput(),
      recovery: days(28, (i) => (i >= 25 ? 25 : 70)),
    });
    const r = threeReds.find((r) => r.id === 'recovery-reds')!;
    expect(r.state).toBe('TRIPPED');
    expect(r.now).toBe('3 · 25% today');
  });

  it('trips the strain-recovery balance over 8', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      recoveryDebt: ok({ ...BALANCE_ZERO, strainRecoveryBalance: 9.4 }),
    });
    expect(rows.find((r) => r.id === 'strain-balance')!.state).toBe('TRIPPED');
  });

  it('trips the VO₂max slope past −0.20 a month', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      vo2: ok({ current: 40, trendSlopePerMonth: -0.31, percentile: 55, band: 'good' }),
    });
    expect(rows.find((r) => r.id === 'vo2-slope')!.state).toBe('TRIPPED');
  });

  it('fires the positive tripwire when a record is genuinely gettable', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      segments: {
        gettable: 2,
        improving: 11,
        withForm: 64,
        nearest: { name: 'living.matter.ground', gapPct: 0.018 },
      },
    });
    const r = rows.find((r) => r.id === 'segment-pb')!;
    expect(r.state).toBe('TRIPPED');
    expect(r.now).toBe('2 gettable');
    expect(r.meaning).toContain('living.matter.ground');
    expect(r.meaning).toContain('1.8%');
  });

  it('ignores the in-progress week — a Monday is not a 90% drop in volume', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      weeks: weeks([20, 19, 21, 18, 22, 20, 19, 21, 20, 18, 20, 1.2]),
    });
    expect(rows.find((r) => r.id === 'weekly-volume')!.state).toBe('ARMED');
  });
});

// ——— gaps in the series ————————————————————————————————————————
//
// The Whoop daily series is NOT zero-filled: a night the strap was off is
// simply absent from it. A streak counted in array entries therefore steps
// straight over the missing days and reports "three in a row" from three
// readings scattered across a fortnight — on the three wires that speak in
// consecutive days, which are the three most alarming rows on the table.

/** Days from explicit `[date, value]` pairs, so a gap can be written down. */
function gapped(pairs: Array<[string, number]>): DayPoint[] {
  return pairs.map(([date, value]) => ({ date, value }));
}

describe('computeTripwires — streaks count DAYS, not readings', () => {
  it('does not call three reds either side of a gap three in a row', () => {
    // Three reds, but the 27th is missing: two consecutive days, then a hole.
    const rows = computeTripwires({
      ...prototypeInput(),
      recovery: gapped([
        ['2026-08-24', 70],
        ['2026-08-25', 70],
        ['2026-08-26', 25],
        ['2026-08-28', 25],
        ['2026-08-29', 25],
      ]),
    });
    const r = rows.find((r) => r.id === 'recovery-reds')!;
    expect(r.state).toBe('CLOSE');
    expect(r.now).toBe('2 · 25% today');
  });

  it('still trips on three reds that really are consecutive', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      recovery: gapped([
        ['2026-08-26', 70],
        ['2026-08-27', 25],
        ['2026-08-28', 25],
        ['2026-08-29', 25],
      ]),
    });
    const r = rows.find((r) => r.id === 'recovery-reds')!;
    expect(r.state).toBe('TRIPPED');
    expect(r.meaning).toContain('3 reds in a row');
  });

  it('does not call resting HR elevated for three days across a two-day hole', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      rhr: {
        daily: gapped([
          ['2026-08-24', 50],
          ['2026-08-25', 55],
          ['2026-08-28', 55],
          ['2026-08-29', 55],
        ]),
        rolling7: days(28, () => 50),
        latest7: 55,
        baseline28: 50,
      },
    });
    const r = rows.find((r) => r.id === 'resting-hr')!;
    expect(r.state).toBe('CLOSE');
    expect(r.meaning).toContain('for 2 days');
  });

  it('still trips resting HR on three consecutive mornings over the mark', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      rhr: {
        daily: gapped([
          ['2026-08-26', 50],
          ['2026-08-27', 55],
          ['2026-08-28', 55],
          ['2026-08-29', 55],
        ]),
        rolling7: days(28, () => 50),
        latest7: 55,
        baseline28: 50,
      },
    });
    expect(rows.find((r) => r.id === 'resting-hr')!.state).toBe('TRIPPED');
  });

  it('does not read an HRV crossing across a missing day', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      hrv: {
        daily: days(28, () => 38),
        rolling7: gapped([
          ['2026-08-26', 44],
          ['2026-08-27', 38],
          ['2026-08-29', 38],
        ]),
        latest7: 38,
        baseline28: 44,
      },
    });
    const r = rows.find((r) => r.id === 'hrv-crossing')!;
    expect(r.state).toBe('CLOSE');
  });

  it('still reads a crossing over two consecutive days under the noise band', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      hrv: {
        daily: days(28, () => 38),
        rolling7: gapped([
          ['2026-08-26', 44],
          ['2026-08-28', 38],
          ['2026-08-29', 38],
        ]),
        latest7: 38,
        baseline28: 44,
      },
    });
    const r = rows.find((r) => r.id === 'hrv-crossing')!;
    expect(r.state).toBe('TRIPPED');
    expect(r.meaning).toContain('2 days running');
  });

  it('is not fooled by an unsorted series or two readings on one date', () => {
    const rows = computeTripwires({
      ...prototypeInput(),
      recovery: gapped([
        ['2026-08-29', 25],
        ['2026-08-27', 25],
        ['2026-08-28', 25],
        ['2026-08-28', 25],
      ]),
    });
    expect(rows.find((r) => r.id === 'recovery-reds')!.state).toBe('TRIPPED');
  });
});
