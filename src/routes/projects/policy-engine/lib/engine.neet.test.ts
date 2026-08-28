// engine.neet.test.ts — the 3-segment NEET stock + evidence pipeline (Phase C of the
// 2026-06-10 realignment). Segments must sum to the headline, reproduce the 2025
// composition, and respond to the RIGHT levers (mental health → health segment;
// youth guarantee → unemployed segment; upstream absence → pipeline).

import { describe, it, expect } from 'vitest';
import { runSim } from '$lib/policy-engine/engine';
import { baselineLevers, policyLevers, LEVERS_BY_ID } from '$lib/policy-engine/levers';
import { BASELINE } from '$lib/policy-engine/params';
import { PRESETS } from './scenarios';

const at = (years: ReturnType<typeof runSim>['years'], y: number) => years.find((r) => r.year === y)!;
const maxed = (base: Record<string, number>, id: string) => ({ ...base, [id]: LEVERS_BY_ID[id].max });

describe('NEET segments', () => {
  it('segments sum to the headline in every year', () => {
    for (const levers of [baselineLevers(), policyLevers()]) {
      for (const y of runSim(levers).years) {
        expect(y.neetUnemployed + y.neetInactiveHealth + y.neetInactiveOther).toBeCloseTo(y.neet, 6);
      }
    }
  });

  it('reproduces the 2025 baseline composition', () => {
    const y0 = at(runSim(baselineLevers()).years, 2025);
    expect(y0.neet).toBeCloseTo(BASELINE.neet, 6);
    expect(y0.neetUnemployed).toBeCloseTo(BASELINE.neetUnemployed, 6);
    expect(y0.neetInactiveHealth).toBeCloseTo(BASELINE.neetInactiveHealth, 6);
    expect(y0.neetInactiveOther).toBeCloseTo(BASELINE.neetInactiveOther, 6);
  });

  it('mental health acts on the health segment, youth guarantee on the unemployed segment', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const mh = at(runSim(maxed(baselineLevers(), 'mental_health')).years, 2035);
    const yg = at(runSim(maxed(baselineLevers(), 'youth_guarantee')).years, 2035);
    expect(base.neetInactiveHealth - mh.neetInactiveHealth)
      .toBeGreaterThan(base.neetUnemployed - mh.neetUnemployed);
    expect(base.neetUnemployed - yg.neetUnemployed).toBeGreaterThan(0.3);
    expect(Math.abs(base.neetInactiveHealth - yg.neetInactiveHealth)).toBeLessThan(0.05);
  });

  it('worse upstream absence raises NEET via the pipeline', () => {
    const worse = maxed(baselineLevers(), 'housing_instability'); // raises disadvantaged PA
    expect(at(runSim(worse).years, 2035).neet)
      .toBeGreaterThan(at(runSim(baselineLevers()).years, 2035).neet);
  });

  it('new levers carry cost', () => {
    for (const id of ['youth_guarantee', 'careers_gatsby', 'apprenticeships', 'post16_premium', 'entry_level']) {
      const sim = runSim(maxed(baselineLevers(), id));
      expect(at(sim.years, 2030).cumulativeCost).toBeGreaterThan(0);
    }
  });

  it('entry_level acts on the unemployed segment, lightly on "other", and NOT on health', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const el = at(runSim(maxed(baselineLevers(), 'entry_level')).years, 2035);
    const dU = base.neetUnemployed - el.neetUnemployed;
    const dIO = base.neetInactiveOther - el.neetInactiveOther;
    const dIH = base.neetInactiveHealth - el.neetInactiveHealth;
    expect(dU).toBeGreaterThan(0.2);                 // demand-side cuts unemployed-NEET inflow
    expect(dIO).toBeGreaterThan(0);                  // the "Saturday job ladder" helps the discouraged a little
    expect(dIO).toBeLessThan(dU);                    // ...but less than the unemployed segment
    expect(Math.abs(dIH)).toBeLessThan(0.05);        // a vacancy does not fix a health condition
  });

  it('entry_level cuts unemployed persistence (long-term share falls)', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const el = at(runSim(maxed(baselineLevers(), 'entry_level')).years, 2035);
    expect(el.neetLongTerm / el.neet).toBeLessThan(base.neetLongTerm / base.neet);
  });
});

describe('NEET persistence (long-term stock)', () => {
  it('long-term NEET is positive and below the headline in every year', () => {
    for (const levers of [baselineLevers(), policyLevers()]) {
      for (const y of runSim(levers).years) {
        expect(y.neetLongTerm).toBeGreaterThan(0);
        expect(y.neetLongTerm).toBeLessThan(y.neet);
      }
    }
  });

  it('at the 2025 baseline, roughly 55–65% of the stock is long-term', () => {
    const y0 = at(runSim(baselineLevers()).years, 2025);
    const share = y0.neetLongTerm / y0.neet;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.65);
  });

  it('the youth guarantee cuts persistence: long-term NEET falls by more than its flow effect alone', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const yg = at(runSim(maxed(baselineLevers(), 'youth_guarantee')).years, 2035);
    // LT share of the stock falls (re-engagement of the EXISTING stock, not just less inflow)
    expect(yg.neetLongTerm / yg.neet).toBeLessThan(base.neetLongTerm / base.neet);
  });

  it('mental health reduces health-segment persistence (LT share falls)', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const mh = at(runSim(maxed(baselineLevers(), 'mental_health')).years, 2035);
    expect(mh.neetLongTerm / mh.neet).toBeLessThan(base.neetLongTerm / base.neet);
  });
});

describe('Milburn-aligned response preset', () => {
  it('is registered and projects lower NEET than announced policy', () => {
    const preset = PRESETS.find((p) => p.name === 'Milburn-aligned response');
    expect(preset).toBeDefined();
    const pol = at(runSim(policyLevers()).years, 2035);
    const milburn = at(runSim(preset!.levers).years, 2035);
    expect(milburn.neet).toBeLessThan(pol.neet);
  });
});
