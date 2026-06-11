import { describe, it, expect } from 'vitest';
import { buildProjectionSims, projectedValue, dualProjections } from './projection';
import { INDICATORS_BY_KEY } from './registry';
import { BASELINE, BASE_YEAR } from '../params';

const sims = buildProjectionSims();

describe('projection mechanism', () => {
  it('reproduces the 2025 baseline anchor for both scenarios at BASE_YEAR', () => {
    const a8 = INDICATORS_BY_KEY['attainment8'];
    expect(projectedValue(a8, sims.baseSim, BASE_YEAR)).toBeCloseTo(BASELINE.attainment8, 3);
    expect(projectedValue(a8, sims.policySim, BASE_YEAR)).toBeCloseTo(BASELINE.attainment8, 3);
  });

  it('returns null when the year is not in the simulation', () => {
    const a8 = INDICATORS_BY_KEY['attainment8'];
    expect(projectedValue(a8, sims.baseSim, 1990)).toBeNull();
  });

  it('returns null for an observed-only indicator with no projection fn', () => {
    const wb = INDICATORS_BY_KEY['gdpPerCapitaUK'];
    expect(projectedValue(wb, sims.baseSim, BASE_YEAR)).toBeNull();
  });

  it('computes a derived projection (A8 gap = total − disadvantaged)', () => {
    const gap = INDICATORS_BY_KEY['a8Gap'];
    const v = projectedValue(gap, sims.baseSim, BASE_YEAR);
    expect(v).toBeCloseTo(BASELINE.attainment8 - BASELINE.attainment8Dis, 3);
  });

  it('diverges by the horizon: announced policy beats status quo in the good direction', () => {
    const a8 = INDICATORS_BY_KEY['attainment8'];
    const pa = INDICATORS_BY_KEY['persistentAbsence'];
    const year = 2035;
    // attainment higher-is-better → policy should be >= baseline
    expect(projectedValue(a8, sims.policySim, year)!).toBeGreaterThan(projectedValue(a8, sims.baseSim, year)!);
    // absence lower-is-better → policy should be <= baseline
    expect(projectedValue(pa, sims.policySim, year)!).toBeLessThan(projectedValue(pa, sims.baseSim, year)!);
  });

  it('dualProjections returns both scenarios keyed', () => {
    const a8 = INDICATORS_BY_KEY['attainment8'];
    const d = dualProjections(a8, BASE_YEAR, sims);
    expect(d.baseline).toBeCloseTo(BASELINE.attainment8, 3);
    expect(d.policy).toBeCloseTo(BASELINE.attainment8, 3);
  });
});
