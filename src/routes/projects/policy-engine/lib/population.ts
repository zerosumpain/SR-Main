// population.ts — the "population simulation" layer. Translates the engine's PERIOD RATES
// (percentages per year) into HEADCOUNTS of real children & young people and a synthetic-
// cohort pipeline, so the human scale of a policy package is legible. Pure-derive over the
// existing `sim` (your scenario) and `baseSim` (status-quo) SimResults already held by the
// page — NO engine changes, recomputes live as sliders move. Self-contained.
//
// HONESTY DISCIPLINE (enforced throughout; see the calibration footer in PopulationPanel):
//  • Each rate has its OWN correct denominator — child poverty over the 0-17 child population,
//    NEET over the 16-24 population, persistent absence over school pupils, disadvantaged-PA
//    over the disadvantaged sub-population. Mixing them is the classic ×N mis-scaling trap.
//  • EHCP is ALREADY a headcount in YearResult (ehcpCount) — consumed verbatim, never re-derived.
//  • The pipeline is a SYNTHETIC PERIOD COHORT: one notional year-group run through a single
//    year's age-5/11/16 rates — not a longitudinally tracked birth cohort. Labelled as such.
//  • STOCKS (poverty, NEET, PA, EHCP) are point-in-time; a child can be in several at once, so
//    they are NEVER summed into a "total children affected". FLOWS (cohort gates) are passed once
//    per cohort, so only they carry a cumulative tally (labelled child-cohort-years).
//  • Sign is keyed to OUTCOMES_BY_ID[id].goodIfUp, so "fewer NEET"/"fewer in poverty" read as good.

import type { YearResult } from './types';
import { POP } from './params';
import { OUTCOMES_BY_ID } from './outcomes';

const M = 1e6;
export const COHORT_N = Math.round(POP.cohortYearGroup * M);        // 600,000 — one synthetic year-group
export const DIS_COHORT_N = Math.round(COHORT_N * POP.disadvShare); // 162,000 — disadvantaged (FSM-Ever6) sub-cohort

const field = (r: YearResult, key: string): number => (r as any)[key] as number;
/** Rate (%) for a gate; the destination gate is "not NEET" = 100 − neet. */
function gateRate(r: YearResult, key: string): number {
  return key === '__notNeet' ? 100 - field(r, 'neet') : field(r, key);
}
const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

// --------------------------------------------------------------------------------------
// The synthetic-cohort pipeline: four life-stage "gates" a year-group passes through.
// Each gate is the engine's INDEPENDENT period rate (failing GLD does not bar KS2 — the
// engine models stage rates, not a literal river), so the funnel shows the SUCCESS STREAM
// thinning stage by stage, not children physically falling out.
// --------------------------------------------------------------------------------------
export interface Gate {
  key: string;
  label: string;   // station headline
  age: string;     // life stage
  rateAll: string; // all-pupils % field on YearResult
  rateDis: string; // disadvantaged % field (or '__notNeet' proxy)
  std: string;     // the standard being cleared
  proxy?: boolean; // destination: a 16-24 PERIOD rate on a DIFFERENT denominator, shown for context
}
export const GATES: Gate[] = [
  { key: 'gld',  label: 'School-ready',      age: 'age 5',  rateAll: 'gld',      rateDis: 'gldDis',      std: 'Good Level of Development' },
  { key: 'ks2',  label: 'Secondary-ready',   age: 'age 11', rateAll: 'ks2RWM',   rateDis: 'ks2RWMDis',   std: 'KS2 reading, writing & maths expected standard' },
  { key: 'gcse', label: 'Strong GCSE pass',  age: 'age 16', rateAll: 'grade5EM', rateDis: 'grade5EMDis', std: 'Grade 5+ in GCSE English & maths' },
  { key: 'dest', label: 'In education / work', age: '16–24', rateAll: '__notNeet', rateDis: '__notNeet', std: 'Not NEET (a 16–24 rate — shown for context, not a flow from this cohort)', proxy: true },
];

export interface GateState extends Gate {
  pctAll: number; pctDis: number;
  reach: number;      // all-pupils headcount clearing the standard (of COHORT_N)
  reachDis: number;   // disadvantaged headcount clearing (of DIS_COHORT_N); 0 for the proxy gate
  reachAdv: number;   // reach − reachDis (the non-disadvantaged sub-band)
  miss: number;       // COHORT_N − reach (below the standard)
  reachBase: number;  // status-quo all-pupils reach (the ghost high-water mark)
  reachDisBase: number;
  delta: number;      // reach − reachBase  (extra clearing because of the package)
  deltaDis: number;   // reachDis − reachDisBase
}

/** Per-gate headcounts for one horizon year, scenario vs status-quo. */
export function cohortPipeline(simRow: YearResult, baseRow: YearResult): GateState[] {
  return GATES.map((g) => {
    const pctAll = gateRate(simRow, g.rateAll);
    const pctDis = g.proxy ? pctAll : gateRate(simRow, g.rateDis);
    const reach = Math.round((pctAll / 100) * COHORT_N);
    const reachDis = g.proxy ? 0 : Math.round((pctDis / 100) * DIS_COHORT_N);
    const reachAdv = Math.max(0, reach - reachDis);
    const pctAllB = gateRate(baseRow, g.rateAll);
    const pctDisB = g.proxy ? pctAllB : gateRate(baseRow, g.rateDis);
    const reachBase = Math.round((pctAllB / 100) * COHORT_N);
    const reachDisBase = g.proxy ? 0 : Math.round((pctDisB / 100) * DIS_COHORT_N);
    return {
      ...g, pctAll, pctDis, reach, reachDis, reachAdv, miss: COHORT_N - reach,
      reachBase, reachDisBase, delta: reach - reachBase, deltaDis: reachDis - reachDisBase,
    };
  });
}

// --------------------------------------------------------------------------------------
// Headline numbers — all COHORT FLOWS (a child passes a gate once), so they are honest to
// state per-cohort and to translate into classrooms. Stocks (NEET/poverty) live in the ledger.
// --------------------------------------------------------------------------------------
export interface CohortHeadline {
  deltaGcse: number;       // extra strong-pass leavers (all) vs status quo, this cohort
  deltaGcseDis: number;    // extra disadvantaged strong-pass leavers
  deltaReady: number;      // extra children school-ready at 5 (= fewer "not ready")
  classrooms: number;      // deltaGcse / 30  (whole classrooms-worth)
}
export function cohortHeadline(simRow: YearResult, baseRow: YearResult): CohortHeadline {
  const d = (k: string, n: number) => Math.round(((field(simRow, k) - field(baseRow, k)) / 100) * n);
  const deltaGcse = d('grade5EM', COHORT_N);
  return {
    deltaGcse,
    deltaGcseDis: d('grade5EMDis', DIS_COHORT_N),
    deltaReady: d('gld', COHORT_N),
    classrooms: Math.round(Math.abs(deltaGcse) / 30) * Math.sign(deltaGcse),
  };
}

// --------------------------------------------------------------------------------------
// The impact ledger — people sentences. Each row is a point-in-time headcount at the
// horizon, with a good-signed delta vs status quo. Flow rows also carry a cumulative tally.
// --------------------------------------------------------------------------------------
export interface PeopleRow {
  key: string;
  label: string;
  scope: string;        // 'this cohort' | 'right now' — sets the reading register
  noun: string;         // pupils / children / young people
  count: number;        // scenario headcount (point in time at horizon)
  base: number;         // status-quo headcount
  rawDelta: number;     // count − base (display direction)
  goodDelta: number;    // good-signed (positive = better for people)
  isStock: boolean;     // true → cumulative summation barred (would double-count)
  neutral: boolean;     // EHCP — more isn't unambiguously good
  cumulative: number | null; // cohort-flow lifetime tally (flows only)
}

/** Cumulative good-signed flow across the projection years 2026..horizon (one fresh cohort/yr).
 *  A child passes a cohort gate once, so summing fresh cohorts year-on-year is legitimate. */
function cumFlow(sim: YearResult[], base: YearResult[], key: string, n: number, goodIfUp: boolean, horizon: number): number {
  const startYear = sim[0].year; // the base/anchor year (2025) — projection starts the year after
  let s = 0;
  for (const r of sim) {
    if (r.year <= startYear || r.year > horizon) continue; // projection years up to the horizon
    const b = base.find((x) => x.year === r.year);
    if (!b) continue;
    const dRate = goodIfUp ? field(r, key) - field(b, key) : field(b, key) - field(r, key);
    s += Math.round((dRate / 100) * n);
  }
  return s;
}

export function peopleLedger(sim: YearResult[], base: YearResult[], horizon: number): PeopleRow[] {
  const sH = row(sim, horizon), bH = row(base, horizon);
  const childPop = POP.childPop0to17 * M;
  const youth = POP.youth16to24 * M;
  const disPupils = POP.pupils * POP.disadvShare * M;

  const good = (id: string) => OUTCOMES_BY_ID[id]?.goodIfUp ?? true;
  const headRate = (r: YearResult, key: string, n: number) => Math.round((field(r, key) / 100) * n);

  const rows: PeopleRow[] = [];

  // 1 — disadvantaged strong-pass leavers (FLOW, cohort)
  rows.push({
    key: 'gcseDis', label: 'Disadvantaged pupils leaving with a strong GCSE pass', scope: 'this cohort', noun: 'pupils',
    count: headRate(sH, 'grade5EMDis', DIS_COHORT_N), base: headRate(bH, 'grade5EMDis', DIS_COHORT_N),
    rawDelta: headRate(sH, 'grade5EMDis', DIS_COHORT_N) - headRate(bH, 'grade5EMDis', DIS_COHORT_N),
    goodDelta: headRate(sH, 'grade5EMDis', DIS_COHORT_N) - headRate(bH, 'grade5EMDis', DIS_COHORT_N),
    isStock: false, neutral: false,
    cumulative: cumFlow(sim, base, 'grade5EMDis', DIS_COHORT_N, true, horizon),
  });
  // 2 — children school-ready at 5 (FLOW, cohort)
  rows.push({
    key: 'gld', label: 'Children reaching a Good Level of Development at age 5', scope: 'this cohort', noun: 'children',
    count: headRate(sH, 'gld', COHORT_N), base: headRate(bH, 'gld', COHORT_N),
    rawDelta: headRate(sH, 'gld', COHORT_N) - headRate(bH, 'gld', COHORT_N),
    goodDelta: headRate(sH, 'gld', COHORT_N) - headRate(bH, 'gld', COHORT_N),
    isStock: false, neutral: false,
    cumulative: cumFlow(sim, base, 'gld', COHORT_N, true, horizon),
  });
  // 3 — young people NEET right now (STOCK)
  {
    const c = headRate(sH, 'neet', youth), b = headRate(bH, 'neet', youth);
    rows.push({ key: 'neet', label: 'Young people not in education, employment or training', scope: 'right now', noun: 'young people',
      count: c, base: b, rawDelta: c - b, goodDelta: good('neet') ? c - b : b - c, isStock: true, neutral: false, cumulative: null });
  }
  // 4 — children in relative poverty right now (STOCK)
  {
    const c = headRate(sH, 'childPoverty', childPop), b = headRate(bH, 'childPoverty', childPop);
    rows.push({ key: 'poverty', label: 'Children in relative poverty (after housing costs)', scope: 'right now', noun: 'children',
      count: c, base: b, rawDelta: c - b, goodDelta: good('childPoverty') ? c - b : b - c, isStock: true, neutral: false, cumulative: null });
  }
  // 5 — disadvantaged pupils persistently absent right now (STOCK)
  {
    const c = headRate(sH, 'persistentAbsenceDis', disPupils), b = headRate(bH, 'persistentAbsenceDis', disPupils);
    rows.push({ key: 'paDis', label: 'Disadvantaged pupils persistently absent from school', scope: 'right now', noun: 'pupils',
      count: c, base: b, rawDelta: c - b, goodDelta: good('persistentAbsenceDis') ? c - b : b - c, isStock: true, neutral: false, cumulative: null });
  }
  // 6 — children holding an EHC plan (STOCK, NEUTRAL — ehcpCount is already a headcount)
  rows.push({ key: 'ehcp', label: 'Children & young people holding an EHC plan', scope: 'right now', noun: 'children',
    count: Math.round(sH.ehcpCount), base: Math.round(bH.ehcpCount), rawDelta: Math.round(sH.ehcpCount - bH.ehcpCount),
    goodDelta: 0, isStock: true, neutral: true, cumulative: null });

  return rows;
}

// --------------------------------------------------------------------------------------
// Person-years averted — the cumulative payload for STOCKS. Σ over 2025..horizon of the
// per-year headcount difference (a period-stock measure: child-years, NOT distinct people).
// Reported PER STOCK and never summed across stocks. EHCP excluded (neutral metric).
// --------------------------------------------------------------------------------------
export interface PersonYears { key: string; label: string; unitNoun: string; childYears: number; good: boolean; }
export function personYears(sim: YearResult[], base: YearResult[], horizon: number): PersonYears[] {
  const childPop = POP.childPop0to17 * M, youth = POP.youth16to24 * M, disPupils = POP.pupils * POP.disadvShare * M;
  const defs = [
    { key: 'poverty', label: 'poverty', unitNoun: 'child-years', field: 'childPoverty', n: childPop },
    { key: 'neet', label: 'NEET', unitNoun: 'person-years', field: 'neet', n: youth },
    { key: 'paDis', label: 'disadvantaged absence', unitNoun: 'pupil-years', field: 'persistentAbsenceDis', n: disPupils },
  ];
  return defs.map((d) => {
    let s = 0;
    for (const r of sim) {
      if (r.year > horizon) continue;
      const b = base.find((x) => x.year === r.year);
      if (!b) continue;
      // goodIfUp=false for all three → averted = base − scenario
      s += Math.round(((field(b, d.field) - field(r, d.field)) / 100) * d.n);
    }
    return { key: d.key, label: d.label, unitNoun: d.unitNoun, childYears: s, good: s >= 0 };
  });
}

// --------------------------------------------------------------------------------------
// Population stocks over time (headcounts, millions) — fed to the reused OutcomeChart so the
// human-scale numbers get the same rigorous time-series treatment as the rate charts.
// --------------------------------------------------------------------------------------
export interface StockSeries { key: string; title: string; unit: string; denomNote: string; scn: number[]; base: number[]; goodIfUp: boolean; }
const STOCK_DEFS = [
  { key: 'poverty', title: 'Children in relative poverty', field: 'childPoverty', denom: () => POP.childPop0to17, note: 'of ~13.6m children aged 0–17', goodIfUp: false },
  { key: 'paAll',   title: 'Pupils persistently absent',   field: 'persistentAbsence', denom: () => POP.pupils, note: 'of ~8.4m state pupils 5–16', goodIfUp: false },
  { key: 'neet',    title: 'Young people NEET (16–24)',    field: 'neet', denom: () => POP.youth16to24, note: 'of ~6.55m aged 16–24', goodIfUp: false },
  { key: 'ehcp',    title: 'Children with an EHC plan',    field: '__ehcp', denom: () => 1, note: 'headcount of plans (already absolute)', goodIfUp: false },
] as const;

export function populationStocks(sim: YearResult[], base: YearResult[]): StockSeries[] {
  const toM = (r: YearResult, d: typeof STOCK_DEFS[number]): number =>
    d.field === '__ehcp' ? r.ehcpCount / M : (field(r, d.field) / 100) * d.denom();
  return STOCK_DEFS.map((d) => ({
    key: d.key, title: d.title, unit: 'millions', denomNote: d.note, goodIfUp: d.goodIfUp,
    scn: sim.map((r) => toM(r, d)), base: base.map((r) => toM(r, d)),
  }));
}
