// engine.trace.test.ts — the "show your working" trace must be FAITHFUL: for every traced
// outcome, base + Σ terms must reconcile to the engine's own published value, and that value
// must equal the corresponding YearResult field. This is what lets the Method page show a
// provable "= the engine's value ✓" check.

import { describe, it, expect } from 'vitest';
import { runSim } from './engine';
import { baselineLevers, policyLevers } from './levers';

const TRACED = [
  'gapKS4', 'gapKS2', 'gapReception', 'gapAge3',
  'attainment8', 'attainment8Dis', 'grade5EM', 'ks2RWM', 'gld',
  'persistentAbsenceDis', 'childPoverty', 'fundingPerPupil',
  'highNeedsDeficitStock', 'neet',
];

describe('calculation trace fidelity', () => {
  const cases: Array<[string, ReturnType<typeof baselineLevers>]> = [['baseline', baselineLevers()], ['policy', policyLevers()]];
  for (const [name, levers] of cases) {
    for (const year of [2030, 2035, 2040]) {
      it(`trace reconciles to the engine at ${year} (${name})`, () => {
        const sim = runSim(levers, { trace: year });
        expect(sim.trace).toBeTruthy();
        expect(sim.trace!.year).toBe(year);
        const row = sim.years.find((y) => y.year === year)!;
        for (const key of TRACED) {
          const t = sim.trace!.outcomes[key];
          expect(t, `trace present for ${key}`).toBeTruthy();
          // base + Σ terms = the engine's published value (within clamp)
          const summed = t.base + t.terms.reduce((s, term) => s + term.value, 0);
          expect(summed).toBeCloseTo(t.result, 6);
          if (!t.clamped) expect(t.result).toBeCloseTo(t.engineValue, 6);
          // the traced engineValue equals the actual YearResult field
          expect(t.engineValue).toBeCloseTo((row as any)[key], 6);
          // per-lever parts (where present) sum to their term
          for (const term of t.terms) {
            if (term.parts) {
              const p = term.parts.reduce((s, x) => s + x.value, 0);
              expect(p).toBeCloseTo(term.value, 4);
            }
          }
        }
      });
    }
  }

  it('trace is absent when not requested (zero overhead path)', () => {
    expect(runSim(policyLevers()).trace).toBeUndefined();
  });
});
