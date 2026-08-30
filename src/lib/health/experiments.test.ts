import { describe, it, expect } from 'vitest';
import { computeExperiments, type ExperimentsInput } from './experiments';
import type { MetricResult } from './analytics/types';

const TODAY = '2026-08-30';

function ok<T>(value: T, sampleSize = 28): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize, asOf: TODAY };
}
function thin<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: TODAY };
}

/** Cumulative debt that crossed the 240-minute flag four days ago. */
function debtSeries(): Array<{ date: string; debt: number }> {
  const end = Date.parse(TODAY + 'T00:00:00Z');
  const values = [40, 80, 120, 160, 190, 210, 230, 250, 300, 400, 500, 612];
  return values.map((debt, i) => ({
    date: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: debt,
    debt,
  }));
}

function prototypeInput(): ExperimentsInput {
  return {
    today: TODAY,
    sri: ok(71),
    circadian: ok({ driftHours: 1.3, baselineMidpointMin: 190, recentMidpointMin: 268, flag: 'drift-late' as const }),
    recoveryDebt: ok({ sleepDebtMin: 612, strainRecoveryBalance: 2.6, overdrawn: true, series: debtSeries() }),
    acwr: ok({ acuteEWMA: 6.2, chronicEWMA: 10, ratio: 0.62, zone: 'undertraining' }),
    polarised: ok({ easyPct: 84, midPct: 9, hardPct: 7, verdict: 'pyramid' as const, totalMinutes: 210 }),
    volume: { weekKm: 7.7, medianKm: 20 },
  };
}

describe('computeExperiments — the three cards', () => {
  const xs = computeExperiments(prototypeInput());

  it('numbers them E1, E2, E3 in order', () => {
    expect(xs.map((x) => x.code)).toEqual(['E1', 'E2', 'E3']);
    expect(xs.map((x) => x.id)).toEqual(['fixed-window', 'dull-long-day', 'one-hard-effort']);
  });

  it('runs at most one at a time — a second variable makes attribution impossible', () => {
    expect(xs.filter((x) => x.state === 'LIVE')).toHaveLength(1);
    expect(xs[0].state).toBe('LIVE');
    expect(xs[1].state).toBe('QUEUED');
    expect(xs[2].state).toBe('QUEUED');
  });

  it('counts the live one from the day its trigger actually crossed', () => {
    // The debt series crossed 240 four days before today, so this is day five.
    expect(xs[0].daysSinceOnset).toBe(4);
    expect(xs[0].dayCount).toBe(5);
    expect(xs[0].counter).toBe('DAY 5 OF 21');
  });

  it('counts the long-day experiment in weeks', () => {
    expect(xs[1].counter).toMatch(/^WEEK \d+ OF 6$/);
  });

  it('shows the gate rather than a counter on the one that is gated', () => {
    expect(xs[2].counter).toBe('GATED ON E1+E2');
    expect(xs[2].gatedBy).toEqual(['E1', 'E2']);
    expect(xs[2].stopRuleLabel).toBe('ENTRY CONDITION');
  });

  it('labels the live card with a stop rule and dates it', () => {
    expect(xs[0].stopRuleLabel).toBe('STOP RULE');
    // Day 1 was 26 Aug (the crossing); day 21 of 21 is therefore 15 Sep.
    expect(xs[0].stopRule).toContain('15 Sep 2026');
  });

  it('measures against the numbers it is trying to move', () => {
    expect(xs[0].measure).toContain('71');
    expect(xs[0].measure).toContain('85');
    expect(xs[0].measure).toContain('1.3');
    expect(xs[1].measure).toContain('0.62');
    expect(xs[2].measure).toContain('7%');
  });

  it('gives every card all four rows', () => {
    for (const x of xs) {
      expect(x.title).toBe(x.title.toUpperCase());
      expect(x.change.length).toBeGreaterThan(10);
      expect(x.holdConstant.length).toBeGreaterThan(10);
      expect(x.measure.length).toBeGreaterThan(10);
      expect(x.stopRule.length).toBeGreaterThan(10);
    }
  });
});

describe('computeExperiments — eligibility', () => {
  it('drops the sleep experiment once nothing about sleep is off target', () => {
    const xs = computeExperiments({
      ...prototypeInput(),
      sri: ok(90),
      circadian: ok({ driftHours: 0.2, baselineMidpointMin: 190, recentMidpointMin: 202, flag: 'aligned' as const }),
      recoveryDebt: ok({ sleepDebtMin: 20, strainRecoveryBalance: 1, overdrawn: false, series: [] }),
    });
    expect(xs.map((x) => x.id)).toEqual(['dull-long-day', 'one-hard-effort']);
    expect(xs.map((x) => x.code)).toEqual(['E1', 'E2']);
    expect(xs[0].state).toBe('LIVE');
  });

  it('promotes the hard-effort experiment to LIVE once its gates clear', () => {
    const xs = computeExperiments({
      ...prototypeInput(),
      sri: ok(90),
      circadian: ok({ driftHours: 0.2, baselineMidpointMin: 190, recentMidpointMin: 202, flag: 'aligned' as const }),
      recoveryDebt: ok({ sleepDebtMin: 20, strainRecoveryBalance: 1, overdrawn: false, series: [] }),
      acwr: ok({ acuteEWMA: 10, chronicEWMA: 10, ratio: 1.05, zone: 'optimal' }),
      volume: { weekKm: 21, medianKm: 20 },
    });
    expect(xs).toHaveLength(1);
    expect(xs[0].id).toBe('one-hard-effort');
    expect(xs[0].state).toBe('LIVE');
    expect(xs[0].counter).toBe('WEEK 1 OF 8');
    expect(xs[0].stopRuleLabel).toBe('STOP RULE');
  });

  it('ships nothing when no instrument can be read', () => {
    expect(
      computeExperiments({
        today: TODAY,
        sri: thin(0),
        circadian: thin({ driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' as const }),
        recoveryDebt: thin({ sleepDebtMin: 0, strainRecoveryBalance: 0, overdrawn: false, series: [] }),
        acwr: thin({ acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' as const }),
        polarised: thin({ easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume' as const, totalMinutes: 0 }),
        volume: null,
      }),
    ).toEqual([]);
  });

  it('falls back to day one when the trigger has no dated series behind it', () => {
    const xs = computeExperiments({
      ...prototypeInput(),
      recoveryDebt: ok({ sleepDebtMin: 100, strainRecoveryBalance: 1, overdrawn: false, series: [] }),
    });
    // SRI and drift are still off target, so the experiment stands — but with
    // nothing dated behind it, it cannot claim to have been running.
    expect(xs[0].id).toBe('fixed-window');
    expect(xs[0].daysSinceOnset).toBe(0);
    expect(xs[0].counter).toBe('DAY 1 OF 21');
  });
});
