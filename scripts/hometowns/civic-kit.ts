// Scenario kit for WP2d's tests and the Lab's civic runs (spec §13.1: a
// package codes against the contracts, not against the other packages).
//
//   - civicSteps(script): the real WP2d steps (M7c, M13, M14 and the
//     Regional Day's tier check) with every other package's month step
//     replaced by a writer of its blackboard slots from a script, so finance
//     can be driven through any economy (a slump, a boom, a deficit) cheaply
//     and exactly.
//   - liveSteps(): every landed package's real steps, with the development
//     scan held (the planned town stays as built) and supply counted from the
//     tiles, for whole-economy calibration runs.
//   - cityTown(): a planned City-tier town (≈40,000 residents) on flat land,
//     with the full set of City services sized to its population: what the
//     A14 calibration table means by "default taxes and full coverage".
// Nothing here is part of the engine.

import { BUILDINGS, ZONE_DEFS, buildingIndex } from '../../src/lib/games/hometowns/engine/content';
import { rollMonthBooks } from '../../src/lib/games/hometowns/engine/core';
import { neutral } from '../../src/lib/games/hometowns/engine/derived';
import { reindexBuildings } from '../../src/lib/games/hometowns/engine/ops';
import { h32 } from '../../src/lib/games/hometowns/engine/rand';
import { withSteps } from '../../src/lib/games/hometowns/engine/steps';
import * as stubs from '../../src/lib/games/hometowns/engine/stubs';
import { CELLS, USE_EMPTY, commitPlanes, encodeCells, footprint, makeLvl, newBuilding, planesForWrite, planesOf, roadUse, tileIndex, zoneUse } from '../../src/lib/games/hometowns/engine/tiles';
import {
  ROAD_KINDS,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  Z_HOMES,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  person,
  type DerivedCache,
  type MonthContext,
  type MonthStep,
  type StepTable,
  type TownState,
} from '../../src/lib/games/hometowns/engine/types';
import { supplyFromPlanes } from './people-kit';
import { kitTown, type Kit } from './space-kit';

// ---- Scripted upstream ----------------------------------------------------------------------------

/** Partial slot values; anything left out takes the slot's neutral value. */
export type CivicScript = { [K in Exclude<keyof DerivedCache, 'ledger' | 'mood'>]?: Partial<NonNullable<DerivedCache[K]>> };

/** Which non-WP2d month step writes which slots (the step table's own declaration). */
const UPSTREAM: [id: string, slots: (keyof CivicScript)[]][] = [
  ['M1b supply', ['development']],
  ['M2 utilities', ['utilities']],
  ['M3 fields', ['fields', 'coverage']],
  ['M4 transport', ['travel']],
  ['M5 labour', ['labour']],
  ['M6 tourism', ['tourism']],
  ['M7a households', ['housing']],
  ['M7b spending', ['spend', 'goods']],
  ['M8 firms', ['firms']],
  ['M9 demography', []],
  ['M10 stars', ['stars', 'needs']],
  ['M11 migration', ['migration']],
  ['M12 housing', []],
];

function neutralOf(slot: keyof CivicScript, t: TownState, m: MonthContext): object {
  switch (slot) {
    case 'fields':
      return neutral.fields(t);
    case 'coverage':
      return neutral.coverage(t);
    case 'stars':
      return neutral.stars(t);
    case 'migration':
      return neutral.migration(Math.max(1, m.snapshot.towns.length));
    default:
      return (neutral as unknown as Record<string, () => object>)[slot]();
  }
}

/**
 * The real WP2d steps with every other month step writing its slots from
 * `script` (a function may vary them month by month). The tick's
 * development scan is held at its stub, so the tiles stay as built.
 */
export function civicSteps(script: CivicScript | ((t: TownState, m: MonthContext) => CivicScript)): StepTable {
  const over: Record<string, MonthStep | typeof stubs.stubDevelop> = { develop: stubs.stubDevelop, 'M14b develop memo': stubs.stubDevelopMemo };
  for (const [id, slots] of UPSTREAM) {
    over[id] = (t: TownState, m: MonthContext) => {
      const s = typeof script === 'function' ? script(t, m) : script;
      for (const slot of slots) (m.derived as unknown as Record<string, object>)[slot] = { ...neutralOf(slot, t, m), ...(s[slot] ?? {}) };
    };
  }
  return withSteps(over);
}

/** Every landed package's steps, with development held and supply counted from the tiles. */
export function liveSteps(): StepTable {
  return withSteps({
    develop: stubs.stubDevelop,
    'M14b develop memo': stubs.stubDevelopMemo,
    'M1b supply': (t: TownState, m: MonthContext) => {
      m.derived.development = supplyFromPlanes(t);
    },
  });
}

// ---- A planned City ------------------------------------------------------------------------------------

/** The City service set for ≈40,000 residents: every §7 City checklist building and enough capacity for all. */
export const CITY_SERVICES: readonly string[] = [
  'townHall',
  'gasPlant', 'gasPlant', 'gasPlant', 'gasPlant',
  'pumpingStation', 'pumpingStation', 'waterTower', 'waterTower', 'waterTower',
  'policeStation', 'policeStation', 'fireStation', 'fireStation',
  'healthCentre', 'healthCentre', 'healthCentre', 'healthCentre',
  ...new Array<string>(15).fill('primarySchool'),
  'secondarySchool', 'secondarySchool', 'secondarySchool',
  'library', 'museum', 'communityHall',
  'park', 'park', 'park', 'park', 'playground', 'playground', 'sportsPitches', 'sportsPitches', 'swimmingPool', 'cinema',
  'busDepot', 'busStop', 'busStop', 'busStop', 'busStop', 'busStop', 'busStop', 'busStop', 'busStop',
];

/** Zone shares of the non-service land: Homes, Shops, Industry, Offices, Leisure. */
const CITY_MIX: readonly [zone: number, share: number][] = [
  [Z_HOMES, 0.5],
  [Z_SHOPS, 0.17],
  [Z_INDUSTRY, 0.12],
  [Z_OFFICES, 0.11],
  [Z_LEISURE, 0.1],
];
const LO = 8;
const HI = 56;
const SPACING = 5;

function placeInRegion(t: TownState, id: string): boolean {
  const kind = buildingIndex(id);
  const def = BUILDINGS[kind];
  const [w, h] = footprint(def.w, def.h, 0);
  const p = planesOf(t);
  for (let y = LO; y + h <= HI; y++)
    for (let x = LO; x + w <= HI; x++) {
      let ok = true;
      for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) if (p.use[tileIndex(xx, yy)] !== USE_EMPTY) ok = false;
      if (!ok) continue;
      t.buildings.push(newBuilding(kind, x, y, 0, 0, 1));
      reindexBuildings(t);
      commitPlanes(t);
      return true;
    }
  return false;
}

/**
 * A City-tier town: a street grid (avenues every other line) over the
 * middle 48×48 tiles, the service set placed first, and every other plot
 * zoned by CITY_MIX (Homes at L3 and L4, the rest at L3), with residents at
 * 92% of homes capacity (£ 40%, ££ 45%, £££ 15% of homes). Reserves start
 * at three months of a City's upkeep.
 */
export function cityTown(o: { services?: readonly string[]; seed?: number } = {}): Kit {
  const k = kitTown({ tier: 3, lv: 100, seed: o.seed ?? 21 });
  const { t } = k;
  const p = planesForWrite(t);
  const avenue = roadUse(ROAD_KINDS.indexOf('avenue'));
  const street = roadUse(ROAD_KINDS.indexOf('street'));
  for (let y = LO; y <= HI; y++)
    for (let x = LO; x <= HI; x++) {
      const gx = (x - LO) % SPACING === 0;
      const gy = (y - LO) % SPACING === 0;
      if (!gx && !gy) continue;
      const major = (gx && (x - LO) % (2 * SPACING) === 0) || (gy && (y - LO) % (2 * SPACING) === 0);
      p.use[tileIndex(x, y)] = major ? avenue : street;
    }
  commitPlanes(t);
  for (const id of o.services ?? CITY_SERVICES) if (!placeInRegion(t, id)) throw new Error(`no room for ${id}`);

  const w = planesForWrite(t);
  const cum: number[] = [];
  CITY_MIX.reduce((a, [, s]) => (cum.push(a + s), a + s), 0);
  const cap = [0, 0, 0];
  for (let y = LO; y < HI; y++)
    for (let x = LO; x < HI; x++) {
      const i = tileIndex(x, y);
      if (w.use[i] !== USE_EMPTY) continue;
      const u = (h32(t.seed, 77, i, 0, 0) >>> 0) / 4294967296;
      const zone = CITY_MIX[Math.max(0, cum.findIndex((c) => u < c))][0];
      let level = 3;
      let tier = 0;
      if (zone === Z_HOMES) {
        const v = (h32(t.seed, 78, i, 0, 0) >>> 0) / 4294967296;
        tier = v < 0.4 ? 0 : v < 0.85 ? 1 : 2;
        level = h32(t.seed, 79, i, 0, 0) % 10 < 3 ? 4 : 3;
        cap[tier] += ZONE_DEFS[Z_HOMES].capacity[level - 1];
      }
      w.use[i] = zoneUse(zone);
      w.lvl[i] = makeLvl(level, tier, i & 7);
      w.age[i] = 60;
    }
  commitPlanes(t);
  t.lv = encodeCells(new Uint8Array(CELLS).fill(100));

  for (let h = 0; h < 3; h++) {
    const n = Math.floor(cap[h] * 0.92);
    const parents = Math.floor(n * 0.22);
    const children = Math.floor(n * 0.2);
    const retirees = Math.floor(n * 0.13);
    t.people[person(STAGE_P, h)] = parents;
    t.people[person(STAGE_C, h)] = children;
    t.people[person(STAGE_R, h)] = retirees;
    t.people[person(STAGE_W, h)] = n - parents - children - retirees;
  }
  t.edu = 70;
  t.culture = 400;
  t.perceived = t.perceived.map(() => 55);
  t.money.reserves = 4_000_000;
  rollMonthBooks(t);
  return k;
}
