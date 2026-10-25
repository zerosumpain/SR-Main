// A small kit for building hand-made towns tile by tile, for the space
// package's tests (WP2a: utilities, fields, services, safety, land value,
// transport) and for the Lab's scripted scenarios. Everything goes through
// the real stored fields (planes, buildings, construction, people), so what a
// test builds is exactly what a month step reads.
//
//   const k = kitTown();                       // an empty flat grass map, all parcels open
//   road(k.t, 10, 10, 30, 10, 'street');
//   zone(k.t, 12, 11, 'homes', 2);              // a built L2 £ Homes tile
//   place(k.t, 'windmill', 14, 11);
//   const m = monthOf(k);                       // a fresh MonthContext for the next month step

import { BUILDINGS, buildingIndex } from '../../src/lib/games/hometowns/engine/content';
import { foundTown } from '../../src/lib/games/hometowns/engine/county';
import { newDerivedCache } from '../../src/lib/games/hometowns/engine/derived';
import { reindexBuildings } from '../../src/lib/games/hometowns/engine/ops';
import { T_GRASS } from '../../src/lib/games/hometowns/engine/terrain';
import { makeContext } from '../../src/lib/games/hometowns/engine/tick';
import {
  ALL_PARCELS,
  CELLS,
  MAP,
  RAIL_USE,
  TILES,
  USE_EMPTY,
  commitPlanes,
  emptyPlanes,
  encodeCells,
  encodePlanes,
  makeLvl,
  newBuilding,
  pairSet,
  planesForWrite,
  roadUse,
  tileIndex,
  zoneUse,
} from '../../src/lib/games/hometowns/engine/tiles';
import { ROAD_KINDS, ZONES, person, type CountyState, type MonthContext, type SiteKind, type TownState, type ZoneKind } from '../../src/lib/games/hometowns/engine/types';
import { MonthWhy } from '../../src/lib/games/hometowns/engine/why';
import { newCounty } from './fixture';

export interface Kit {
  c: CountyState;
  t: TownState;
  i: number;
}

/**
 * A founded town with everything cleared: no roads, no Town Hall, all 16
 * parcels open, flat grass terrain (unless `natural`), nobody living there,
 * land value `lv` everywhere, on the county grid so it can step months.
 */
export function kitTown(o: { site?: SiteKind; natural?: boolean; lv?: number; tier?: 0 | 1 | 2 | 3 | 4; seed?: number } = {}): Kit {
  const c = newCounty(o.seed ?? 11);
  foundTown(c, 'kit', { site: 0, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: 0 }, c.epoch + 1000);
  const i = c.towns.length - 1;
  const t = c.towns[i];
  t.siteKind = o.site ?? 'flatland';
  t.planes = encodePlanes(emptyPlanes());
  t.buildings = [];
  t.construction = [];
  t.marks = [];
  t.parcels = ALL_PARCELS;
  t.tier = o.tier ?? 2;
  t.sprintLeft = 0;
  t.gridBase = 0;
  t.tick = 3;
  t.lv = encodeCells(new Uint8Array(CELLS).fill(o.lv ?? 60));
  if (!o.natural) {
    const edits: number[] = [];
    for (let k = 0; k < TILES; k++) edits.push(k, T_GRASS);
    t.terrainEdits = edits;
  }
  return { c, t, i };
}

/** A straight road (horizontal or vertical) from (x0, y0) to (x1, y1), inclusive. */
export function road(t: TownState, x0: number, y0: number, x1: number, y1: number, kind: (typeof ROAD_KINDS)[number] | 'rail' = 'street'): void {
  const p = planesForWrite(t);
  const u = kind === 'rail' ? RAIL_USE : roadUse(ROAD_KINDS.indexOf(kind));
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    p.use[tileIndex(x, y)] = u;
    if (x === x1 && y === y1) break;
    x += dx;
    y += dy;
  }
  commitPlanes(t);
}

/** A zoned tile at a level (0 = an empty zoned lot) and tier (Homes) or variant. */
export function zone(t: TownState, x: number, y: number, z: ZoneKind, level = 1, tier = 0): number {
  const p = planesForWrite(t);
  const i = tileIndex(x, y);
  p.use[i] = zoneUse(ZONES.indexOf(z));
  p.lvl[i] = makeLvl(level, tier, 0);
  p.age[i] = 12;
  commitPlanes(t);
  return i;
}

/** Zones a rectangle. */
export function zoneRect(t: TownState, x: number, y: number, w: number, h: number, z: ZoneKind, level = 1, tier = 0): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) zone(t, xx, yy, z, level, tier);
}

/** Places a catalogue building (built, unless `building`), returning its index. */
export function place(t: TownState, id: string, x: number, y: number, o: { rot?: 0 | 1; building?: boolean; staff?: number; damaged?: number } = {}): number {
  const kind = buildingIndex(id);
  if (kind < 0 || !BUILDINGS[kind]) throw new Error(`no building ${id}`);
  const b = newBuilding(kind, x, y, o.rot ?? 0, 0, 1);
  if (o.staff !== undefined) b[7] = o.staff;
  if (o.damaged) b[6] = o.damaged;
  t.buildings.push(b);
  reindexBuildings(t);
  commitPlanes(t);
  if (o.building) pairSet(t.construction, tileIndex(x, y), 2);
  return t.buildings.length - 1;
}

/** Clears a tile. */
export function clear(t: TownState, x: number, y: number): void {
  planesForWrite(t).use[tileIndex(x, y)] = USE_EMPTY;
  commitPlanes(t);
}

/** Sets the person stocks of a tier: Workers, Parents, Children, Retirees. */
export function people(t: TownState, h: number, w: number, pa = 0, ch = 0, re = 0): void {
  t.people[person(0, h)] = w;
  t.people[person(1, h)] = pa;
  t.people[person(2, h)] = ch;
  t.people[person(3, h)] = re;
}

/** A fresh MonthContext for the town's current tick (a month step's view). */
export function monthOf(k: Kit): MonthContext {
  const ctx = makeContext(k.c, k.i, k.t.tick);
  return { ...ctx, month: ctx.world.month, derived: newDerivedCache(), why: new MonthWhy() };
}

export const MAP_SIZE = MAP;
