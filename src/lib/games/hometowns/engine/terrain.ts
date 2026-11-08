// Site terrain (spec §3.1–§3.2). Terrain is never stored: it regenerates from
// the site's seed and kind, then the town's terrainEdits (cleared forest,
// landfill) are applied on top. Value noise on two lattices gives elevation
// and a forest density; the site kind adds its feature (a river across the
// north of the open land, a sea along the north edge, hills, woods). Every
// map keeps the same dry corridors: the County Road up from the south
// (Kingsport) signpost, and the west and east signposts facing the ring
// neighbours, so no site can wall off a link.

import { STREAMS, h32, u01 } from './rand';
import { MAP, TILES, inMap, tileIndex } from './tiles';
import type { SiteKind, TownState } from './types';

/** Terrain kinds (3 bits). */
export const T_GRASS = 0;
export const T_WATER = 1;
export const T_SAND = 2;
export const T_FOREST = 3;
export const T_HILL = 4;
export const T_ROCK = 5;
export const TERRAIN_KINDS = ['grass', 'water', 'sand', 'forest', 'hill', 'rock'] as const;

export const terrainKind = (v: number): number => v & 7;
export const terrainElevation = (v: number): number => (v >> 3) & 3;
/** Land next to the sea (beach, views) or sea water. */
export const TF_COAST = 1 << 5;
/** River water, or land within 2 tiles of it (the flood plain: no L4+, §3.1). */
export const TF_RIVER = 1 << 6;
export const makeTerrain = (kind: number, elev: number, flags: number): number => (kind & 7) | ((elev & 3) << 3) | flags;

/** Can anything be built here (roads included)? Water and rock cannot. */
export const buildable = (v: number): boolean => terrainKind(v) !== T_WATER && terrainKind(v) !== T_ROCK;

/** Signposts: tiles on the map edge where links enter (§3.1). */
export const SIGNPOST_KINGSPORT = tileIndex(32, MAP - 1);
export const SIGNPOST_WEST = tileIndex(0, 32);
export const SIGNPOST_EAST = tileIndex(MAP - 1, 32);
/** The County Road runs from the Kingsport signpost north to this row (into the open land). */
export const COUNTY_ROAD_X = 32;
export const COUNTY_ROAD_END_Y = 44;
/** The free Town Hall's anchor at founding, beside the end of the County Road. */
export const TOWN_HALL_AT: [number, number] = [33, 44];

function inCorridor(x: number, y: number): boolean {
  if (x >= COUNTY_ROAD_X - 2 && x <= COUNTY_ROAD_X + 3 && y >= COUNTY_ROAD_END_Y - 4) return true; // County Road and Town Hall
  if (y >= 30 && y <= 34 && (x <= 3 || x >= MAP - 4)) return true; // west and east signposts
  return false;
}

/** Smooth value noise in [0, 1): bilinear over a hashed lattice of `step` tiles, smoothstep-eased. */
function valueNoise(seed: number, salt: number, x: number, y: number, step: number): number {
  const gx = Math.floor(x / step);
  const gy = Math.floor(y / step);
  const fx = (x - gx * step) / step;
  const fy = (y - gy * step) / step;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (i: number, j: number) => u01(h32(seed, STREAMS.terrain, salt, gx + i, gy + j));
  const a = v(0, 0) + (v(1, 0) - v(0, 0)) * sx;
  const b = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
  return a + (b - a) * sy;
}

/** Generates the terrain plane for a site (before the town's edits). */
export function generateTerrain(seed: number, kind: SiteKind): Uint8Array {
  const out = new Uint8Array(TILES);
  const elev = new Float64Array(TILES);
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) {
      const e = 0.65 * valueNoise(seed, 1, x, y, 16) + 0.35 * valueNoise(seed, 2, x, y, 8);
      elev[tileIndex(x, y)] = kind === 'hills' ? e * 1.25 : kind === 'flatland' ? e * 0.5 : e;
    }
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) {
      const i = tileIndex(x, y);
      const e = elev[i];
      let k = T_GRASS;
      const woods = valueNoise(seed, 3, x, y, 6);
      const treeAt = kind === 'forest' ? 0.42 : kind === 'flatland' ? 0.8 : 0.66;
      if (woods > treeAt) k = T_FOREST;
      if (kind === 'hills' && e > 0.62) k = T_HILL;
      if (kind === 'hills' && e > 0.95) k = T_ROCK;
      const level = Math.min(3, Math.floor(e * 4));
      out[i] = makeTerrain(k, level, 0);
    }
  if (kind === 'river') carveRiver(seed, out);
  if (kind === 'coast') carveCoast(seed, out);
  // Keep the corridors dry and clear.
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) if (inCorridor(x, y)) out[tileIndex(x, y)] = makeTerrain(T_GRASS, 1, out[tileIndex(x, y)] & TF_COAST);
  return out;
}

/** A river two tiles wide meandering west to east across the north of the open land. */
function carveRiver(seed: number, out: Uint8Array): void {
  const water = new Uint8Array(TILES);
  for (let x = 0; x < MAP; x++) {
    const yc = 20 + Math.floor(6 * (valueNoise(seed, 4, x, 0, 16) - 0.5) * 2);
    for (let dy = 0; dy < 2; dy++) if (inMap(x, yc + dy)) water[tileIndex(x, yc + dy)] = 1;
  }
  for (let i = 0; i < TILES; i++) if (water[i]) out[i] = makeTerrain(T_WATER, 0, TF_RIVER);
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) {
      const i = tileIndex(x, y);
      if (water[i]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) if (inMap(x + dx, y + dy) && water[tileIndex(x + dx, y + dy)]) near = true;
      if (near) out[i] |= TF_RIVER;
    }
}

/** The sea along the north edge, with a sandy beach between sea and land. */
function carveCoast(seed: number, out: Uint8Array): void {
  for (let x = 0; x < MAP; x++) {
    const shore = 8 + Math.floor(8 * valueNoise(seed, 5, x, 0, 12));
    for (let y = 0; y < shore; y++) out[tileIndex(x, y)] = makeTerrain(T_WATER, 0, TF_COAST);
    for (let y = shore; y < shore + 2 && y < MAP; y++) out[tileIndex(x, y)] = makeTerrain(T_SAND, 0, TF_COAST);
    if (shore + 2 < MAP) out[tileIndex(x, shore + 2)] |= TF_COAST;
  }
}

/** Applies [tile, kind] edits (cleared forest becomes grass; landfill turns water to grass). */
export function applyTerrainEdits(plane: Uint8Array, edits: readonly number[]): void {
  for (let i = 0; i + 1 < edits.length; i += 2) {
    const tile = edits[i];
    if (tile < 0 || tile >= TILES) continue;
    const v = plane[tile];
    plane[tile] = makeTerrain(edits[i + 1], terrainElevation(v), v & (TF_COAST | TF_RIVER));
  }
}

// Generating a site is the expensive part (value noise over 4,096 tiles, the
// river and the coast), and it depends only on the seed and the kind, so the
// bare plane is kept once per site. Each town then keeps its own copy with
// its edits applied, plus a copy of the edits it applied: building on forest
// appends edits, so the next call copies the plane and applies only the new
// pairs instead of regenerating the site (an undo that removes edits rebuilds
// from the bare plane). A returned plane is never changed afterwards, because
// the scenic and nature memos key on the plane object. Comparing numbers is
// cheap enough to do on every call, and safer than trusting the array's
// identity, which ops mutate in place.
const BASE_CACHE: { key: string; plane: Uint8Array }[] = [];
const BASE_KEEP = 16;
const TERRAIN_CACHE = new WeakMap<TownState, { seed: number; kind: string; applied: number[]; plane: Uint8Array }>();

function basePlane(seed: number, kind: SiteKind): Uint8Array {
  const key = `${seed}:${kind}`;
  for (const b of BASE_CACHE) if (b.key === key) return b.plane;
  const plane = generateTerrain(seed, kind);
  BASE_CACHE.push({ key, plane });
  if (BASE_CACHE.length > BASE_KEEP) BASE_CACHE.shift();
  return plane;
}

/**
 * The plane a terrain plane was made from by applying more edits (null for a
 * fresh one, or once both plane memos have been made for it): planes are
 * never changed, so the memos keyed on planes (scenic, nature) can start from
 * the base's and redo only the cells around the tiles that differ. Every
 * plane made since points straight at the last plane both memos were made
 * for (never along a chain), so older planes are not kept alive.
 */
export function terrainBase(plane: Uint8Array): Uint8Array | null {
  return TERRAIN_BASE.get(plane) ?? null;
}

/** A plane memo (1 scenic, 2 nature) was made for this plane; with both, its own planes start from it. */
export function terrainMemoised(plane: Uint8Array, which: 1 | 2): void {
  const m = (TERRAIN_MEMOS.get(plane) ?? 0) | which;
  TERRAIN_MEMOS.set(plane, m);
  if (m === 3) TERRAIN_BASE.delete(plane);
}
const TERRAIN_BASE = new WeakMap<Uint8Array, Uint8Array>();
const TERRAIN_MEMOS = new WeakMap<Uint8Array, number>();

/** The town's terrain plane (generated, edits applied), memoised per town on its inputs. Read-only. */
export function terrainOf(t: TownState): Uint8Array {
  const edits = t.terrainEdits;
  const hit = TERRAIN_CACHE.get(t);
  if (hit && hit.seed === t.terrainSeed && hit.kind === t.siteKind && hit.applied.length <= edits.length) {
    const a = hit.applied;
    let same = true;
    for (let i = 0; i < a.length; i++)
      if (a[i] !== edits[i]) {
        same = false;
        break;
      }
    if (same) {
      if (a.length < edits.length) {
        // A new plane, never an edit in place: other memos (scenic, nature) key on the plane itself.
        const plane = hit.plane.slice();
        const fresh = edits.slice(a.length);
        applyTerrainEdits(plane, fresh);
        for (const v of fresh) a.push(v);
        TERRAIN_BASE.set(plane, TERRAIN_BASE.get(hit.plane) ?? hit.plane);
        hit.plane = plane;
      }
      return hit.plane;
    }
  }
  const plane = basePlane(t.terrainSeed, t.siteKind).slice();
  applyTerrainEdits(plane, edits);
  TERRAIN_CACHE.set(t, { seed: t.terrainSeed, kind: t.siteKind, applied: [...edits], plane });
  return plane;
}

/** Counts per terrain kind plus flagged tiles: the fairness hook's raw numbers. */
export function terrainStats(plane: Uint8Array): { kinds: number[]; coast: number; river: number; buildable: number } {
  const kinds = [0, 0, 0, 0, 0, 0];
  let coast = 0;
  let river = 0;
  let build = 0;
  for (let i = 0; i < TILES; i++) {
    kinds[terrainKind(plane[i])]++;
    if (plane[i] & TF_COAST) coast++;
    if (plane[i] & TF_RIVER) river++;
    if (buildable(plane[i])) build++;
  }
  return { kinds, coast, river, buildable: build };
}

/**
 * The site-fairness gate (§3.1): given each site kind's median Balanced-bot
 * population at day 30, a layout is accepted only if the best is at most
 * `ratio` × the worst. The Lab runs the bots; this is the shared rule.
 */
export function fairSites(medians: readonly number[], ratio = 1.15): boolean {
  if (medians.length === 0) return true;
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of medians) {
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return lo > 0 && hi <= ratio * lo;
}

/** Site kinds for a county's six ring positions, from its seed (each kind at least once in the first five). */
export function siteKindsFor(seed: number): SiteKind[] {
  const kinds: SiteKind[] = ['river', 'coast', 'hills', 'forest', 'flatland'];
  // A seeded shuffle with a total order (hash, then index) for the first five, and a draw for the sixth.
  const order = kinds.map((k, i) => ({ k, h: h32(seed, STREAMS.terrain, 99, i, 0), i })).sort((a, b) => a.h - b.h || a.i - b.i);
  const out = order.map((o) => o.k);
  out.push(kinds[h32(seed, STREAMS.terrain, 100, 0, 0) % 5]);
  return out;
}
