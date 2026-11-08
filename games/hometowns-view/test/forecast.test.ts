// The forecast worker's logic (spec §9.8): one baseline per state, a 1-seed
// preview whose numbers agree with the 5-seed range's first seed, and a
// range that completes inside a generous budget in Node.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../scripts/hometowns/fixture';
import { COUNTY_ROAD_X, stateHash, type Command } from '../src/engine';
import { FORECAST_SEEDS, handleForecast, type ForecastCache, type ForecastContext } from '../src/forecast/core';
import { ForecastClient, type ForecastUpdate } from '../src/forecast/client';

describe('handleForecast', () => {
  const f = fixture('town');
  const c = f.county;
  const t = c.towns[f.town];
  const ctx: ForecastContext = { townIndex: f.town, dayIndex: c.dayIndex, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, paramsVersion: c.paramsVersion, profile: 'adult' };
  const plan: Command = { type: 'build', planId: 'w-1', plan: [{ op: 'zone', zone: 'homes', rect: [COUNTY_ROAD_X - 3, 58, 2, 2] }] };
  const key = stateHash(t);

  it('caches the baseline per state and answers plans against it', () => {
    const cache: ForecastCache = { key: '', baseline: null };
    const r0 = handleForecast({ id: 1, kind: 'baseline', key, town: t, snapshot: c.snapshot, ctx }, cache);
    expect(r0).toMatchObject({ kind: 'baseline', key });
    expect(cache.baseline?.samples).toHaveLength(FORECAST_SEEDS.length);
    const kept = cache.baseline;
    const one = handleForecast({ id: 2, kind: 'plan', key, town: t, snapshot: c.snapshot, ctx, plan, seeds: [1] }, cache);
    const five = handleForecast({ id: 3, kind: 'plan', key, town: t, snapshot: c.snapshot, ctx, plan, seeds: [...FORECAST_SEEDS] }, cache);
    expect(cache.baseline).toBe(kept);
    if (one.kind !== 'plan' || five.kind !== 'plan') throw new Error('expected plan replies');
    expect(one.seeds).toBe(1);
    expect(five.seeds).toBe(5);
    expect(one.forecast.cost).toBe(five.forecast.cost);
    // Seed 1 is the same run in both: a one-sample band is its own value.
    expect(one.forecast.effect.pop[0]).toBe(one.forecast.effect.pop[2]);
  });

  it('computes a fresh baseline when the state changed under it', () => {
    const cache: ForecastCache = { key: 'old', baseline: null };
    const r = handleForecast({ id: 4, kind: 'plan', key, town: t, snapshot: c.snapshot, ctx, plan, seeds: [1, 2] }, cache);
    expect(r.kind).toBe('plan');
    expect(cache.key).toBe(key);
  });

  it('keeps one request in flight and lets a ticking town never starve the plan’s forecast', async () => {
    const got: ForecastUpdate[] = [];
    const client = new ForecastClient((u) => got.push(u), false);
    client.forecast('w-1', t, c.snapshot, ctx, plan);
    // Every frame at the top speed is a new state: none of those baselines displaces the plan's job.
    for (let k = 0; k < 20; k++) client.setState({ ...t, tick: t.tick + k + 1 }, c.snapshot, ctx, true);
    for (let k = 0; k < 200 && got.length < 2; k++) await new Promise((r) => setTimeout(r, 10));
    expect(got.map((u) => [u.planId, u.seeds])).toEqual([
      ['w-1', 1],
      ['w-1', 5],
    ]);
  });

  it('turns an engine failure into an error reply, not a dead worker', () => {
    const r = handleForecast({ id: 5, kind: 'plan', key: 'k', town: null as never, snapshot: c.snapshot, ctx, plan, seeds: [1] }, { key: '', baseline: null });
    expect(r.kind).toBe('error');
  });

  it('forecasts 8 months under 5 seeds within budget (Node; the iPhone budget is 250 ms with a cached baseline)', () => {
    const cache: ForecastCache = { key: '', baseline: null };
    handleForecast({ id: 6, kind: 'baseline', key, town: t, snapshot: c.snapshot, ctx }, cache);
    const t0 = performance.now();
    const r = handleForecast({ id: 7, kind: 'plan', key, town: t, snapshot: c.snapshot, ctx, plan, seeds: [...FORECAST_SEEDS] }, cache, () => performance.now());
    const ms = performance.now() - t0;
    expect(r.kind).toBe('plan');
    console.log(`[forecast] town fixture, 8 months × 5 seeds with a cached baseline: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(3000);
  });
});
