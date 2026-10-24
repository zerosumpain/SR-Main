// The tile layer (spec §3.1–§3.2): a 64×64 map in 16 parcels of 16×16, three
// stored planes (use, lvl, age) packed into `TownState.planes`, the sparse
// construction and mark lists, and the building records.
//
// The stored form is a string (base64 of a planar RLE), which is what JSON
// and the state hash see. Working on it directly would mean decoding on every
// read, so the engine keeps a decoded copy per TownState object: planesOf(t)
// for reading, planesForWrite(t) before changing anything, and commitPlanes(t)
// (the driver calls it after every tick and command) to write the string back.
// The copy is keyed on the stored string itself, so a revived or reverted town
// can never be served a stale decode.

import { decodeU8, encodeU8, fromBase64, rleDecode, rleEncode, toBase64 } from './codec';
import type { BuildingRecord, TownState } from './types';

export const MAP = 64;
export const TILES = MAP * MAP;
export const PARCEL = 16;
export const PARCELS_PER_SIDE = 4;
/** Fields live on 32×32 cells of 2×2 tiles. */
export const CELLS_PER_SIDE = 32;
export const CELLS = CELLS_PER_SIDE * CELLS_PER_SIDE;
/** 64 districts of 8×8 tiles (transport, §5.9). */
export const DISTRICT = 8;
export const DISTRICTS_PER_SIDE = 8;
export const DISTRICTS = 64;

/** The four central parcels open at founding (§3.1). */
export const CENTRAL_PARCELS = (1 << 5) | (1 << 6) | (1 << 9) | (1 << 10);
export const ALL_PARCELS = 0xffff;

export const tileIndex = (x: number, y: number): number => y * MAP + x;
export const tileX = (i: number): number => i % MAP;
export const tileY = (i: number): number => (i - (i % MAP)) / MAP;
export const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP && y < MAP;
export const cellOf = (i: number): number => ((tileY(i) >> 1) * CELLS_PER_SIDE) + (tileX(i) >> 1);
export const districtOf = (i: number): number => ((tileY(i) >> 3) * DISTRICTS_PER_SIDE) + (tileX(i) >> 3);
export const parcelOf = (x: number, y: number): number => (y >> 4) * PARCELS_PER_SIDE + (x >> 4);
export const parcelOpen = (t: TownState, x: number, y: number): boolean => ((t.parcels >> parcelOf(x, y)) & 1) === 1;

/** Parcels orthogonally adjacent to an open one (the ones a mayor may survey next). */
export function openableParcels(open: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < 16; p++) {
    if ((open >> p) & 1) continue;
    const px = p % 4;
    const py = (p - px) / 4;
    const n = [px > 0 ? p - 1 : -1, px < 3 ? p + 1 : -1, py > 0 ? p - 4 : -1, py < 3 ? p + 4 : -1];
    if (n.some((q) => q >= 0 && (open >> q) & 1)) out.push(p);
  }
  return out;
}

// ---- The `use` plane (u16): category in the top 4 bits, payload in the low 12 ---------

export const USE_EMPTY = 0;
export const CAT_ROAD = 1;
export const CAT_RAIL = 2;
export const CAT_ZONE = 3;
export const CAT_BUILDING = 4;
export const useCat = (u: number): number => u >>> 12;
export const usePayload = (u: number): number => u & 0xfff;
/** Road kind is an index into ROAD_KINDS (lane, street, avenue, county). */
export const roadUse = (kind: number): number => (CAT_ROAD << 12) | kind;
export const RAIL_USE = CAT_RAIL << 12;
/** Zone kind is an index into ZONES. */
export const zoneUse = (zone: number): number => (CAT_ZONE << 12) | zone;
/** A building tile points at its index in TownState.buildings. */
export const buildingUse = (index: number): number => (CAT_BUILDING << 12) | index;
export const isRoad = (u: number): boolean => useCat(u) === CAT_ROAD;
export const isZone = (u: number): boolean => useCat(u) === CAT_ZONE;

// ---- The `lvl` plane (u8): level 0–5 (3 bits) · tier or variant (2 bits) · style (3 bits)

export const lvlLevel = (l: number): number => l & 7;
export const lvlTier = (l: number): number => (l >> 3) & 3;
export const lvlStyle = (l: number): number => (l >> 5) & 7;
export const makeLvl = (level: number, tier: number, style: number): number => (level & 7) | ((tier & 3) << 3) | ((style & 7) << 5);
/** Leisure's variant bits: 0 café/restaurant/cinema, 1 hotel. */
export const VARIANT_HOTEL = 1;

// ---- Marks (sparse [tile, bits] pairs) ---------------------------------------------------

export const MARK_DAMAGED = 1;
export const MARK_AFFORDABLE = 2;
export const MARK_HERITAGE = 4;
export const MARK_CARFREE = 8;

// ---- Building records ------------------------------------------------------------------------

export const B_KIND = 0;
export const B_X = 1;
export const B_Y = 2;
export const B_ROT = 3;
export const B_BUILT = 4;
export const B_FUND = 5;
/** Ticks left closed by an incident (0 = open). */
export const B_DAMAGED = 6;
/** Staff filled per mille, written by WP2b labour (M5), read by WP2a coverage next month (A26). */
export const B_STAFF = 7;
export const B_FIELDS = 8;

export function newBuilding(kind: number, x: number, y: number, rot: number, tick: number, funding: number): BuildingRecord {
  return [kind, x, y, rot, tick, funding, 0, 1000];
}

/** Footprint w×h after rotation (rot 1 swaps the sides). */
export function footprint(w: number, h: number, rot: number): [number, number] {
  return rot === 1 ? [h, w] : [w, h];
}

// ---- Planes --------------------------------------------------------------------------------------

export interface Planes {
  use: Uint16Array;
  lvl: Uint8Array;
  age: Uint8Array;
}

export function emptyPlanes(): Planes {
  return { use: new Uint16Array(TILES), lvl: new Uint8Array(TILES), age: new Uint8Array(TILES) };
}

/** Planar bytes: use low bytes, use high bytes, lvl, age; then RLE and base64. */
export function encodePlanes(p: Planes): string {
  const bytes = new Uint8Array(TILES * 4);
  for (let i = 0; i < TILES; i++) {
    bytes[i] = p.use[i] & 255;
    bytes[TILES + i] = p.use[i] >>> 8;
    bytes[2 * TILES + i] = p.lvl[i];
    bytes[3 * TILES + i] = p.age[i];
  }
  return toBase64(rleEncode(bytes));
}

export function decodePlanes(s: string): Planes {
  const bytes = rleDecode(fromBase64(s), TILES * 4);
  const p = emptyPlanes();
  for (let i = 0; i < TILES; i++) {
    p.use[i] = bytes[i] | (bytes[TILES + i] << 8);
    p.lvl[i] = bytes[2 * TILES + i];
    p.age[i] = bytes[3 * TILES + i];
  }
  return p;
}

interface PlaneEntry {
  src: string;
  planes: Planes;
  dirty: boolean;
  /** Bumped on every write access: keys derived memos (road access). */
  version: number;
  roadAccess: { version: number; reach: number; mask: Uint8Array } | null;
}

const PLANE_CACHE = new WeakMap<TownState, PlaneEntry>();

function entryOf(t: TownState): PlaneEntry {
  let e = PLANE_CACHE.get(t);
  if (!e || (!e.dirty && e.src !== t.planes)) {
    e = { src: t.planes, planes: decodePlanes(t.planes), dirty: false, version: 0, roadAccess: null };
    PLANE_CACHE.set(t, e);
  }
  return e;
}

/** The decoded planes, for reading. Do not mutate: use planesForWrite. */
export function planesOf(t: TownState): Planes {
  return entryOf(t).planes;
}

/** The decoded planes, marked dirty so the next commit writes them back. */
export function planesForWrite(t: TownState): Planes {
  const e = entryOf(t);
  e.dirty = true;
  e.version++;
  e.roadAccess = null;
  return e.planes;
}

/** Writes dirty planes back to t.planes (and bumps planesRev). Returns whether anything changed. */
export function commitPlanes(t: TownState): boolean {
  const e = PLANE_CACHE.get(t);
  if (!e || !e.dirty) return false;
  const s = encodePlanes(e.planes);
  e.dirty = false;
  e.src = s;
  if (s === t.planes) return false;
  t.planes = s;
  t.planesRev += 1;
  return true;
}

/** Drops the decoded copy (after a revert replaced the stored fields). */
export function forgetPlanes(t: TownState): void {
  PLANE_CACHE.delete(t);
}

/**
 * Per tile, 1 where a road (not rail) lies within `reach` tiles (Chebyshev
 * distance): "a zoned tile needs a road within 2 tiles" (§3.4). Memoised on
 * the planes' write version.
 */
export function roadAccess(t: TownState, reach = 2): Uint8Array {
  const e = entryOf(t);
  if (e.roadAccess && e.roadAccess.version === e.version && e.roadAccess.reach === reach) return e.roadAccess.mask;
  const use = e.planes.use;
  const mask = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) {
    if (!isRoad(use[i])) continue;
    const x = tileX(i);
    const y = tileY(i);
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (inMap(xx, yy)) mask[tileIndex(xx, yy)] = 1;
      }
  }
  e.roadAccess = { version: e.version, reach, mask };
  return mask;
}

// ---- Sparse pair lists ([tile, value, tile, value, …], kept sorted by tile) ----------------

export function pairGet(list: number[], tile: number): number {
  for (let i = 0; i < list.length; i += 2) if (list[i] === tile) return list[i + 1];
  return 0;
}

/** Sets (or, for 0, removes) a pair, keeping the list sorted by tile so its JSON is canonical. */
export function pairSet(list: number[], tile: number, value: number): void {
  for (let i = 0; i < list.length; i += 2) {
    if (list[i] === tile) {
      if (value === 0) list.splice(i, 2);
      else list[i + 1] = value;
      return;
    }
    if (list[i] > tile) {
      if (value !== 0) list.splice(i, 0, tile, value);
      return;
    }
  }
  if (value !== 0) list.push(tile, value);
}

export const constructionLeft = (t: TownState, tile: number): number => pairGet(t.construction, tile);
export const marksAt = (t: TownState, tile: number): number => pairGet(t.marks, tile);

// ---- Land value and lag planes (u8 32×32) ----------------------------------------------------------

export function encodeCells(plane: Uint8Array): string {
  return encodeU8(plane);
}

export function decodeCells(s: string): Uint8Array {
  return decodeU8(s, CELLS);
}

/** A 32×32 skyline height map (max level over each 2×2 cell) for the County view. */
export function skylineOf(t: TownState): string {
  const p = planesOf(t);
  const h = new Uint8Array(CELLS);
  for (let i = 0; i < TILES; i++) {
    const u = p.use[i];
    let v = 0;
    if (useCat(u) === CAT_ZONE) v = lvlLevel(p.lvl[i]);
    else if (useCat(u) === CAT_BUILDING) v = 2;
    const c = cellOf(i);
    if (v > h[c]) h[c] = v;
  }
  return encodeCells(h);
}
