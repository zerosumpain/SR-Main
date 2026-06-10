// uplift.test.ts — invariants of the uplift-targeting demonstrator: targeting by
// treatment effect must (weakly) dominate targeting by risk at every budget, the two
// must converge when everyone is treated, and averted counts must rise with budget.

import { describe, it, expect } from 'vitest';
import { upliftAt, upliftCurve, UPLIFT } from './uplift';
import { STRATA } from './triage';

describe('uplift cohort', () => {
  it('every stratum has an uplift band', () => {
    for (const s of STRATA) expect(UPLIFT[s.id]).toBeDefined();
  });
});

describe('uplift vs risk targeting', () => {
  it('uplift targeting (weakly) dominates risk targeting at every budget', () => {
    for (const b of [2, 5, 10, 20, 30, 40]) {
      expect(upliftAt(b, 'uplift').averted).toBeGreaterThanOrEqual(upliftAt(b, 'risk').averted - 1e-9);
    }
  });

  it('uplift targeting is STRICTLY better at mid budgets (the mismatch is real)', () => {
    const r = upliftAt(10, 'risk').averted;
    const u = upliftAt(10, 'uplift').averted;
    expect(u).toBeGreaterThan(r * 1.1); // ≥10% more averted for the same money
  });

  it('the strategies converge when everyone is treated', () => {
    expect(upliftAt(100, 'uplift').averted).toBeCloseTo(upliftAt(100, 'risk').averted, 6);
  });

  it('averted rises monotonically with budget', () => {
    let last = 0;
    for (const b of [5, 10, 20, 40]) {
      const v = upliftAt(b, 'uplift').averted;
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });

  it('uncertainty bands bracket the central curve', () => {
    const c = upliftCurve('uplift', 200);
    const i = c.budgetPct.indexOf(10);
    expect(c.avertedP10[i]).toBeLessThanOrEqual(c.averted[i]);
    expect(c.avertedP90[i]).toBeGreaterThanOrEqual(c.averted[i]);
  });
});
