// Forecasts before every commit (spec §9.8). OWNER: WP6 (A41); WP1 wrote this
// first working version against the contract so the API is whole from day
// one. A forecast runs the real engine on throwaway copies of the town, with
// and without the plan, for a few months under several `forecast`-stream
// seeds, and reports [low, median, high]. It reads only the town and the
// snapshot, so the phone's worker produces exactly the server's answer.

import { population } from './core';
import { applyBudget, applyBuild, type OpsEnv } from './ops';
import { paramsFor, type Params } from './params';
import { STREAMS, h32 } from './rand';
import { STEPS } from './steps';
import { tickTown, townContext, type TownEnv } from './tick';
import { EngineError, type Command, type Forecast, type Snapshot, type StepTable, type TownState } from './types';

export interface ForecastOptions {
  months: number;
  seeds: number[];
  params?: Params;
  townIndex?: number;
  rivalry?: 'friendly' | 'spirited';
  steps?: StepTable;
}

function band(xs: number[]): [number, number, number] {
  const s = [...xs].sort((a, b) => a - b);
  return [s[0] ?? 0, s[s.length >> 1] ?? 0, s[s.length - 1] ?? 0];
}

function run(base: TownState, s: Snapshot, months: number, seed: number, o: ForecastOptions, params: Params): TownState {
  const t = JSON.parse(JSON.stringify(base)) as TownState;
  const env: TownEnv = { params, snapshot: s, rivalry: o.rivalry ?? 'friendly', mishaps: 'mild', dayIndex: s.dayIndex + 1 };
  const runSeed = h32(t.seed, STREAMS.forecast, seed, 0, 0);
  // The town's own row in the snapshot (its day flows, links and allocations
  // are indexed by it). A town founded since the snapshot has none (−1), and
  // then reads the neutral flows, exactly as the server's month step would.
  const index = o.townIndex ?? s.towns.findIndex((r) => r.seat === t.seat);
  for (let k = 0; k < months * 4; k++) tickTown(t, townContext(t, index, t.tick, env, s.at, false, runSeed), o.steps ?? STEPS);
  return t;
}

/** §10.3 forecast: the town's next `months` with and without `plan`. */
export function forecast(t: TownState, s: Snapshot, plan: Command | null, o: ForecastOptions): Forecast {
  const params = o.params ?? paramsFor('v1');
  const months = Math.max(1, Math.min(24, Math.floor(o.months)));
  const seeds = o.seeds.length ? o.seeds : [1];
  let withPlan: TownState | null = JSON.parse(JSON.stringify(t)) as TownState;
  let cost = 0;
  let refused: string | null = null;
  const env: OpsEnv = { params, dayIndex: s.dayIndex + 1, profile: 'adult' };
  try {
    if (plan?.type === 'build') cost = applyBuild(withPlan, plan.planId, plan.plan, env).cost;
    else if (plan?.type === 'budget') applyBudget(withPlan, plan.taxes, plan.funding, env);
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    refused = e.message;
    withPlan = null;
  }
  const pops: number[][] = [[], []];
  const res: number[][] = [[], []];
  for (const seed of seeds) {
    const a = run(t, s, months, seed, o, params);
    pops[1].push(population(a));
    res[1].push(a.money.reserves);
    if (withPlan) {
      const b = run(withPlan, s, months, seed, o, params);
      pops[0].push(population(b));
      res[0].push(b.money.reserves);
    }
  }
  return {
    months,
    seeds: seeds.length,
    pop: { with: withPlan ? band(pops[0]) : band(pops[1]), without: band(pops[1]) },
    reserves: { with: withPlan ? band(res[0]) : band(res[1]), without: band(res[1]) },
    cost,
    refused,
  };
}
