// uplift.ts — the uplift-targeting demonstrator: the sequel to the triage simulator.
// Risk scoring answers "who is most likely to become NEET?"; uplift modelling answers
// "who would a programme actually HELP?" — and they are different young people.
//
// The uplift bands here are ILLUSTRATIVE-BY-NECESSITY: no UK estimates of per-group
// NEET-programme treatment effects exist, because nobody has linked an RCT portfolio
// (Youth Futures Foundation has one) to LEO outcomes. That gap is the point of the
// exhibit. The qualitative SHAPE is evidence-based: multi-barrier and health-driven
// groups respond least to employment-side programmes (the barrier isn't job-search);
// single-barrier groups in the middle of the risk distribution respond most; low-risk
// groups have little headroom. [Davis & Heller causal-forest summer-jobs analyses;
// YFF toolkit; Milburn 8-in-10 health-segment stickiness]
// Shares & relative risks come from triage.ts (same synthetic cohort). Self-contained.

import type { Band } from './params';
import { band } from './params';
import { STRATA, residualRR, COHORT_SIZE, COHORT_BASE_RATE } from './triage';
import { mulberry32, triangular } from './montecarlo';

/** Absolute pp reduction in P(NEET at 17–19) if treated with a keyworker-style
 *  programme, per stratum. Note the deliberate mismatch with relative risk. */
export const UPLIFT: Record<string, Band> = {
  compound: band(0.010, 0.030, 0.050), // highest risk, LOW uplift — multiple barriers, programme addresses one
  care:     band(0.010, 0.030, 0.060), // high risk, low-moderate uplift
  pa_fsm:   band(0.050, 0.090, 0.130), // high risk AND highly responsive — the sweet spot risk-ranking part-misses
  ehcp:     band(0.010, 0.030, 0.050), // the barrier is provision/health, not job-search
  pa:       band(0.040, 0.080, 0.120), // responsive: re-engagement addresses the actual barrier
  lowatt:   band(0.030, 0.060, 0.090),
  fsm:      band(0.020, 0.050, 0.080),
  none:     band(0.005, 0.010, 0.020), // little headroom: base risk is already low
};

type SampleFn = (b: Band) => number;
const central: SampleFn = (b) => b.central;

export type UpliftStrategy = 'risk' | 'uplift';

export interface UpliftPoint {
  averted: number;     // headcount of NEET outcomes averted
  treated: number;     // headcount treated
  perTreated: number;  // averted per 1,000 treated
}

/** Treat the top `budgetPct`% of the cohort, ranked by the strategy; count averted. */
export function upliftAt(budgetPct: number, strategy: UpliftStrategy, sample: SampleFn = central): UpliftPoint {
  const none = residualRR(sample);
  const rrOf = (id: string) => { const s = STRATA.find((x) => x.id === id)!; return s.rr ? sample(s.rr) : none; };
  const upOf = (id: string) => sample(UPLIFT[id]);
  const order = [...STRATA].sort((a, b) =>
    strategy === 'risk' ? rrOf(b.id) - rrOf(a.id) : upOf(b.id) - upOf(a.id));
  let budget = Math.min(100, Math.max(0, budgetPct)) / 100;
  let averted = 0, treatedShare = 0;
  for (const s of order) {
    if (budget <= 0) break;
    const take = Math.min(s.share, budget);
    // uplift can't avert more than the group's actual NEET probability
    averted += take * Math.min(upOf(s.id), rrOf(s.id) * COHORT_BASE_RATE) * COHORT_SIZE;
    treatedShare += take;
    budget -= take;
  }
  const treated = treatedShare * COHORT_SIZE;
  return { averted, treated, perTreated: treated > 0 ? (averted / treated) * 1000 : 0 };
}

export interface UpliftCurve {
  budgetPct: number[];
  averted: number[]; avertedP10: number[]; avertedP90: number[];
}

const BUDGET_RANGE = Array.from({ length: 40 }, (_, i) => i + 1);

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/** Averted-vs-budget curve with P10–P90 from sampling risk AND uplift bands. */
export function upliftCurve(strategy: UpliftStrategy, draws = 200, seed = 11): UpliftCurve {
  const averted = BUDGET_RANGE.map((b) => upliftAt(b, strategy).averted);
  const drawsAt: number[][] = BUDGET_RANGE.map(() => []);
  for (let d = 0; d < draws; d++) {
    const rng = mulberry32(seed + d * 2654435761);
    const cache = new Map<Band, number>();
    const worldSample: SampleFn = (b) => {
      let v = cache.get(b);
      if (v === undefined) { v = triangular(rng, b.low, b.central, b.high); cache.set(b, v); }
      return v;
    };
    BUDGET_RANGE.forEach((b, i) => drawsAt[i].push(upliftAt(b, strategy, worldSample).averted));
  }
  return {
    budgetPct: BUDGET_RANGE,
    averted,
    avertedP10: drawsAt.map((a) => pct([...a].sort((x, y) => x - y), 10)),
    avertedP90: drawsAt.map((a) => pct([...a].sort((x, y) => x - y), 90)),
  };
}
