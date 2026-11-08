// Golden fixture states for Hometowns (spec §13.1 item 2): a Hamlet, a Town
// and a Metropolis, HAND-BUILT for M0 so every work package can code and test
// against realistic towns before the economy exists. Once the economy runs,
// WP5 regenerates them from bot play (A36: fixtures are bot-generated or
// hand-built, never copied from a real room).
//
// They are built directly, not by ticking, so they do not change when a
// package lands: a fixture is a pure function of its kind. Each call returns
// a fresh deep copy.
//
//   import { fixture, newCounty, foundAndSprint } from '../../scripts/hometowns/fixture';
//   const f = fixture('town');           // { kind, county, town, now }
//   const t = f.county.towns[f.town];

import {
  BUILDINGS,
  ZONE_DEFS,
  buildingIndex,
} from '../../src/lib/games/hometowns/engine/content';
import { countyMonth, gridTickAt, nextRegionalDayAt } from '../../src/lib/games/hometowns/engine/clock';
import { applyCommand } from '../../src/lib/games/hometowns/engine/commands';
import { createCounty } from '../../src/lib/games/hometowns/engine/county';
import { population, rollMonthBooks } from '../../src/lib/games/hometowns/engine/core';
import { snapshotOf } from '../../src/lib/games/hometowns/engine/snapshot';
import { reindexBuildings } from '../../src/lib/games/hometowns/engine/ops';
import { h32 } from '../../src/lib/games/hometowns/engine/rand';
import { buildable, terrainOf, TF_RIVER } from '../../src/lib/games/hometowns/engine/terrain';
import {
  ALL_PARCELS,
  CELLS,
  CENTRAL_PARCELS,
  MAP,
  USE_EMPTY,
  commitPlanes,
  encodeCells,
  footprint,
  makeLvl,
  newBuilding,
  parcelOpen,
  planesForWrite,
  planesOf,
  roadUse,
  tileIndex,
  useCat,
  zoneUse,
} from '../../src/lib/games/hometowns/engine/tiles';
import {
  PERSON_S,
  ROAD_KINDS,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  Z_FARMS,
  Z_HOMES,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  person,
  type CountySettings,
  type CountyState,
  type Tier,
  type TownState,
} from '../../src/lib/games/hometowns/engine/types';

export type FixtureKind = 'hamlet' | 'town' | 'metropolis';
export interface Fixture {
  kind: FixtureKind;
  county: CountyState;
  /** Index of the fixture town in county.towns. */
  town: number;
  /** The instant the fixture is "at": the county and town are caught up to it. */
  now: number;
}

/** Tuesday 20 October 2026, 12:00 UTC: every fixture county's epoch. */
export const FIXTURE_EPOCH = 1792497600000;
const DAY = 86_400_000;

export const TEST_SETTINGS: CountySettings = { rivalry: 'friendly', mishaps: 'mild', youngestOrder: [], perSeat: {} };

/** A fresh county at FIXTURE_EPOCH (or `epoch`). */
export function newCounty(seed = 1, epoch = FIXTURE_EPOCH, devTickMs: number | null = null): CountyState {
  return createCounty({ seed, params: 'v1', settings: JSON.parse(JSON.stringify(TEST_SETTINGS)), epoch, now: epoch, devTickMs });
}

/**
 * Founds a town for `seat` on `site` and taps all twelve sprint ticks (10 s
 * apart) starting at `now`. Returns the town index and the instant after.
 */
export function foundAndSprint(c: CountyState, seat: string, site: number, now: number, name: [string, string] = ['Sunny', 'vale']): { index: number; now: number } {
  applyCommand(c, seat, { type: 'found', site, nameParts: name, avatar: 'badger', flag: site }, now);
  const index = c.towns.findIndex((t) => t.seat === seat);
  let at = now;
  for (let i = 0; i < 12; i++) {
    at += 10_000;
    applyCommand(c, seat, { type: 'sprint', moveId: `${seat}-sprint-${i}` }, at);
  }
  return { index, now: at };
}

// ---- Hand-built towns ---------------------------------------------------------------------

interface Recipe {
  tier: Tier;
  days: number;
  parcels: number;
  /** Road grid spacing and the road kind of the grid's main lines. */
  spacing: number;
  main: (typeof ROAD_KINDS)[number];
  /** Zone shares (Homes, Shops, Leisure, Industry, Offices, Farms), summing to ~1. */
  mix: number[];
  buildings: string[];
  lvBoost: number;
  reserves: number;
  occupancy: number;
  /** Zones and side roads only within this many tiles of the Town Hall (a compact hamlet). */
  radius: number;
  /** An optional lower level cap than the tier's (a hamlet of cottages). */
  levelCap?: number;
  /** Homes tier shares £, ££, £££. */
  tiers: number[];
}

const RECIPES: Record<FixtureKind, Recipe> = {
  hamlet: {
    tier: 0, days: 1, parcels: CENTRAL_PARCELS, spacing: 6, main: 'lane',
    mix: [0.7, 0.12, 0, 0.08, 0, 0.1], buildings: ['well', 'windmill', 'schoolHouse', 'villageGreen', 'pocketPark'],
    lvBoost: 10, reserves: 61_500, occupancy: 0.9, tiers: [1, 0, 0], radius: 5, levelCap: 1,
  },
  town: {
    tier: 2, days: 7, parcels: CENTRAL_PARCELS | (1 << 1) | (1 << 2) | (1 << 4) | (1 << 7) | (1 << 13) | (1 << 14), spacing: 6, main: 'street',
    mix: [0.55, 0.15, 0.05, 0.15, 0.1, 0], buildings: [
      'pumpingStation', 'waterTower', 'coalPlant', 'generator', 'constablePost', 'policeStation', 'fireStation', 'surgery',
      'healthCentre', 'primarySchool', 'villageSchool', 'secondarySchool', 'library', 'park', 'playground', 'communityHall',
      'sportsPitches', 'cinema', 'museum', 'busDepot', 'busStop', 'busStop',
    ],
    lvBoost: 45, reserves: 1_250_000, occupancy: 0.92, tiers: [0.45, 0.42, 0.13], radius: 14,
  },
  metropolis: {
    tier: 4, days: 60, parcels: ALL_PARCELS, spacing: 5, main: 'avenue',
    mix: [0.5, 0.15, 0.08, 0.1, 0.17, 0], buildings: [
      'waterWorks', 'pumpingStation', 'pumpingStation', 'gasPlant', 'solarFarm', 'windTurbine', 'windTurbine', 'coalPlant',
      'policeStation', 'policeStation', 'fireStation', 'fireStation', 'hospital', 'healthCentre', 'healthCentre',
      'primarySchool', 'primarySchool', 'primarySchool', 'secondarySchool', 'secondarySchool', 'library', 'university',
      'park', 'park', 'botanicGarden', 'swimmingPool', 'cinema', 'stadium', 'theatre', 'museum', 'clockTower', 'townLandmark',
      'busDepot', 'busStop', 'busStop', 'busStop', 'railStation', 'freightYard', 'youthClub',
    ],
    lvBoost: 120, reserves: 9_400_000, occupancy: 0.95, tiers: [0.3, 0.45, 0.25], radius: 999,
  },
};

const FIXTURE_SITE: Record<FixtureKind, number> = { hamlet: 0, town: 1, metropolis: 2 };
const FIXTURE_SEED: Record<FixtureKind, number> = { hamlet: 101, town: 202, metropolis: 303 };

function placeAnywhere(t: TownState, id: string, salt: number): boolean {
  const kind = buildingIndex(id);
  const def = BUILDINGS[kind];
  const terrain = terrainOf(t);
  const p = planesOf(t);
  const [w, h] = footprint(def.w, def.h, 0);
  // Scan from a seeded starting tile so buildings spread over the map.
  const start = h32(t.seed, 99, salt, 0, 0) % (MAP * MAP);
  for (let k = 0; k < MAP * MAP; k++) {
    const i = (start + k * 37) % (MAP * MAP);
    const x = i % MAP;
    const y = (i - x) / MAP;
    if (x + w > MAP || y + h > MAP) continue;
    let ok = true;
    let water = !def.requires;
    for (let yy = y; yy < y + h && ok; yy++)
      for (let xx = x; xx < x + w && ok; xx++) {
        const ti = tileIndex(xx, yy);
        if (!parcelOpen(t, xx, yy) || !buildable(terrain[ti]) || p.use[ti] !== USE_EMPTY) ok = false;
      }
    if (!ok) continue;
    if (def.requires === 'water' || def.requires === 'river' || def.requires === 'coast') {
      for (let yy = y - 1; yy <= y + h && !water; yy++)
        for (let xx = x - 1; xx <= x + w && !water; xx++) if (xx >= 0 && yy >= 0 && xx < MAP && yy < MAP && (terrain[tileIndex(xx, yy)] & 7) === 1) water = true;
      if (!water) continue;
    }
    t.buildings.push(newBuilding(kind, x, y, 0, Math.max(0, t.tick - 40), t.funding[0] ?? 1));
    reindexBuildings(t);
    return true;
  }
  return false;
}

function buildTown(c: CountyState, kind: FixtureKind): number {
  const r = RECIPES[kind];
  const now = FIXTURE_EPOCH + 1000;
  applyCommand(c, kind, { type: 'found', site: FIXTURE_SITE[kind], nameParts: kind === 'hamlet' ? ['Sunny', 'vale'] : kind === 'town' ? ['Oak', 'ridge'] : ['Kestrel', 'haven'], avatar: 'badger', flag: FIXTURE_SITE[kind] }, now);
  const i = c.towns.findIndex((t) => t.seat === kind);
  const t = c.towns[i];
  t.tier = r.tier;
  t.parcels = r.parcels;
  const terrain = terrainOf(t);
  const p = planesForWrite(t);
  const near = (x: number, y: number) => Math.abs(x - 33) + Math.abs(y - 42) <= r.radius * 1.4 && Math.max(Math.abs(x - 33), Math.abs(y - 42)) <= r.radius;

  // A road grid over the open land (the County Road stays where it is).
  const county = roadUse(ROAD_KINDS.indexOf('county'));
  const main = roadUse(ROAD_KINDS.indexOf(r.main));
  const side = roadUse(ROAD_KINDS.indexOf(r.tier >= 1 ? 'street' : 'lane'));
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) {
      const ti = tileIndex(x, y);
      if (!parcelOpen(t, x, y) || !buildable(terrain[ti]) || p.use[ti] !== USE_EMPTY || !near(x, y)) continue;
      const onGrid = x % r.spacing === 2 || y % r.spacing === 2;
      if (onGrid) p.use[ti] = (x % (r.spacing * 2) === 2 || y % (r.spacing * 2) === 2) ? main : side;
    }
  // The County Road must stay county.
  for (let y = 0; y < MAP; y++) if (p.use[tileIndex(32, y)] === main || p.use[tileIndex(32, y)] === side) if (y >= 44) p.use[tileIndex(32, y)] = county;
  commitPlanes(t);

  // Civic buildings first (they want big free blocks), then zones fill the rest.
  r.buildings.forEach((id, k) => placeAnywhere(t, id, k));
  const w = planesForWrite(t);
  const cum = r.mix.map((_, k) => r.mix.slice(0, k + 1).reduce((a, b) => a + b, 0));
  const zoneOrder = [Z_HOMES, Z_SHOPS, Z_LEISURE, Z_INDUSTRY, Z_OFFICES, Z_FARMS];
  for (let ti = 0; ti < MAP * MAP; ti++) {
    const x = ti % MAP;
    const y = (ti - x) / MAP;
    if (!parcelOpen(t, x, y) || !buildable(terrain[ti]) || w.use[ti] !== USE_EMPTY || !near(x, y)) continue;
    const u = (h32(t.seed, 98, ti, 0, 0) >>> 0) / 4294967296;
    let z = zoneOrder[cum.findIndex((c2) => u < c2)] ?? Z_HOMES;
    const def = ZONE_DEFS[z];
    let cap = def.tierCap[r.tier];
    if (cap === 0) {
      z = Z_HOMES;
      cap = ZONE_DEFS[Z_HOMES].tierCap[r.tier];
    }
    if (z === Z_HOMES && (terrain[ti] & TF_RIVER) && cap > 3) cap = 3; // flood plain: no L4+
    if (r.levelCap !== undefined) cap = Math.min(cap, Math.max(ZONE_DEFS[z].minLevel, r.levelCap));
    const minLevel = ZONE_DEFS[z].minLevel;
    const lvl = Math.max(minLevel, 1 + (h32(t.seed, 97, ti, 0, 0) % cap));
    const tu = (h32(t.seed, 96, ti, 0, 0) >>> 0) / 4294967296;
    const tier = z === Z_HOMES ? (tu < r.tiers[0] ? 0 : tu < r.tiers[0] + r.tiers[1] ? 1 : 2) : 0;
    w.use[ti] = zoneUse(z);
    w.lvl[ti] = makeLvl(Math.min(lvl, cap), tier, h32(t.seed, 95, ti, 0, 0) & 7);
    w.age[ti] = Math.min(255, 6 + (h32(t.seed, 94, ti, 0, 0) % 200));
  }
  commitPlanes(t);

  // Land value: the terrain base plus the town's maturity.
  const lv = new Uint8Array(CELLS);
  for (let k = 0; k < CELLS; k++) lv[k] = Math.min(250, 30 + r.lvBoost + (h32(t.seed, 93, k, 0, 0) % 30));
  t.lv = encodeCells(lv);

  // People: fill Homes capacity by tier at the recipe's occupancy.
  const cap = [0, 0, 0];
  const pl = planesOf(t);
  for (let ti = 0; ti < MAP * MAP; ti++) {
    if (useCat(pl.use[ti]) !== 3 || (pl.use[ti] & 0xfff) !== Z_HOMES) continue;
    const level = pl.lvl[ti] & 7;
    if (level > 0) cap[(pl.lvl[ti] >> 3) & 3] += ZONE_DEFS[Z_HOMES].capacity[level - 1];
  }
  for (let h = 0; h < 3; h++) {
    const n = Math.floor(cap[h] * r.occupancy);
    const parents = Math.floor(n * 0.24);
    const children = Math.floor(n * 0.24);
    const retirees = Math.floor(n * 0.14);
    t.people[person(STAGE_P, h)] = parents;
    t.people[person(STAGE_C, h)] = children;
    t.people[person(STAGE_R, h)] = retirees;
    t.people[person(STAGE_W, h)] = n - parents - children - retirees;
  }
  if (t.buildings.some((b) => b[0] === buildingIndex('university'))) t.people[PERSON_S] = 2400;

  // Stocks and money that fit the tier.
  t.money.reserves = r.reserves;
  t.edu = [20, 30, 55, 70, 80][r.tier];
  t.culture = [0, 20, 150, 400, 900][r.tier];
  t.perceived = t.perceived.map((_, k) => 45 + (h32(t.seed, 92, k, 0, 0) % 25));
  t.parcelRights = 0;

  // The clock: the town has finished its fortnight and stands on the grid `days` after the epoch.
  const at = FIXTURE_EPOCH + r.days * DAY;
  const g = gridTickAt(c, at);
  t.sprintLeft = 0;
  t.sprintAt = now;
  t.tick = Math.max(12, g - (g % 4)); // a month boundary
  t.gridBase = g - t.tick;
  rollMonthBooks(t);
  return i;
}

const CACHE: Partial<Record<FixtureKind, string>> = {};

/** A golden fixture: a fresh deep copy every call. */
export function fixture(kind: FixtureKind): Fixture {
  if (!CACHE[kind]) {
    const c = newCounty(FIXTURE_SEED[kind]);
    const town = buildTown(c, kind);
    const r = RECIPES[kind];
    const at = FIXTURE_EPOCH + r.days * DAY;
    // The county clock: every Regional Day up to `at` has run (with no economy to settle).
    while (nextRegionalDayAt(c) <= at) {
      c.lastRegionalDayAt = nextRegionalDayAt(c);
      c.dayIndex += 1;
    }
    c.gridTick = gridTickAt(c, at);
    c.lastHelloAt = at;
    c.towns[town].away.lastHelloAt = at;
    c.towns[town].grace = null;
    c.snapshot = snapshotOf(c, c.lastRegionalDayAt, countyMonth(c.gridTick));
    c.snapshot.dayIndex = c.dayIndex - 1;
    CACHE[kind] = JSON.stringify({ kind, county: c, town, now: at } satisfies Fixture);
  }
  return JSON.parse(CACHE[kind]!) as Fixture;
}

export const FIXTURE_KINDS: readonly FixtureKind[] = ['hamlet', 'town', 'metropolis'];

/** Population of the fixture town (a convenience for tests and the Lab). */
export function fixturePopulation(f: Fixture): number {
  return population(f.county.towns[f.town]);
}

