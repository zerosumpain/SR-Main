import { describe, it, expect } from 'vitest';
import { computeMoves, MAX_MOVES, type MovesInput } from './moves';
import type { MetricResult } from './analytics/types';

function ok<T>(value: T, sampleSize = 28): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize, asOf: '2026-08-30' };
}
function thin<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: '2026-08-30' };
}

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
const BALANCE_OK = {
  ...BALANCE_ZERO,
  averageBalanceMin: -10,
  averageActualMin: 470,
  averageNeedMin: 480,
  nightsBelowNeed: 3,
  strainRecoveryBalance: 1,
};
const BALANCE_SHORT = {
  ...BALANCE_ZERO,
  averageBalanceMin: -60,
  averageActualMin: 420,
  averageNeedMin: 480,
  trendActualMin: -15,
  nightsBelowNeed: 7,
  latestWhoopDebtAdjustmentMin: 90,
  strainRecoveryBalance: 2.6,
  short: true,
};

/** The prototype's reading: short sleep, drifting phase, thin volume. */
function prototypeInput(): MovesInput {
  return {
    readiness: { score: 68, label: 'Moderate' },
    acwr: ok({ acuteEWMA: 6.2, chronicEWMA: 10, ratio: 0.62, zone: 'undertraining' }),
    monotony: ok({ monotony: 1.4, strain: 90, mean: 9, sd: 6.4, band: 'moderate' as const }),
    polarised: ok({ easyPct: 84, midPct: 9, hardPct: 7, verdict: 'pyramid' as const, totalMinutes: 210 }),
    sri: ok(71),
    circadian: ok({ driftHours: 1.3, baselineMidpointMin: 190, recentMidpointMin: 268, flag: 'drift-late' as const }),
    autonomic: ok({ score: 44, hrvZ: -0.36, rhrZ: 0.12, hrv7dMean: 42, rhr7dMean: 50, hrvBaselineMean: 44, rhrBaselineMean: 49 }),
    recoveryDebt: ok(BALANCE_SHORT),
    efficiency: { latest7: 742, baseline28: 728 },
    vo2: ok({ current: 41.2, trendSlopePerMonth: -0.14, percentile: 63, band: 'excellent' as const }),
    volume: { weekKm: 7.7, medianKm: 20 },
  };
}

describe('computeMoves — the list', () => {
  const moves = computeMoves(prototypeInput());

  it('never runs past five', () => {
    expect(moves.length).toBeLessThanOrEqual(MAX_MOVES);
    expect(MAX_MOVES).toBe(5);
  });

  it('ranks contiguously from one, highest leverage first', () => {
    expect(moves.map((m) => m.rank)).toEqual(moves.map((_, i) => i + 1));
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i].leverage).toBeLessThanOrEqual(moves[i - 1].leverage);
    }
  });

  it('leads on the sleep window when three sleep instruments are off target', () => {
    const lead = moves[0];
    expect(lead.id).toBe('sleep-window');
    expect(lead.leverage).toBe(5);
    expect(lead.leverageLabel).toBe('3 INSTRUMENTS');
    expect(lead.tone).toBe('accent');
    expect(lead.instruments).toEqual(['SRI', 'CIRCADIAN DRIFT', 'SLEEP BALANCE']);
  });

  it('states the numbers it is attacking, not adjectives', () => {
    const lead = moves[0];
    expect(lead.rationale).toContain('71');    // SRI
    expect(lead.rationale).toContain('1.3');   // circadian drift, hours
    expect(lead.rationale).toContain('60');    // average shortfall, minutes per night
  });

  it('gives every move something it buys and something it costs', () => {
    for (const m of moves) {
      expect(m.buys.length).toBeGreaterThan(0);
      expect(m.costs.length).toBeGreaterThan(0);
      expect(m.title).toBe(m.title.toUpperCase());
    }
  });
});

describe('computeMoves — the volume move', () => {
  it('names the ACWR it is pulling back and the volume it is adding', () => {
    const m = computeMoves(prototypeInput()).find((x) => x.id === 'long-easy-day')!;
    expect(m.leverage).toBe(4);
    expect(m.leverageLabel).toBe('2 INSTRUMENTS');
    expect(m.rationale).toContain('7.7');
    expect(m.rationale).toContain('0.62');
    expect(m.buys.join(' ')).toContain('0.62');
  });

  it('is dropped once ACWR is optimal and the week is at its median', () => {
    const moves = computeMoves({
      ...prototypeInput(),
      acwr: ok({ acuteEWMA: 10, chronicEWMA: 10, ratio: 1.05, zone: 'optimal' }),
      volume: { weekKm: 21, medianKm: 20 },
    });
    expect(moves.find((m) => m.id === 'long-easy-day')).toBeUndefined();
  });

  // The path where the move is carried by volume ALONE: ACWR is inside the
  // band so it contributes nothing, and VO₂max and the easy share are quiet.
  // The volume branch filled the rationale and left `buys` empty, which the
  // card renders as a blank paragraph under the BUYS heading.
  function volumeOnlyInput(): MovesInput {
    return {
      ...prototypeInput(),
      acwr: ok({ acuteEWMA: 10, chronicEWMA: 10, ratio: 1.05, zone: 'optimal' }),
      vo2: ok({ current: 41.2, trendSlopePerMonth: 0.08, percentile: 63, band: 'excellent' as const }),
      polarised: ok({ easyPct: 60, midPct: 25, hardPct: 15, verdict: 'pyramid' as const, totalMinutes: 210 }),
      volume: { weekKm: 7.7, medianKm: 20 },
    };
  }

  it('still says what it buys when volume is the ONLY instrument behind it', () => {
    const m = computeMoves(volumeOnlyInput()).find((x) => x.id === 'long-easy-day')!;
    expect(m.instruments).toEqual(['WEEKLY VOLUME']);
    expect(m.buys.length).toBeGreaterThan(0);
    expect(m.buys.join(' ')).not.toBe('');
    // Derived from the same two figures the rationale quotes, not a new claim.
    expect(m.buys.join(' ')).toContain('7.7');
    expect(m.buys.join(' ')).toContain('20');
    expect(m.buys.join(' ')).not.toContain('ACWR');
  });

  it('never emits a move with nothing in its BUYS column, on any of these paths', () => {
    const inputs: MovesInput[] = [
      prototypeInput(),
      volumeOnlyInput(),
      { ...volumeOnlyInput(), sri: ok(90) },
      {
        ...volumeOnlyInput(),
        readiness: { score: 88, label: 'Primed' },
        recoveryDebt: ok(BALANCE_OK),
      },
      { ...prototypeInput(), volume: { weekKm: 7.7, medianKm: 20 }, autonomic: null },
    ];
    for (const input of inputs) {
      for (const m of computeMoves(input)) {
        expect(m.buys.length, `${m.id} shipped with an empty BUYS`).toBeGreaterThan(0);
        expect(m.costs.length, `${m.id} shipped with an empty COSTS`).toBeGreaterThan(0);
      }
    }
  });
});

describe('computeMoves — the mix move and its gate', () => {
  it('is gated and muted while the sleep and volume moves are still on the list', () => {
    const m = computeMoves(prototypeInput()).find((x) => x.id === 'polarised-mix')!;
    expect(m.tone).toBe('muted');
    expect(m.leverage).toBe(3);
    expect(m.leverageLabel).toBe('GATED ON 01+02');
    expect(m.costs.join(' ').toLowerCase()).toContain('should not start');
  });

  it('takes the accent once nothing gates it', () => {
    const moves = computeMoves({
      ...prototypeInput(),
      sri: ok(90),
      circadian: ok({ driftHours: 0.2, baselineMidpointMin: 190, recentMidpointMin: 202, flag: 'aligned' as const }),
      recoveryDebt: ok(BALANCE_OK),
      acwr: ok({ acuteEWMA: 10, chronicEWMA: 10, ratio: 1.05, zone: 'optimal' }),
      volume: { weekKm: 21, medianKm: 20 },
    });
    const m = moves.find((x) => x.id === 'polarised-mix')!;
    expect(m.tone).toBe('accent');
    expect(m.leverageLabel).toBe('1 INSTRUMENT');
    expect(m.rank).toBe(1);
  });

  it('is dropped when the mix is already polarised', () => {
    const moves = computeMoves({
      ...prototypeInput(),
      polarised: ok({ easyPct: 82, midPct: 6, hardPct: 12, verdict: 'polarised' as const, totalMinutes: 210 }),
    });
    expect(moves.find((m) => m.id === 'polarised-mix')).toBeUndefined();
  });
});

describe('computeMoves — the honest baseline', () => {
  it('always closes the list, at leverage one', () => {
    const moves = computeMoves(prototypeInput());
    const last = moves[moves.length - 1];
    expect(last.id).toBe('hold-and-watch');
    expect(last.leverage).toBe(1);
    expect(last.leverageLabel).toBe('BASELINE');
  });

  it('withdraws itself when an instrument is actually in a danger band', () => {
    const moves = computeMoves({
      ...prototypeInput(),
      acwr: ok({ acuteEWMA: 18, chronicEWMA: 10, ratio: 1.8, zone: 'danger' }),
    });
    expect(moves.find((m) => m.id === 'hold-and-watch')).toBeUndefined();
  });
});

describe('computeMoves — sufficiency', () => {
  it('reads nothing off a zero struct: no readable instrument, no moves', () => {
    const moves = computeMoves({
      readiness: null,
      acwr: thin({ acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const }),
      monotony: thin({ monotony: 0, strain: 0, mean: 0, sd: 0, band: 'low' as const }),
      polarised: thin({ easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume' as const, totalMinutes: 0 }),
      sri: thin(0),
      circadian: thin({ driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' as const }),
      autonomic: null,
      recoveryDebt: thin(BALANCE_ZERO),
      efficiency: null,
      vo2: null,
      volume: null,
    });
    expect(moves).toEqual([]);
  });

  it('drops the sleep move to two instruments when the circadian window is thin', () => {
    const moves = computeMoves({
      ...prototypeInput(),
      circadian: thin({ driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' as const }),
    });
    const m = moves.find((x) => x.id === 'sleep-window')!;
    expect(m.leverage).toBe(4);
    expect(m.leverageLabel).toBe('2 INSTRUMENTS');
    expect(m.instruments).toEqual(['SRI', 'SLEEP BALANCE']);
    expect(m.rationale).not.toContain('drift');
  });
});
