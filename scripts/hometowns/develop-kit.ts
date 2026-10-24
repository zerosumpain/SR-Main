// Bramble's three founding steps (spec §1.5, A12) as a script, for WP2e's
// Founding Fortnight acceptance test and the Lab's G13 gate: drag a lane from
// the County Road, paint 12 Homes tiles beside it, paint 2 Farms and place a
// Well. It plays through the real move API (applyCommand), the way a phone
// and the bots do, and picks its tiles from the town's own terrain so it
// works on every site. Nothing here is part of the engine.

import { applyCommand } from '../../src/lib/games/hometowns/engine/commands';
import { population } from '../../src/lib/games/hometowns/engine/core';
import { COUNTY_ROAD_END_Y, COUNTY_ROAD_X, buildable, terrainOf } from '../../src/lib/games/hometowns/engine/terrain';
import { USE_EMPTY, inMap, parcelOpen, planesOf, tileIndex } from '../../src/lib/games/hometowns/engine/tiles';
import type { CountyState, Op, TownState } from '../../src/lib/games/hometowns/engine/types';

export interface BrambleOptions {
  /** Homes tiles to paint (the tutorial asks for 12, A12). */
  homes?: number;
  farms?: number;
  /** Lane length in tiles. */
  lane?: number;
}

export interface BramblePlan {
  lane: number[];
  homes: [number, number][];
  farms: [number, number][];
  well: [number, number] | null;
}

const free = (t: TownState, x: number, y: number) =>
  inMap(x, y) && parcelOpen(t, x, y) && buildable(terrainOf(t)[tileIndex(x, y)]) && planesOf(t).use[tileIndex(x, y)] === USE_EMPTY;

/**
 * Chooses the tutorial's tiles: a straight lane off the County Road (west or
 * east, on the first row beside the road where the whole run is free land),
 * then the free tiles within 2 of it, nearest the road first.
 */
export function bramblePlan(t: TownState, o: BrambleOptions = {}): BramblePlan | null {
  const len = o.lane ?? 10;
  const nHomes = o.homes ?? 12;
  const nFarms = o.farms ?? 2;
  // Rows beside the County Road inside the open land (it runs up from the Kingsport signpost to y = 44).
  for (const y of [46, 47, 45, COUNTY_ROAD_END_Y]) {
    for (const dir of [-1, 1]) {
      const x0 = COUNTY_ROAD_X + dir;
      const x1 = COUNTY_ROAD_X + dir * len;
      let ok = true;
      for (let x = x0; ok && x !== x1 + dir; x += dir) ok = free(t, x, y);
      if (!ok) continue;
      const lane = [x0, y, x1, y];
      const spots: [number, number, number][] = [];
      for (let yy = y - 2; yy <= y + 2; yy++)
        for (let k = 0; k < len; k++) {
          const x = x0 + dir * k;
          if (yy === y || !free(t, x, yy)) continue;
          spots.push([Math.abs(x - COUNTY_ROAD_X) * 10 + Math.abs(yy - y), x, yy]);
        }
      spots.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
      if (spots.length < nHomes + nFarms + 1) continue;
      const pick = spots.map(([, x, yy]) => [x, yy] as [number, number]);
      return { lane, homes: pick.slice(0, nHomes), farms: pick.slice(nHomes, nHomes + nFarms), well: pick[nHomes + nFarms] };
    }
  }
  return null;
}

/** Plays the three steps for `seat` at `now` (one plan per step, like the tutorial). Returns the plan used. */
export function brambleSteps(c: CountyState, seat: string, now: number, o: BrambleOptions = {}): BramblePlan {
  const t = c.towns.find((x) => x.seat === seat);
  if (!t) throw new Error(`no town for ${seat}`);
  const plan = bramblePlan(t, o);
  if (!plan) throw new Error(`no room for Bramble's steps on site ${t.site}`);
  const build = (planId: string, ops: Op[]) => applyCommand(c, seat, { type: 'build', planId, plan: ops }, now);
  build(`${seat}-bramble-1`, [{ op: 'road', kind: 'lane', path: plan.lane }]);
  build(`${seat}-bramble-2`, plan.homes.map(([x, y]) => ({ op: 'zone', zone: 'homes', rect: [x, y, 1, 1] })));
  const farmsAndWell: Op[] = plan.farms.map(([x, y]) => ({ op: 'zone', zone: 'farms', rect: [x, y, 1, 1] }));
  if (plan.well) farmsAndWell.push({ op: 'place', id: 'well', x: plan.well[0], y: plan.well[1], rot: 0 });
  build(`${seat}-bramble-3`, farmsAndWell);
  return plan;
}

/** Taps "Next week ▶" `n` times, 10 s apart, recording the population after each tap. */
export function sprintTaps(c: CountyState, seat: string, now: number, n = 12): { now: number; pop: number[]; meters: number[][] } {
  const t = c.towns.find((x) => x.seat === seat)!;
  const pop: number[] = [];
  const meters: number[][] = [];
  let at = now;
  for (let k = 0; k < n; k++) {
    at += 10_000;
    applyCommand(c, seat, { type: 'sprint', moveId: `${seat}-tap-${k}` }, at);
    pop.push(population(t));
    meters.push([...t.meters]);
  }
  return { now: at, pop, meters };
}
