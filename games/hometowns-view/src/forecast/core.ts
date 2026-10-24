// The forecast worker's logic (spec §9.8), kept free of Worker plumbing so
// Node tests run it directly. The page clones the town, applies the plan and
// runs it forward 8 game months under 5 seeds against the current snapshot,
// and compares the result with a cached baseline: the same 5 seeds without
// the plan, computed once per state revision rather than per plan edit. A
// 1-seed preview answers first; the 5-seed range follows.

import { forecastPlan, forecastSamples, paramsFor, type Command, type ParamsVersion, type PlanForecast, type SampleSet, type Snapshot, type TownState } from '../engine';

export const FORECAST_MONTHS = 8;
export const FORECAST_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

export interface ForecastContext {
  townIndex: number;
  dayIndex: number;
  rivalry: 'friendly' | 'spirited';
  mishaps: 'mild' | 'off';
  paramsVersion: ParamsVersion;
  profile: 'kid' | 'adult';
}

export type ForecastRequest =
  /** A new state revision: compute (and cache) its baseline. */
  | { id: number; kind: 'baseline'; key: string; town: TownState; snapshot: Snapshot; ctx: ForecastContext }
  /** A plan edit: the plan's effect against the baseline for `key`, under `seeds`. */
  | { id: number; kind: 'plan'; key: string; town: TownState; snapshot: Snapshot; ctx: ForecastContext; plan: Command; seeds: number[] };

export type ForecastReply =
  | { id: number; kind: 'baseline'; key: string; ms: number }
  | { id: number; kind: 'plan'; key: string; seeds: number; forecast: PlanForecast; ms: number }
  | { id: number; kind: 'error'; message: string };

/** The worker's memory: one baseline, for the latest state revision. */
export interface ForecastCache {
  key: string;
  baseline: SampleSet | null;
}

const optsOf = (ctx: ForecastContext, seeds: readonly number[]) => ({
  months: FORECAST_MONTHS,
  seeds: [...seeds],
  params: paramsFor(ctx.paramsVersion),
  townIndex: ctx.townIndex,
  rivalry: ctx.rivalry,
  mishaps: ctx.mishaps,
  dayIndex: ctx.dayIndex,
  profile: ctx.profile,
});

/** The baseline's first `n` seeds (seed k's run does not depend on which other seeds ran). */
function prefix(b: SampleSet, n: number): SampleSet {
  return { ...b, samples: b.samples.slice(0, n) };
}

export function handleForecast(req: ForecastRequest, cache: ForecastCache, clock: () => number = () => 0): ForecastReply {
  const t0 = clock();
  try {
    if (req.kind === 'baseline' || cache.key !== req.key || !cache.baseline) {
      cache.key = req.key;
      cache.baseline = forecastSamples(req.town, req.snapshot, null, optsOf(req.ctx, FORECAST_SEEDS));
      if (req.kind === 'baseline') return { id: req.id, kind: 'baseline', key: req.key, ms: clock() - t0 };
    }
    const seeds = req.seeds.length ? req.seeds : [...FORECAST_SEEDS];
    const forecast = forecastPlan(req.town, req.snapshot, req.plan, optsOf(req.ctx, seeds), prefix(cache.baseline, seeds.length));
    return { id: req.id, kind: 'plan', key: req.key, seeds: seeds.length, forecast, ms: clock() - t0 };
  } catch (e) {
    return { id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
