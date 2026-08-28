// economics.ts — a LEO-calibrated MONETISATION layer. The DfE's Longitudinal Educational
// Outcomes (LEO) data links school attainment to adult earnings, which lets us turn the engine's
// modelled attainment change into an estimated lifetime-earnings and exchequer impact — the
// dimension policymakers actually respond to. A deterministic post-processor over the existing
// sim/baseSim; NO new dynamics. Self-contained.
//
// HONESTY (this is associational, NOT RCT-grade causal — display prominently):
//  • Earnings-by-attainment figures conflate the causal effect of education with the fact that
//    higher-attaining people would earn more anyway (selection bias). DfE uses these for appraisal,
//    but they are estimates with rich controls, not experiments.
//  • To avoid DOUBLE-COUNTING, we monetise ONE primary channel — attainment → earnings — and do
//    NOT separately add a NEET wage-scar (the engine already routes attainment → NEET).
//  • The per-grade/per-SD constant comes from 2002–2005 GCSE cohorts; future labour markets may differ.

import type { YearResult } from '$lib/policy-engine/types';
import { POP } from '$lib/policy-engine/params';

const M = 1e6;

// Calibration constants — present value, ~2024 prices, HM Treasury Green Book discounting.
export const ECON = {
  // £ PV of adult lifetime earnings per +1 Attainment-8 POINT, per pupil. Derived from the DfE
  // estimate of ~£100k PV per 1-SD attainment improvement (£96k–£115k), with a pupil-level
  // Attainment-8 SD of ~19 points → ~£5,300/point. [DfE "GCSE Attainment and Lifetime Earnings" 2021;
  // DfE "Impact of school absence on lifetime earnings" 2025]
  pvPerA8Point: 5300,
  a8Sd: 19,
  pv1SdRange: [96_000, 115_000] as [number, number],
  // share of an earnings gain that returns to the exchequer (income tax + employee+employer NICs, broad) [HMT]
  taxWedge: 0.32,
  // youth-unemployment wage scar (mid-career), for context only — NOT added (avoids double-count) [Gregg & Tominey]
  neetScarRange: [0.13, 0.21] as [number, number],
  // £ PV lifetime-earnings loss per day of school absence [DfE 2025] — shown as context
  pvPerAbsenceDay: 150,
};

// NEET economics — CONTEXT figures, never added to the headline LEO PV (part of any
// NEET reduction is attainment-driven and therefore already monetised above; adding a
// lifetime scar on top would double-count). Two anchors, used as a LOW–HIGH range:
//  • Coles et al. (2010, University of York, for the Audit Commission): lifetime
//    public-finance cost ~£56k / resource cost ~£104k per NEET young person (2010 prices).
//  • Milburn interim review (2026): lifetime earnings loss up to £300k per person —
//    an upper bound; the £125bn/yr aggregate is quoted in prose only, flagged contested.
export const NEET_ECON = {
  perPersonLifetimeLow: 104_000,
  perPersonLifetimeHigh: 300_000,
  source: 'Coles et al. (2010, University of York); Milburn interim review (2026)',
};

/** Headcount of 16–24s out of NEET at a horizon, from a pp-of-rate reduction. */
export function neetHeadcountAvoided(ppReduction: number, scale = 1): number {
  return Math.max(0, ppReduction / 100) * POP.youth16to24 * M * scale;
}

/** Cumulative NEET-years avoided vs a comparator, summed across projection years. */
export function neetYearsAvoided(sim: YearResult[], base: YearResult[], horizon: number, scale = 1): number {
  let total = 0;
  for (const r of sim) {
    if (!r.isProjection || r.year > horizon) continue;
    const b = base.find((x) => x.year === r.year);
    if (!b) continue;
    total += Math.max(0, (b.neet - r.neet) / 100) * POP.youth16to24 * M * scale;
  }
  return total;
}

export interface EconomicImpact {
  cohorts: number;          // number of leaving cohorts 2026..horizon
  lifetimePV: number;       // £ PV total lifetime-earnings gain (all pupils, all cohorts) vs status quo
  disLifetimePV: number;    // £ PV of that accruing to disadvantaged pupils
  exchequerPV: number;      // £ PV returning to the exchequer
  perPupilPV: number;       // £ PV per pupil (avg across cohorts)
  a8DeltaAtHorizon: number; // the Attainment-8 lift at the horizon (for the caveat)
}

/** Monetise the attainment gain of a scenario vs its comparator, summed over the leaving
 *  cohorts. `wageFactor` re-bases the per-point PV onto a region's wage level (see
 *  regions.regionEarnings) — a crude but honest adjustment: regional A8 points feed
 *  regional wage distributions. */
export function economicImpact(sim: YearResult[], base: YearResult[], horizon: number, scale = 1, wageFactor = 1): EconomicImpact {
  const cohort = POP.cohortYearGroup * M * scale;
  const disCohort = cohort * POP.disadvShare;
  const pvPerPoint = ECON.pvPerA8Point * wageFactor;
  const start = sim[0].year;
  let lifetime = 0, dis = 0, cohorts = 0, a8DeltaH = 0;
  for (const r of sim) {
    if (r.year <= start || r.year > horizon) continue;
    const b = base.find((x) => x.year === r.year);
    if (!b) continue;
    cohorts++;
    const dA8 = r.attainment8 - b.attainment8;
    const dA8dis = r.attainment8Dis - b.attainment8Dis;
    lifetime += dA8 * pvPerPoint * cohort;
    dis += dA8dis * pvPerPoint * disCohort;
    if (r.year === horizon) a8DeltaH = dA8;
  }
  return {
    cohorts,
    lifetimePV: lifetime,
    disLifetimePV: dis,
    exchequerPV: lifetime * ECON.taxWedge,
    perPupilPV: cohorts > 0 ? lifetime / (cohort * cohorts) : 0,
    a8DeltaAtHorizon: a8DeltaH,
  };
}
