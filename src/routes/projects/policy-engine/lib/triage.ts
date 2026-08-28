// triage.ts — a SYNTHETIC Year-11 cohort triage model, calibrated to PUBLISHED relative
// risks (DfE "Risk factors for becoming NEET", May 2026; Impetus Youth Jobs Gap
// compound-disadvantage analysis; NatCen/YFF RONI research). It demonstrates the
// recall / precision / caseload trade-off of risk flagging — the central strategic
// question of any early-warning system. ASSOCIATIONAL multipliers on an APPROXIMATED
// overlap structure: a strategy demonstrator, NOT a deployable tool. Self-contained.

import type { Band } from '$lib/policy-engine/params';
import { band } from '$lib/policy-engine/params';
import { mulberry32, triangular } from './montecarlo';

export const COHORT_SIZE = 600_000;       // one England year group
export const COHORT_BASE_RATE = 0.12;     // P(NEET at 17–19) for the cohort [DfE risk-factors May 2026]
export const LA_COUNT = 153;              // upper-tier LAs sharing the caseload

export interface Stratum {
  id: string;
  label: string;
  eli5: string;
  /** fraction of the cohort — strata are MUTUALLY EXCLUSIVE (overlaps resolved into
   *  compound strata, approximated from published cross-tabs) */
  share: number;
  /** relative risk vs the cohort average; null = the no-marker residual (computed) */
  rr: Band | null;
  /** unweighted RONI-style points — drives the checklist ordering (deliberately
   *  cruder than true risk: every marker scores the same regardless of its RR) */
  checklistPoints: number;
}

// Shares and relative-risks must jointly reproduce the cohort base rate (Σ share·rr = 1):
// published RRs are typically quoted vs the NON-marker group, which overstates them vs
// the cohort average — these are the vs-average equivalents, with the residual solved.
export const STRATA: Stratum[] = [
  { id: 'compound', label: 'FSM + SEN support + low attainment', eli5: 'Poor, extra needs and low grades', share: 0.040, rr: band(2.4, 2.8, 3.2), checklistPoints: 4 },
  { id: 'care',     label: 'Care experience',                    eli5: 'Grew up in care',                  share: 0.010, rr: band(2.5, 3.0, 3.5), checklistPoints: 3 },
  { id: 'pa_fsm',   label: 'Persistent absence + FSM',           eli5: 'Poor and missing lots of school',  share: 0.050, rr: band(2.2, 2.6, 3.0), checklistPoints: 3 },
  { id: 'ehcp',     label: 'EHCP',                               eli5: 'Has a legal special-needs plan',   share: 0.035, rr: band(2.3, 2.7, 3.1), checklistPoints: 2 },
  { id: 'pa',       label: 'Persistent absence only',            eli5: 'Missing lots of school',           share: 0.070, rr: band(1.8, 2.1, 2.5), checklistPoints: 1 },
  { id: 'lowatt',   label: 'Below Level 2 only',                 eli5: 'Low grades only',                  share: 0.080, rr: band(1.5, 1.8, 2.1), checklistPoints: 1 },
  { id: 'fsm',      label: 'FSM only',                           eli5: 'From a poor family only',          share: 0.100, rr: band(1.3, 1.5, 1.8), checklistPoints: 1 },
  { id: 'none',     label: 'No flagged risk markers',            eli5: 'No warning signs on record',       share: 0.615, rr: null,                  checklistPoints: 0 },
];

type SampleFn = (b: Band) => number;
const central: SampleFn = (b) => b.central;

/** RR of the no-marker residual stratum, solved so Σ share·rr = 1 exactly. */
export function residualRR(sample: SampleFn = central): number {
  let flagged = 0, flaggedShare = 0;
  for (const s of STRATA) {
    if (!s.rr) continue;
    flagged += s.share * sample(s.rr);
    flaggedShare += s.share;
  }
  const noneShare = 1 - flaggedShare;
  return Math.max(0.05, (1 - flagged) / noneShare);
}

export type TriageMode = 'checklist' | 'weighted';

function orderStrata(mode: TriageMode, rrOf: (s: Stratum) => number): Stratum[] {
  const arr = [...STRATA];
  if (mode === 'weighted') return arr.sort((a, b) => rrOf(b) - rrOf(a));
  // checklist: points first; within a points tie, bigger groups first (a caseload
  // heuristic real checklists effectively apply) — which misorders vs true risk
  return arr.sort((a, b) => b.checklistPoints - a.checklistPoints || b.share - a.share);
}

export interface TriagePoint {
  recall: number;          // share of future NEETs captured by the flag list
  precision: number;       // share of the flag list who become NEET
  flagged: number;         // headcount flagged
  falsePerTrue: number;    // false positives per true positive
  caseloadPerLA: number;   // flagged headcount / 153 LAs
}

/** Operating point at a given flag budget (% of the cohort), walking strata in the
 *  mode's order and taking a linear fraction of the marginal stratum. */
export function triageAt(flagPct: number, mode: TriageMode, sample: SampleFn = central): TriagePoint {
  const none = residualRR(sample);
  const rrOf = (s: Stratum) => (s.rr ? sample(s.rr) : none);
  let budget = Math.min(100, Math.max(0, flagPct)) / 100;
  let capturedRisk = 0;   // Σ flagged share·rr  (denominator: Σ all share·rr = 1)
  let flaggedShare = 0;
  for (const s of orderStrata(mode, rrOf)) {
    if (budget <= 0) break;
    const take = Math.min(s.share, budget);
    capturedRisk += take * rrOf(s);
    flaggedShare += take;
    budget -= take;
  }
  const recall = capturedRisk;                                   // ÷ 1
  const precision = flaggedShare > 0 ? COHORT_BASE_RATE * (capturedRisk / flaggedShare) : 0;
  const flagged = flaggedShare * COHORT_SIZE;
  return {
    recall, precision, flagged,
    falsePerTrue: precision > 0 ? (1 - precision) / precision : Infinity,
    caseloadPerLA: flagged / LA_COUNT,
  };
}

export interface TriageCurve {
  flagPct: number[];
  recall: number[]; recallP10: number[]; recallP90: number[];
  precision: number[]; precisionP10: number[]; precisionP90: number[];
}

const FLAG_RANGE = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40%

function pct(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/** Full operating curve with P10–P90 bands from sampling every stratum's RR band. */
export function triageCurve(mode: TriageMode, draws = 200, seed = 7): TriageCurve {
  const recall: number[] = [], precision: number[] = [];
  const rDraws: number[][] = FLAG_RANGE.map(() => []);
  const pDraws: number[][] = FLAG_RANGE.map(() => []);
  for (const [i, f] of FLAG_RANGE.entries()) {
    const c = triageAt(f, mode);
    recall.push(c.recall);
    precision.push(c.precision);
    void i;
  }
  for (let d = 0; d < draws; d++) {
    const rng = mulberry32(seed + d * 2654435761);
    const sample: SampleFn = (b) => triangular(rng, b.low, b.central, b.high);
    // one sampled world per draw: cache so every flagPct shares the same sampled RRs
    const cache = new Map<Band, number>();
    const worldSample: SampleFn = (b) => {
      let v = cache.get(b);
      if (v === undefined) { v = sample(b); cache.set(b, v); }
      return v;
    };
    FLAG_RANGE.forEach((f, i) => {
      const p = triageAt(f, mode, worldSample);
      rDraws[i].push(p.recall);
      pDraws[i].push(p.precision);
    });
  }
  return {
    flagPct: FLAG_RANGE,
    recall,
    recallP10: rDraws.map((a) => pct([...a].sort((x, y) => x - y), 10)),
    recallP90: rDraws.map((a) => pct([...a].sort((x, y) => x - y), 90)),
    precision,
    precisionP10: pDraws.map((a) => pct([...a].sort((x, y) => x - y), 10)),
    precisionP90: pDraws.map((a) => pct([...a].sort((x, y) => x - y), 90)),
  };
}
