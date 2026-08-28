// tracking/projection.ts — read the model's projected value for a tracked indicator,
// under BOTH the status-quo (all-baseline) and announced-policy (all-policy) scenarios.
// This is the comparator reality is judged against on the /monitor page.

import { runSim } from '../engine';
import { baselineLevers, policyLevers } from '../levers';
import type { SimResult } from '../types';
import type { IndicatorSpec } from './types';

export interface ProjectionSims {
  baseSim: SimResult;   // status quo — every lever at its `baseline`
  policySim: SimResult; // announced policy — every lever at its `policy`
}

/** Run the engine once per scenario; reuse the result across all indicators. */
export function buildProjectionSims(): ProjectionSims {
  return {
    baseSim: runSim(baselineLevers()),
    policySim: runSim(policyLevers()),
  };
}

/** The model's projected value for one indicator in a given calendar year (or null). */
export function projectedValue(spec: IndicatorSpec, sim: SimResult, year: number): number | null {
  if (!spec.projection) return null;
  const yr = sim.years.find((y) => y.year === year);
  if (!yr) return null;
  const v = spec.projection(yr);
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Both comparators for one indicator/year. */
export function dualProjections(
  spec: IndicatorSpec,
  year: number,
  sims: ProjectionSims,
): { baseline: number | null; policy: number | null } {
  return {
    baseline: projectedValue(spec, sims.baseSim, year),
    policy: projectedValue(spec, sims.policySim, year),
  };
}
