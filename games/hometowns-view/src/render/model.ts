// The render model: a pure mapping from a TownState to what the map draws
// (spec §12.2 tests "the render-model mapping"). Nothing here touches Pixi or
// the DOM, so the colours, lens steps and building rectangles are unit-tested
// in Node and the Pixi layer stays a thin painter. The model is in tile
// space and says nothing about projection: the painter draws it as soft 2:1
// isometric (§9.15) or as the flat top-down planning view (§9.3).

import {
  BUILDINGS,
  B_DAMAGED,
  B_KIND,
  CAT_BUILDING,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  B_X,
  B_Y,
  B_ROT,
  MAP,
  ROAD_KINDS,
  TILES,
  constructionLeft,
  footprint,
  lvlLevel,
  lvlTier,
  parcelOpen,
  planesOf,
  terrainKind,
  terrainOf,
  tileIndex,
  useCat,
  usePayload,
  ZONES,
  type BuildingDef,
  type TownState,
} from '../engine';
import type { LensData } from '../lenses';
import { BUILDING_GROUP, LOCKED_SHADE, RAIL, ROADS, TERRAIN, ZONE_BUILT, ZONE_LOT, LENS_RAMP, grey, mix, shade } from './palette';

/** Time-lapse mask values per tile (§9.9): how a tile looks before its event has "happened". */
export const MASK_SHOWN = 0;
export const MASK_TERRAIN = 1;
export const MASK_LOT = 2;
export const MASK_SCAFFOLD = 3;

export interface BuildingRect {
  index: number;
  id: string;
  name: string;
  group: BuildingDef['group'];
  x: number;
  y: number;
  w: number;
  h: number;
  colour: number;
  /** Ticks of construction left at the anchor (0 when open). */
  building: number;
  damaged: boolean;
}

export interface MapModel {
  /** Ground colour per tile (terrain, roads, zones), 0xRRGGBB. */
  ground: Uint32Array;
  /** Development level per zoned tile (0 for anything else): the block's height grows with it. */
  level: Uint8Array;
  /** Wealth tier per built zoned tile (0–2), for the block's trim. */
  tier: Uint8Array;
  /** Colour of the built block per tile (0 where level is 0). */
  block: Uint32Array;
  /** 1 where a zoned tile is under construction (scaffolding). */
  scaffold: Uint8Array;
  /** Lens step per tile (0–4), or 255 where the lens says nothing (or no lens). */
  lens: Uint8Array;
  /** True while a lens greys the map: the painter greys its own trim colours too. */
  lensOn: boolean;
  /** What the painter dresses each tile as (time-lapse masks applied): */
  /** road kind + 1 (ROAD_KINDS), RAIL_TILE for a railway, 0 for anything else. */
  road: Uint8Array;
  /** zone + 1 (ZONES) on a zoned tile, else 0. */
  zone: Uint8Array;
  /** TERRAIN_KINDS index under the tile. */
  terrain: Uint8Array;
  /** 1 under a placed building's footprint. */
  built: Uint8Array;
  /** 1 on land in an open parcel (the town's own land). */
  open: Uint8Array;
  buildings: BuildingRect[];
}

/** `road` value for a railway tile. */
export const RAIL_TILE = 9;

/**
 * The ground colour of one tile, before any lens. `planes` and `terrain`
 * may be passed in by a caller looping over every tile (mapModel), since
 * looking them up per tile costs more than the colour itself.
 */
export function groundColour(t: TownState, i: number, planes = planesOf(t), terrain = terrainOf(t)): number {
  const u = planes.use[i];
  const cat = useCat(u);
  const x = i % MAP;
  const y = (i - x) / MAP;
  let c: number;
  if (cat === CAT_ROAD) c = ROADS[ROAD_KINDS[usePayload(u)]] ?? ROADS.lane;
  else if (cat === CAT_RAIL) c = RAIL;
  else if (cat === CAT_ZONE) c = ZONE_LOT[usePayload(u)] ?? TERRAIN[0];
  else c = TERRAIN[terrainKind(terrain[i])] ?? TERRAIN[0];
  // Locked parcels read as "not yours yet" (the County Road still shows through).
  if (cat !== CAT_ROAD && !parcelOpen(t, x, y)) c = shade(c, LOCKED_SHADE);
  return c;
}

/**
 * The whole map's render model. `lens` greys the map and lays the field's
 * steps over it (§9.4); `mask` hides tiles the time-lapse has not reached.
 */
export function mapModel(t: TownState, lens: LensData | null = null, mask: Uint8Array | null = null): MapModel {
  const p = planesOf(t);
  const ground = new Uint32Array(TILES);
  const level = new Uint8Array(TILES);
  const tier = new Uint8Array(TILES);
  const block = new Uint32Array(TILES);
  const scaffold = new Uint8Array(TILES);
  const road = new Uint8Array(TILES);
  const zone = new Uint8Array(TILES);
  const kind = new Uint8Array(TILES);
  const built = new Uint8Array(TILES);
  const open = new Uint8Array(TILES);
  const terrain = terrainOf(t);
  for (let i = 0; i < TILES; i++) {
    const m = mask ? mask[i] : MASK_SHOWN;
    kind[i] = terrainKind(terrain[i]);
    const x = i % MAP;
    open[i] = parcelOpen(t, x, (i - x) / MAP) ? 1 : 0;
    if (m === MASK_TERRAIN) {
      ground[i] = TERRAIN[kind[i]] ?? TERRAIN[0];
      continue;
    }
    ground[i] = groundColour(t, i, p, terrain);
    const u = p.use[i];
    const cat = useCat(u);
    if (cat === CAT_ROAD) road[i] = usePayload(u) + 1;
    else if (cat === CAT_RAIL) road[i] = RAIL_TILE;
    else if (cat === CAT_BUILDING) built[i] = 1;
    if (cat !== CAT_ZONE) continue;
    zone[i] = usePayload(u) + 1;
    if (m === MASK_LOT || m === MASK_SCAFFOLD) {
      scaffold[i] = m === MASK_SCAFFOLD ? 1 : 0;
      continue;
    }
    const z = usePayload(u);
    const lv = lvlLevel(p.lvl[i]);
    level[i] = lv;
    tier[i] = lvlTier(p.lvl[i]);
    if (lv > 0) block[i] = shade(ZONE_BUILT[z] ?? 0x999999, 1.08 - 0.06 * lv);
    if (constructionLeft(t, i) > 0) scaffold[i] = 1;
  }
  const steps = lens ? lens.steps : new Uint8Array(TILES).fill(255);
  if (lens) for (let i = 0; i < TILES; i++) {
    // A lens greys the map so the field reads on its own (§9.4).
    ground[i] = grey(ground[i]);
    if (block[i]) block[i] = grey(block[i]);
    if (steps[i] !== 255) {
      ground[i] = mix(ground[i], LENS_RAMP[steps[i]], 0.8);
      if (block[i]) block[i] = mix(block[i], LENS_RAMP[steps[i]], 0.7);
    }
  }
  const buildings = buildingRects(t).filter((b) => !mask || mask[tileIndex(b.x, b.y)] === MASK_SHOWN || mask[tileIndex(b.x, b.y)] === MASK_SCAFFOLD);
  if (mask) for (const b of buildings) if (mask[tileIndex(b.x, b.y)] === MASK_SCAFFOLD) b.building = Math.max(1, b.building);
  if (lens) for (const b of buildings) b.colour = grey(b.colour);
  return { ground, level, tier, block, scaffold, lens: steps, lensOn: !!lens, road, zone, terrain: kind, built, open, buildings };
}

/** Placed buildings as rectangles in tile space, in record order. */
export function buildingRects(t: TownState): BuildingRect[] {
  const out: BuildingRect[] = [];
  for (let k = 0; k < t.buildings.length; k++) {
    const b = t.buildings[k];
    const def = BUILDINGS[b[B_KIND]];
    if (!def) continue;
    const [w, h] = footprint(def.w, def.h, b[B_ROT]);
    out.push({
      index: k,
      id: def.id,
      name: def.name,
      group: def.group,
      x: b[B_X],
      y: b[B_Y],
      w,
      h,
      colour: BUILDING_GROUP[def.group] ?? 0x888888,
      building: constructionLeft(t, tileIndex(b[B_X], b[B_Y])),
      damaged: b[B_DAMAGED] > 0,
    });
  }
  return out;
}

const TERRAIN_WORDS = ['grass', 'water', 'sand', 'forest', 'hill', 'rock'];

/** One-line description of a tile for the hover readout. */
export function describeTile(t: TownState, x: number, y: number): string {
  const i = tileIndex(x, y);
  const p = planesOf(t);
  const u = p.use[i];
  const cat = useCat(u);
  const where = `(${x}, ${y})`;
  if (!parcelOpen(t, x, y) && cat !== CAT_ROAD) return `${where} locked land`;
  if (cat === CAT_ROAD) return `${where} ${ROAD_KINDS[usePayload(u)]} road`;
  if (cat === CAT_RAIL) return `${where} railway`;
  if (cat === CAT_BUILDING) {
    const b = t.buildings[usePayload(u)];
    const def = b ? BUILDINGS[b[B_KIND]] : null;
    const left = b ? constructionLeft(t, tileIndex(b[B_X], b[B_Y])) : 0;
    return `${where} ${def ? def.name : 'building'}${left > 0 ? ` (building, ${left} weeks left)` : ''}`;
  }
  if (cat === CAT_ZONE) {
    const zone = ZONES[usePayload(u)] ?? 'zone';
    const lv = lvlLevel(p.lvl[i]);
    const left = constructionLeft(t, i);
    const money = ['£', '££', '£££'][lvlTier(p.lvl[i])] ?? '';
    if (lv === 0) return `${where} ${zone} lot${left > 0 ? ' (being built)' : ' (for sale)'}`;
    return `${where} ${zone} level ${lv}${usePayload(u) === 0 ? ` ${money}` : ''}${left > 0 ? ' (building)' : ''}`;
  }
  return `${where} ${TERRAIN_WORDS[terrainKind(terrainOf(t)[i])] ?? 'land'}`;
}
