// Land value (spec §5.7), 1–250 per cell, the one field that is stored: it
// moves at most ±8 a month, so it is state, not derived.
//
//   LV*(x) = 28 + 0.35·JobsAccess + 0.20·Nature + 0.15·School + 0.10·Health + 0.12·Culture
//            + 0.10·Transit + Scenic(x) + Premium − 0.55·Pollution − 0.25·Noise − 0.35·Crime
//            (+ landmark bonuses, − potholes on road cells while roads are funded Low)
//   Premium = clamp(0.25·(mean(Schools, Safety, Health, Fun) − 50) − 1.2·(HomesTax% − 8), −25, +25)
//   LV(t+1) = clamp(LV(t) + clamp(LV* − LV(t), −8, +8), 1, 250)
//
// Premium is Oates-style capitalisation: good services lift every plot and a
// high property tax lowers them, so the best tax rate is not a fixed number.
// The stars in it are last month's perceived ones (what a buyer sees), with
// this month's Safety. The terms are additive, so the lens can list them
// ("+40 near jobs · +18 park · +15 river · −22 factory smoke"): landValueTerms.

import type { Params } from './params';
import { monthF64, monthU8 } from './pool';
import { T_FOREST, T_HILL, T_SAND, T_WATER, TF_COAST, TF_RIVER, terrainElevation, terrainKind } from './terrain';
import { CELLS, CELLS_PER_SIDE, MAP } from './tiles';
import { STARS, type TownState } from './types';

/** Scenic class per cell: 0 none, then the landValue.scenic order (beach, waterside, hill-top, forest edge). */
const SCENIC = new WeakMap<Uint8Array, { key: string; scenic: Float64Array }>();

/**
 * Scenic(x), constant from terrain: the largest of beach (sand on the coast
 * in or beside the cell), waterside (land in the cell with water beside it),
 * hill-top (a hill or the highest ground in the cell) and forest edge (open
 * land in the cell beside trees). Memoised per terrain plane.
 */
export function scenicOf(terrain: Uint8Array, values: readonly number[]): Float64Array {
  const key = values.join(',');
  const hit = SCENIC.get(terrain);
  if (hit && hit.key === key) return hit.scenic;
  const [beach, waterside, hill, forest] = values;
  const out = new Float64Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const cx = c % CELLS_PER_SIDE;
    const cy = (c - cx) / CELLS_PER_SIDE;
    let land = false;
    let open = false;
    let top = false;
    for (let y = 2 * cy; y < 2 * cy + 2; y++)
      for (let x = 2 * cx; x < 2 * cx + 2; x++) {
        const v = terrain[y * MAP + x];
        const k = terrainKind(v);
        if (k !== T_WATER) land = true;
        if (k !== T_WATER && k !== T_FOREST) open = true;
        if (k === T_HILL || (k !== T_WATER && terrainElevation(v) === 3)) top = true;
      }
    if (!land) continue;
    let sand = false;
    let water = false;
    let trees = false;
    let river = false;
    for (let y = 2 * cy - 1; y <= 2 * cy + 2; y++)
      for (let x = 2 * cx - 1; x <= 2 * cx + 2; x++) {
        if (x < 0 || y < 0 || x >= MAP || y >= MAP) continue;
        const v = terrain[y * MAP + x];
        const k = terrainKind(v);
        if (k === T_SAND && v & TF_COAST) sand = true;
        if (k === T_WATER) water = true;
        if (k === T_FOREST) trees = true;
        if (k !== T_WATER && v & TF_RIVER) river = true;
      }
    let s = 0;
    if (sand) s = Math.max(s, beach);
    if (water || river) s = Math.max(s, waterside);
    if (top) s = Math.max(s, hill);
    if (trees && open) s = Math.max(s, forest);
    out[c] = s;
  }
  SCENIC.set(terrain, { key, scenic: out });
  return out;
}

/** Population-weighted homes tax in percent (bp / 100), or the plain mean with nobody home. */
export function homesTaxPercent(t: TownState, tierPop: readonly number[]): number {
  const n = tierPop[0] + tierPop[1] + tierPop[2];
  const bp = (h: number) => t.taxes.homes[h] ?? 0;
  if (n <= 0) return (bp(0) + bp(1) + bp(2)) / 300;
  return (bp(0) * tierPop[0] + bp(1) * tierPop[1] + bp(2) * tierPop[2]) / n / 100;
}

/** Premium (§5.7): last month's perceived Schools, Health and Fun with this month's Safety. */
export function premiumOf(t: TownState, safety: number, taxPct: number, p: Params): number {
  const [slope, tax, ref, cap] = p.landValue.premium;
  const star = (k: (typeof STARS)[number]) => t.perceived[STARS.indexOf(k)] ?? 50;
  const mean = (star('schools') + safety + star('health') + star('fun')) / 4;
  const v = slope * (mean - 50) - tax * (taxPct - ref);
  return v < -cap ? -cap : v > cap ? cap : v;
}

export interface LandValueInputs {
  jobsAccess: Float64Array;
  /** Coverage per cell: nature, school, health, culture, transit. */
  nature: Float64Array;
  school: Float64Array;
  health: Float64Array;
  culture: Float64Array;
  transit: Float64Array;
  pollution: Float64Array;
  noise: Float64Array;
  crime: Float64Array;
  scenic: Float64Array;
  bonus: Float64Array;
  /** Per cell 1 where potholes cost land value. */
  potholes: Uint8Array;
  premium: number;
}

/** The additive LV* terms of one cell, in the order of the Why registry ('lv.*'). */
export function landValueTerms(i: LandValueInputs, p: Params, c: number): [key: string, amount: number][] {
  const [wj, wn, ws, wh, wc, wt] = p.landValue.weights;
  const [pp, pn, pc] = p.landValue.penalties;
  return [
    ['lv.base', p.fields.lvBase],
    ['lv.jobs', wj * i.jobsAccess[c]],
    ['lv.nature', wn * i.nature[c]],
    ['lv.school', ws * i.school[c]],
    ['lv.health', wh * i.health[c]],
    ['lv.culture', wc * i.culture[c]],
    ['lv.transit', wt * i.transit[c]],
    ['lv.scenic', i.scenic[c]],
    ['lv.premium', i.premium],
    ['lv.pollution', -pp * i.pollution[c]],
    ['lv.noise', -pn * i.noise[c]],
    ['lv.crime', -pc * i.crime[c]],
    ['lv.bonus', i.bonus[c]],
    ['lv.potholes', i.potholes[c] ? -p.landValue.potholes : 0],
  ];
}

/** LV* per cell, clamped to the plane's 1–250. */
export function landValueTargets(i: LandValueInputs, p: Params): Float64Array {
  const out = monthF64(CELLS);
  const [wj, wn, ws, wh, wc, wt] = p.landValue.weights;
  const [pp, pn, pc] = p.landValue.penalties;
  const base = p.fields.lvBase;
  const pot = p.landValue.potholes;
  for (let c = 0; c < CELLS; c++) {
    let v =
      base +
      wj * i.jobsAccess[c] +
      wn * i.nature[c] +
      ws * i.school[c] +
      wh * i.health[c] +
      wc * i.culture[c] +
      wt * i.transit[c] +
      i.scenic[c] +
      i.premium -
      pp * i.pollution[c] -
      pn * i.noise[c] -
      pc * i.crime[c] +
      i.bonus[c] -
      (i.potholes[c] ? pot : 0);
    v = v < 1 ? 1 : v > 250 ? 250 : v;
    out[c] = v;
  }
  return out;
}

/** One month of the rate-capped move toward LV* (whole numbers, 1–250). */
export function nextLandValue(lv: Uint8Array, target: Float64Array, cap: number): Uint8Array {
  const out = monthU8(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const cur = lv[c];
    // A u8 plane would store a NaN as 0 and nothing downstream could tell: fail the month instead.
    if (!Number.isFinite(target[c])) throw new Error(`land value target of cell ${c} is ${target[c]}`);
    let d = Math.round(target[c]) - cur;
    if (d > cap) d = cap;
    else if (d < -cap) d = -cap;
    const v = cur + d;
    out[c] = v < 1 ? 1 : v > 250 ? 250 : v;
  }
  return out;
}
