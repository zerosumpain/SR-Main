// Forecasts before every commit (spec §9.8). OWNER: WP6 (A41). A forecast
// runs the real engine on throwaway copies of the town, with and without the
// plan, for a few months under several `forecast`-stream seeds. It reads only
// the town and the snapshot, so the phone's worker produces exactly the
// server's answer, and it never touches the town it is given.
//
// Two layers:
//   - `forecastSamples` runs one side (the plan applied, or nothing) and keeps
//     one ForecastSample per seed. The page computes the no-plan side once per
//     state revision (the baseline, §9.8) and hands it back with every plan
//     edit, so an edit costs one side, not two.
//   - `forecastPlan` pairs the plan's samples with the baseline's seed by
//     seed and reports p10–p90 of the difference: the change in people, in
//     monthly money and in happiness per face. Pairing by seed cancels the
//     dice both runs share, so the range is the plan's, not the weather's.
// `forecast` is the §10.3 call (both sides, [low, median, high]) and keeps its
// shape; it now returns the paired ranges too.

import { commitTown, population } from './core';
import { applyBudget, applyBuild, type OpsEnv } from './ops';
import { paramsFor, type Params } from './params';
import { STREAMS, h32 } from './rand';
import { cohortsOf } from './snapshot';
import { STEPS } from './steps';
import { tickTown, townContext, type TownEnv } from './tick';
import { EngineError, FACES, type Command, type Forecast, type Snapshot, type StepTable, type TownState } from './types';

export interface ForecastOptions {
  months: number;
  seeds: number[];
  params?: Params;
  townIndex?: number;
  rivalry?: 'friendly' | 'spirited';
  mishaps?: 'mild' | 'off';
  /** The county's Regional Day index today (undo and same-day refunds); default the snapshot's + 1. */
  dayIndex?: number;
  profile?: 'kid' | 'adult';
  steps?: StepTable;
}

/** p10, p50 and p90 (§9.8: "ranges are p10–p90"). */
export type Band = [p10: number, p50: number, p90: number];

/** One seed's end state: the numbers the forecast card compares. */
export interface ForecastSample {
  seed: number;
  pop: number;
  reserves: number;
  /** £ change over the last forecast month: the town's monthly money then. */
  monthly: number;
  /** Persons per FACE. */
  faces: number[];
  /** Happiness per FACE (0–100), population-weighted over its cohorts; −1 for a face nobody has. */
  happy: number[];
}

export interface SampleSet {
  months: number;
  samples: ForecastSample[];
  /** £ the plan costs now (0 for the no-plan side). */
  cost: number;
  /** A refusal sentence if the plan is illegal (then no run happened and samples is empty). */
  refused: string | null;
  /** Ticks until the plan's last new construction finishes (0: nothing it starts is under construction). */
  readyTicks: number;
}

/** What the forecast card shows (§9.2, §9.8): the plan's effect against the baseline. */
export interface PlanForecast extends Forecast {
  /** p10–p90 of (with − without) per seed: people, monthly money, and happiness per FACE. */
  effect: { pop: Band; monthly: Band; happy: Band[] };
  readyTicks: number;
}

/** Cohort index → FACE index: £ and ££ Workers are Workers, £££ Workers are Professionals (§4.2). */
const FACE_OF_COHORT: readonly number[] = [0, 2, 3, 0, 2, 3, 1, 2, 3, 4];

/** Population-weighted happiness per face (−1 where the face is empty). */
export function happyByFace(t: TownState): number[] {
  const n = cohortsOf(t);
  const w = new Array<number>(FACES.length).fill(0);
  const s = new Array<number>(FACES.length).fill(0);
  for (let k = 0; k < n.length; k++) {
    const f = FACE_OF_COHORT[k];
    w[f] += n[k];
    s[f] += n[k] * (t.happy[k] ?? 0);
  }
  return w.map((x, f) => (x > 0 ? s[f] / x : -1));
}

function facesFromCohorts(t: TownState): number[] {
  const n = cohortsOf(t);
  const out = new Array<number>(FACES.length).fill(0);
  for (let k = 0; k < n.length; k++) out[FACE_OF_COHORT[k]] += n[k];
  return out;
}

/**
 * The q-quantile of an ascending list by linear interpolation between ranks
 * (no transcendental maths, so V8 and JavaScriptCore agree to the bit).
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const r = (sorted.length - 1) * q;
  const lo = Math.floor(r);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

export function bandOf(xs: readonly number[]): Band {
  const s = [...xs].sort((a, b) => a - b);
  return [quantile(s, 0.1), quantile(s, 0.5), quantile(s, 0.9)];
}

/** [low, median, high]: the §10.3 Forecast's own band (the extremes). */
function extremes(xs: number[]): [number, number, number] {
  const s = [...xs].sort((a, b) => a - b);
  return [s[0] ?? 0, s[s.length >> 1] ?? 0, s[s.length - 1] ?? 0];
}

function envOf(s: Snapshot, o: ForecastOptions, params: Params): TownEnv {
  return { params, snapshot: s, rivalry: o.rivalry ?? 'friendly', mishaps: o.mishaps ?? 'mild', dayIndex: o.dayIndex ?? s.dayIndex + 1 };
}

function run(base: TownState, s: Snapshot, months: number, seed: number, o: ForecastOptions, params: Params): ForecastSample {
  const t = JSON.parse(JSON.stringify(base)) as TownState;
  const env = envOf(s, o, params);
  const runSeed = h32(t.seed, STREAMS.forecast, seed, 0, 0);
  const ticks = months * 4;
  let monthStart = t.money.reserves;
  for (let k = 0; k < ticks; k++) {
    if (k === ticks - 4) monthStart = t.money.reserves;
    tickTown(t, townContext(t, o.townIndex ?? 0, t.tick, env, s.at, false, runSeed), o.steps ?? STEPS);
  }
  return { seed, pop: population(t), reserves: t.money.reserves, monthly: t.money.reserves - monthStart, faces: facesFromCohorts(t), happy: happyByFace(t) };
}

function clampMonths(m: number): number {
  return Math.max(1, Math.min(24, Math.floor(Number.isFinite(m) ? m : 1)));
}

/**
 * One side of a forecast: `plan` applied to a copy (or nothing, for the
 * baseline), then `months` run forward under each seed.
 */
export function forecastSamples(t: TownState, s: Snapshot, plan: Command | null, o: ForecastOptions): SampleSet {
  const params = o.params ?? paramsFor('v1');
  const months = clampMonths(o.months);
  const seeds = o.seeds.length ? o.seeds : [1];
  const start = JSON.parse(JSON.stringify(t)) as TownState;
  let cost = 0;
  let readyTicks = 0;
  const env: OpsEnv = { params, dayIndex: o.dayIndex ?? s.dayIndex + 1, profile: o.profile ?? 'adult' };
  try {
    const before = new Map<number, number>();
    for (let i = 0; i + 1 < start.construction.length; i += 2) before.set(start.construction[i], start.construction[i + 1]);
    if (plan?.type === 'build') cost = applyBuild(start, plan.planId, plan.plan, env).cost;
    else if (plan?.type === 'budget') applyBudget(start, plan.taxes, plan.funding, env);
    // The planes are decoded and edited in place; write them back before the runs copy the town.
    commitTown(start);
    for (let i = 0; i + 1 < start.construction.length; i += 2) {
      const left = start.construction[i + 1];
      if (left > (before.get(start.construction[i]) ?? 0) && left > readyTicks) readyTicks = left;
    }
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    return { months, samples: [], cost: 0, refused: e.message, readyTicks: 0 };
  }
  return { months, samples: seeds.map((seed) => run(start, s, months, seed, o, params)), cost, refused: null, readyTicks };
}

/**
 * The plan's effect against a baseline (§9.8). Pass the cached no-plan
 * samples as `baseline`; they must be for the same town state, months and
 * seeds (the page keys its cache by the town's hash).
 */
export function forecastPlan(t: TownState, s: Snapshot, plan: Command | null, o: ForecastOptions, baseline?: SampleSet): PlanForecast {
  const base = baseline && baseline.months === clampMonths(o.months) && baseline.samples.length === (o.seeds.length || 1) ? baseline : forecastSamples(t, s, null, o);
  const withPlan = plan ? forecastSamples(t, s, plan, o) : base;
  const b = base.samples;
  const w = withPlan.refused ? b : withPlan.samples;
  const pairs = b.map((x, k) => ({ x, y: w[k] ?? x }));
  const faces = FACES.length;
  const happy: Band[] = [];
  for (let f = 0; f < faces; f++) {
    const d = pairs.filter((p) => p.x.happy[f] >= 0 && p.y.happy[f] >= 0).map((p) => p.y.happy[f] - p.x.happy[f]);
    happy.push(d.length ? bandOf(d) : [0, 0, 0]);
  }
  return {
    months: base.months,
    seeds: b.length,
    pop: { with: extremes(w.map((x) => x.pop)), without: extremes(b.map((x) => x.pop)) },
    reserves: { with: extremes(w.map((x) => x.reserves)), without: extremes(b.map((x) => x.reserves)) },
    cost: withPlan.cost,
    refused: withPlan.refused,
    effect: {
      pop: bandOf(pairs.map((p) => p.y.pop - p.x.pop)),
      monthly: bandOf(pairs.map((p) => p.y.monthly - p.x.monthly)),
      happy,
    },
    readyTicks: withPlan.readyTicks,
  };
}

/** §10.3 forecast: the town's next `months` with and without `plan`. */
export function forecast(t: TownState, s: Snapshot, plan: Command | null, o: ForecastOptions): PlanForecast {
  return forecastPlan(t, s, plan, o);
}
