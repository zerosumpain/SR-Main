// triage.test.ts — invariants of the synthetic-cohort triage model: shares sum to 1,
// the weighted mean relative risk reproduces the base rate, recall/precision move the
// right way with the flag rate, and the weighted index dominates the checklist.

import { describe, it, expect } from 'vitest';
import { STRATA, residualRR, triageCurve, triageAt, COHORT_BASE_RATE } from './triage';

describe('triage cohort', () => {
  it('strata shares sum to 1 and the residual RR is sane', () => {
    const total = STRATA.reduce((s, x) => s + x.share, 0);
    expect(total).toBeCloseTo(1, 6);
    const rr = residualRR();
    expect(rr).toBeGreaterThan(0.3);
    expect(rr).toBeLessThan(1);
  });

  it('weighted mean relative risk is 1 (the cohort reproduces the base rate)', () => {
    const none = residualRR();
    const mean = STRATA.reduce((s, x) => s + x.share * (x.rr ? x.rr.central : none), 0);
    expect(mean).toBeCloseTo(1, 6);
  });
});

describe('triage operating points', () => {
  it('recall rises and precision falls (weakly) as the flag rate rises', () => {
    let lastRecall = 0, lastPrecision = 1;
    for (const flagPct of [2, 5, 10, 20, 40]) {
      const p = triageAt(flagPct, 'weighted');
      expect(p.recall).toBeGreaterThan(lastRecall);
      expect(p.precision).toBeLessThanOrEqual(lastPrecision + 1e-9);
      lastRecall = p.recall; lastPrecision = p.precision;
    }
  });

  it('flagging everyone gives recall 1 at base-rate precision', () => {
    const p = triageAt(100, 'weighted');
    expect(p.recall).toBeCloseTo(1, 6);
    expect(p.precision).toBeCloseTo(COHORT_BASE_RATE, 6);
  });

  it('the weighted index dominates the checklist', () => {
    for (const flagPct of [5, 10, 20]) {
      expect(triageAt(flagPct, 'weighted').recall)
        .toBeGreaterThanOrEqual(triageAt(flagPct, 'checklist').recall - 1e-9);
    }
  });

  it('uncertainty bands bracket the central estimate', () => {
    const c = triageCurve('weighted', 200);
    const i = c.flagPct.indexOf(10);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(c.recallP10[i]).toBeLessThanOrEqual(c.recall[i]);
    expect(c.recallP90[i]).toBeGreaterThanOrEqual(c.recall[i]);
  });
});
