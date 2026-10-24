// WP2b's five month steps running together for years of game time on the
// golden fixtures (upstream packages scripted from the tiles): people are
// conserved every month (the driver's invariant check would revert and alert
// otherwise), every star, meter and share stays in range, the run is
// deterministic, and reviving the stored JSON mid-run changes nothing.

import { describe, expect, it } from 'vitest';
import { FIXTURE_KINDS, fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths, scriptedSteps } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { stateHash } from './index';
import { checkTown } from './invariants';
import type { CountyState } from './types';

const MONTHS = { hamlet: 240, town: 120, metropolis: 48 } as const;
const steps = scriptedSteps({
  coverage: { eduQ: [0.8, 0.6, 0.2], libraryShare: 0.4, healthCap: 1e5, healthCovered: 0.8, healthQuality: 0.9, town: [50, 50, 50, 50, 50, 40, 40, 30] },
  fields: { safety: 65 },
});

describe('the people model over years of game time', () => {
  it.each(FIXTURE_KINDS)('%s: conserved, in range and alert-free every month', (kind) => {
    const f = fixture(kind);
    const t = f.county.towns[f.town];
    let lastPop = population(t);
    runMonths(f.county, f.town, MONTHS[kind], steps, (k, d) => {
      expect(t.alerts, `month ${k}`).toEqual([]);
      expect(checkTown(t)).toEqual([]);
      const st = d.stars!;
      expect(st.actual.every((x) => x >= 0 && x <= 100)).toBe(true);
      expect(st.uHappy.every(Number.isFinite)).toBe(true);
      expect(d.needs!.cohort.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(t.meters.slice(0, 3).every((x) => x >= -100 && x <= 100)).toBe(true);
      expect(d.housing!.afford.every((x) => x >= 0 && x <= 100)).toBe(true);
      // The monthly caps hold (founders' carts are WP2e's and do not run here).
      const n = population(t);
      expect(n - lastPop).toBeLessThanOrEqual(Math.floor(0.06 * lastPop) + 60); // + a month of births
      expect(lastPop - n).toBeLessThanOrEqual(Math.floor(0.03 * lastPop) + 60); // + a month of deaths
      lastPop = n;
    });
    expect(population(t)).toBeGreaterThan(0);
  });

  it('is deterministic, and a revive mid-run (JSON round trip) continues identically', () => {
    const run = (revive: boolean) => {
      const f = fixture('town');
      let c: CountyState = f.county;
      runMonths(c, f.town, 30, steps);
      if (revive) c = JSON.parse(JSON.stringify(c)) as CountyState;
      runMonths(c, f.town, 30, steps);
      return stateHash(c.towns[f.town]);
    };
    const a = run(false);
    expect(run(false)).toBe(a);
    expect(run(true)).toBe(a);
  });
});
