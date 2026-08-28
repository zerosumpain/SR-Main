// engine.earlyyears.test.ts — the below-age-5 extension: the development gap at age 3
// (gapAge3) and early-education take-up (eyTakeUp / eyTakeUpAll). The extension must be
// PARITY-SAFE (2025 reproduces the baseline exactly) and respond to the right levers.

import { describe, it, expect } from 'vitest';
import { runSim } from '$lib/policy-engine/engine';
import { baselineLevers, LEVERS_BY_ID } from '$lib/policy-engine/levers';
import { BASELINE } from '$lib/policy-engine/params';

const at = (years: ReturnType<typeof runSim>['years'], y: number) => years.find((r) => r.year === y)!;
const maxed = (base: Record<string, number>, id: string) => ({ ...base, [id]: LEVERS_BY_ID[id].max });

describe('Early years (below age 5) extension', () => {
  it('reproduces the 2025 baseline exactly (parity-safe)', () => {
    const y0 = at(runSim(baselineLevers()).years, 2025);
    expect(y0.gapAge3).toBeCloseTo(BASELINE.gapAge3, 6);
    // take-up at baseline: disadvantaged tracks the ey_access baseline; all near-universal
    expect(y0.eyTakeUp).toBeCloseTo(LEVERS_BY_ID['ey_access'].baseline, 6);
    expect(y0.eyTakeUpAll).toBeCloseTo(94, 6);
  });

  it('the age-3 gap sits below the age-5 gap (the gap grows 3 → 5)', () => {
    for (const y of runSim(baselineLevers()).years) {
      expect(y.gapAge3).toBeLessThan(y.gapReception);
      expect(y.gapAge3).toBeGreaterThan(0);
    }
  });

  it('early-years quality closes the age-3 gap', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const eyq = at(runSim(maxed(baselineLevers(), 'ey_quality')).years, 2035);
    expect(base.gapAge3 - eyq.gapAge3).toBeGreaterThan(0.3);
  });

  it('disadvantaged access raises disadvantaged take-up but barely moves the universal rate', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const acc = at(runSim(maxed(baselineLevers(), 'ey_access')).years, 2035);
    expect(acc.eyTakeUp - base.eyTakeUp).toBeGreaterThan(10);
    expect(acc.eyTakeUpAll - base.eyTakeUpAll).toBeLessThan(6);
  });

  it('the age-3 gap responds faster than the KS4 gap to early-years investment', () => {
    // by 2028 (3 years in), the EY effect should be visible at age 3 but barely at KS4 (11y lag)
    const base = runSim(baselineLevers()).years;
    const eyq = runSim(maxed(baselineLevers(), 'ey_quality')).years;
    const age3Move = at(base, 2028).gapAge3 - at(eyq, 2028).gapAge3;
    const ks4Move = at(base, 2028).gapKS4 - at(eyq, 2028).gapKS4;
    expect(age3Move).toBeGreaterThan(ks4Move);
  });
});
