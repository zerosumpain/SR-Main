// The render model: a pure mapping from a TownState to what the map draws
// (spec §12.2 tests "the render-model mapping"). Nothing here touches Pixi or
// the DOM, so the colours, lens steps and building rectangles are unit-tested
// in Node and the Pixi layer stays a thin painter.
//
// M0 draws the map top-down, one square per tile. The soft 2:1 isometric
// "toy-town" look (§9.15) is WP6's renderer; it can reuse this model, since
// the model is in tile space and says nothing about projection.

import {
  BUILDINGS,
  B_DAMAGED,
  B_KIND,
  B_ROT,
  B_X,
  B_Y,
  CAT_BUILDING,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  CELLS_PER_SIDE,
  MAP,
  ROAD_KINDS,
  TILES,
  cellOf,
  constructionLeft,
  decodeCells,
  footprint,
  lvlLevel,
  lvlTier,
  parcelOpen,
  planesOf,
  roadAccess,
  terrainKind,
  terrainOf,
  tileIndex,
  useCat,
  usePayload,
  type BuildingDef,
  type TownState,
} from '../engine';
import { BUILDING_GROUP, LOCKED_SHADE, RAIL, ROADS, TERRAIN, ZONE_BUILT, ZONE_LOT, LENS_RAMP, grey, mix, shade } from './palette';

export const LENSES = ['none', 'landValue', 'pollution', 'access', 'development'] as const;
export type Lens = (typeof LENSES)[number];

export interface LensDef {
  id: Lens;
  label: string;
  /** Five step labels, low to high (the legend). */
  legend: readonly string[];
}

export const LENS_DEFS: Record<Lens, LensDef> = {
  none: { id: 'none', label: 'Map', legend: [] },
  landValue: { id: 'landValue', label: 'Land value', legend: ['under 40', '40–69', '70–99', '100–139', '140 and up'] },
  pollution: { id: 'pollution', label: 'Pollution', legend: ['clean', 'a little', 'some', 'smoky', 'very smoky'] },
  access: { id: 'access', label: 'Road access', legend: ['no road near', '', '', '', 'road within 2'] },
  development: { id: 'development', label: 'Development', legend: ['empty', 'level 1', 'level 2', 'level 3', 'level 4–5'] },
};

/** Step thresholds: a value at or above thresholds[k] reaches step k + 1. */
const LV_STEPS = [40, 70, 100, 140];
const POLL_STEPS = [5, 20, 40, 70];

/** Which of the five lens steps (0–4) a value falls in. */
export function step5(v: number, thresholds: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < thresholds.length && k < 4; k++) if (v >= thresholds[k]) s = k + 1;
  return s;
}

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
  /** Development level per zoned tile (0 for anything else): the map draws a block whose size grows with it. */
  level: Uint8Array;
  /** Wealth tier per built zoned tile (0–2), for the block's trim. */
  tier: Uint8Array;
  /** Colour of the built block per tile (0 where level is 0). */
  block: Uint32Array;
  /** 1 where a zoned tile is under construction (scaffolding). */
  scaffold: Uint8Array;
  /** Lens step per tile (0–4), or 255 where the lens says nothing (or no lens). */
  lens: Uint8Array;
  buildings: BuildingRect[];
}

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

function lensSteps(t: TownState, lens: Lens): Uint8Array {
  const out = new Uint8Array(TILES).fill(255);
  if (lens === 'none') return out;
  const p = planesOf(t);
  if (lens === 'landValue' || lens === 'pollution') {
    const cells = decodeCells(lens === 'landValue' ? t.lv : t.lag.poll);
    const th = lens === 'landValue' ? LV_STEPS : POLL_STEPS;
    for (let i = 0; i < TILES; i++) out[i] = step5(cells[cellOf(i)], th);
    return out;
  }
  if (lens === 'access') {
    const mask = roadAccess(t);
    for (let i = 0; i < TILES; i++) {
      const x = i % MAP;
      const y = (i - x) / MAP;
      if (!parcelOpen(t, x, y) || useCat(p.use[i]) === CAT_ROAD) continue;
      out[i] = mask[i] ? 4 : 0;
    }
    return out;
  }
  // development
  for (let i = 0; i < TILES; i++) {
    if (useCat(p.use[i]) !== CAT_ZONE) continue;
    out[i] = Math.min(4, lvlLevel(p.lvl[i]));
  }
  return out;
}

/** The whole map's render model for one lens. */
export function mapModel(t: TownState, lens: Lens = 'none'): MapModel {
  const p = planesOf(t);
  const ground = new Uint32Array(TILES);
  const level = new Uint8Array(TILES);
  const tier = new Uint8Array(TILES);
  const block = new Uint32Array(TILES);
  const scaffold = new Uint8Array(TILES);
  const terrain = terrainOf(t);
  for (let i = 0; i < TILES; i++) {
    ground[i] = groundColour(t, i, p, terrain);
    const u = p.use[i];
    if (useCat(u) !== CAT_ZONE) continue;
    const z = usePayload(u);
    const lv = lvlLevel(p.lvl[i]);
    level[i] = lv;
    tier[i] = lvlTier(p.lvl[i]);
    if (lv > 0) block[i] = shade(ZONE_BUILT[z] ?? 0x999999, 1.08 - 0.06 * lv);
    if (constructionLeft(t, i) > 0) scaffold[i] = 1;
  }
  const lensStep = lensSteps(t, lens);
  if (lens !== 'none') for (let i = 0; i < TILES; i++) {
    // A lens greys the map so the field reads on its own (§9.4).
    ground[i] = grey(ground[i]);
    if (block[i]) block[i] = grey(block[i]);
    if (lensStep[i] !== 255) ground[i] = mix(ground[i], LENS_RAMP[lensStep[i]], 0.8);
  }
  return { ground, level, tier, block, scaffold, lens: lensStep, buildings: buildingRects(t) };
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

/** A lens cell's raw value, for the inspector ("why is it 140 here?" starts with the number). */
export function cellValue(t: TownState, lens: Lens, x: number, y: number): number | null {
  if (lens !== 'landValue' && lens !== 'pollution') return null;
  const cells = decodeCells(lens === 'landValue' ? t.lv : t.lag.poll);
  return cells[(y >> 1) * CELLS_PER_SIDE + (x >> 1)];
}

/** One-line description of a tile for the inspector. */
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
    const zone = ['homes', 'shops', 'leisure', 'industry', 'offices', 'farms'][usePayload(u)] ?? 'zone';
    const lv = lvlLevel(p.lvl[i]);
    const left = constructionLeft(t, i);
    const money = ['£', '££', '£££'][lvlTier(p.lvl[i])] ?? '';
    if (lv === 0) return `${where} ${zone} lot${left > 0 ? ' (being built)' : ' (for sale)'}`;
    return `${where} ${zone} level ${lv}${usePayload(u) === 0 ? ` ${money}` : ''}${left > 0 ? ' (building)' : ''}`;
  }
  const kinds = ['grass', 'water', 'sand', 'forest', 'hill', 'rock'];
  return `${where} ${kinds[terrainKind(terrainOf(t)[i])] ?? 'land'}`;
}
