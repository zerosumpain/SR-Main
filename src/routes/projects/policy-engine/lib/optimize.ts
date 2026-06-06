// optimize.ts — greedy budget-constrained allocator: maximise closure of the KS4
// disadvantage gap within a fixed cumulative-cost envelope (to the horizon). Self-contained.
//
// At each step it nudges the lever with the best marginal gap-reduction-per-£ that still
// fits the budget, until no affordable improving move remains. This is the classic greedy
// solution to a knapsack-style allocation; it is near-optimal for the smooth, diminishing-
// returns response surface this engine produces.

import type { LeverState } from './types';
import { runSim } from './engine';
import { LEVERS_BY_ID, baselineLevers } from './levers';

// Gap-relevant, costable levers the optimiser may spend on (excludes the age-ID bands,
// handled separately, and levers with no material gap channel).
export const GAP_CANDIDATES = [
  'attendance', 'breakfast', 'pupil_premium', 'fsm', 'poverty_action',
  'eypp', 'ey_quality', 'ey_access', 'reading', 'rise', 'teachers',
  'send_early', 'inclusion_fund', 'high_needs', 'post16_skills', 'mental_health',
  'curriculum', 'school_funding',
];

function metric(levers: LeverState, horizon: number): { gap: number; cost: number } {
  const y = runSim(levers).years.find((r) => r.year === horizon) ?? runSim(levers).years.at(-1)!;
  return { gap: y.gapKS4, cost: y.annualCost }; // budget = additional annual spend at the horizon
}

export interface OptimizeResult {
  levers: LeverState;
  gap: number;        // achieved KS4 gap at the horizon
  cost: number;       // additional annual spend used (£bn/yr)
  baselineGap: number;
  horizon: number;
  budget: number;
}

/** Greedily allocate up to `budgetBn` (additional £bn/yr at `horizon`) to minimise the KS4 gap. */
export function optimizeGapWithinBudget(budgetBn: number, horizon = 2040, candidates = GAP_CANDIDATES): OptimizeResult {
  let levers = baselineLevers();
  const baselineGap = metric(levers, horizon).gap;
  let cur = metric(levers, horizon);

  for (let iter = 0; iter < 80; iter++) {
    let best: { trial: LeverState; m: { gap: number; cost: number }; ratio: number } | null = null;
    for (const id of candidates) {
      const L = LEVERS_BY_ID[id];
      if (!L) continue;
      const v = levers[id] ?? L.baseline;
      if (v >= L.max) continue;
      // coarse step for speed, snapped to a multiple of the lever's own step grid
      const step = Math.max(L.step, Math.round((L.max - L.min) / 12 / L.step) * L.step);
      const nv = Math.min(L.max, v + step);
      const trial = { ...levers, [id]: nv };
      const m = metric(trial, horizon);
      if (m.cost > budgetBn + 1e-9) continue;      // over budget → reject
      const dGap = cur.gap - m.gap;                 // positive = gap closed
      if (dGap <= 1e-4) continue;                   // no/negative improvement → skip
      const dCost = Math.max(m.cost - cur.cost, 0.01);
      const ratio = dGap / dCost;                   // months closed per £bn
      if (!best || ratio > best.ratio) best = { trial, m, ratio };
    }
    if (!best) break;
    levers = best.trial;
    cur = best.m;
  }
  return { levers, gap: cur.gap, cost: cur.cost, baselineGap, horizon, budget: budgetBn };
}
