// Forecasts before every commit (spec §9.8; WP6 owns forecast.ts, A41): the
// paired p10–p90 effect against a cached baseline, the §10.3 shape kept, and
// the forecast never touching the town it reads.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { bandOf, forecast, forecastPlan, forecastSamples, happyByFace, quantile } from './forecast';
import { COUNTY_ROAD_X } from './terrain';
import { stateHash } from './index';
import type { Command } from './types';

describe('quantiles', () => {
  it('interpolates between ranks, so five seeds give a p10–p90 inside the extremes', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([0, 10, 20, 30, 40], 0.1)).toBe(4);
    expect(quantile([0, 10, 20, 30, 40], 0.5)).toBe(20);
    expect(quantile([0, 10, 20, 30, 40], 0.9)).toBe(36);
    expect(bandOf([40, 0, 30, 10, 20])).toEqual([4, 20, 36]);
  });
});

describe('forecastPlan', () => {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  const s = f.county.snapshot;
  const o = { months: 2, seeds: [1, 2, 3] };
  const lane: Command = { type: 'build', planId: 'fc-1', plan: [{ op: 'road', kind: 'lane', path: [COUNTY_ROAD_X - 1, 60, COUNTY_ROAD_X - 1, 60] }] };

  it('has happiness for each face, and −1 for a face nobody has', () => {
    const h = happyByFace(t);
    expect(h).toHaveLength(5);
    for (const v of h) expect(v === -1 || (v >= 0 && v <= 100)).toBe(true);
  });

  it('pairs the plan with a cached baseline seed by seed, and never touches the town', () => {
    const before = stateHash(t);
    const base = forecastSamples(t, s, null, o);
    expect(base.samples).toHaveLength(3);
    const a = forecastPlan(t, s, lane, o, base);
    const b = forecastPlan(t, s, lane, o);
    expect(a).toEqual(b);
    expect(stateHash(t)).toBe(before);
    for (const band of [a.effect.pop, a.effect.monthly, ...a.effect.happy]) expect(band[0] <= band[1] && band[1] <= band[2]).toBe(true);
  });

  it('shows no effect for no plan, and refuses an illegal plan without running it', () => {
    const none = forecastPlan(t, s, null, o);
    expect(none.effect.pop).toEqual([0, 0, 0]);
    expect(none.effect.monthly).toEqual([0, 0, 0]);
    const bad = forecastPlan(t, s, { type: 'build', planId: 'fc-2', plan: [{ op: 'place', id: 'pocketPark', x: 0, y: 0, rot: 0 }] }, o);
    expect(bad.refused).toMatch(/does not fit/);
    expect(bad.effect.pop).toEqual([0, 0, 0]);
  });

  it('counts the weeks until what the plan starts is built', () => {
    const park = forecastSamples(t, s, { type: 'build', planId: 'fc-3', plan: [{ op: 'place', id: 'pocketPark', x: COUNTY_ROAD_X - 1, y: 60, rot: 0 }] }, o);
    if (!park.refused) expect(park.readyTicks).toBeGreaterThan(0);
    expect(forecastSamples(t, s, null, o).readyTicks).toBe(0);
  });

  it('keeps the §10.3 shape', () => {
    const r = forecast(t, s, null, o);
    expect(r).toMatchObject({ months: 2, seeds: 3, cost: 0, refused: null });
    expect(r.pop.with).toEqual(r.pop.without);
    expect(r.reserves.without).toHaveLength(3);
  });
});
