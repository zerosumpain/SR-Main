// The bots' town planner: how a bot mayor turns "we need more homes" or "the
// school is full" into a legal build plan. It plays the same game a phone
// does, so it only proposes ops the move API accepts (ops.ts), and it prices
// them the way ops.ts will, so a session never asks for more than the town
// can pay.
//
// The layout is a fixed road lattice: rows y ≡ 4 (mod 5) and columns
// x ≡ 2 (mod 10). The rows put every other tile within two tiles of a road
// (four lot rows between two road rows), which is what a zoned tile needs to
// develop (§3.4), and the columns join the rows into one road component, so
// one set of plants serves the whole town (§3.5). The County Road (x = 32)
// is itself a lattice column. Roads grow outward from the network nearest
// the Town Hall first, so towns stay compact; nothing here depends on the
// site, which keeps every bot playable on every terrain.
//
// Everything is a pure function of the town's stored state.

import { BUILDINGS, ZONE_DEFS, buildingIndex, roadDef, type BuildingDef } from '../content';
import type { Params } from '../params';
import { servicesOf } from '../services';
import { cellDistance, falloff, runFor } from '../space';
import { townContext, type TownEnv } from '../tick';
import { utilitiesOf } from '../utilities';
import { TF_COAST, TF_RIVER, T_FOREST, T_HILL, T_WATER, TOWN_HALL_AT, buildable, terrainElevation, terrainKind, terrainOf } from '../terrain';
import {
  B_KIND,
  B_X,
  B_Y,
  CAT_ROAD,
  CAT_ZONE,
  MAP,
  TILES,
  USE_EMPTY,
  constructionLeft,
  decodeCells,
  footprint,
  lvlLevel,
  openableParcels,
  pairGet,
  parcelOpen,
  planesOf,
  cellOf,
  roadAccess,
  tileIndex,
  useCat,
  usePayload,
} from '../tiles';
import {
  ZONES,
  Z_FARMS,
  Z_HOMES,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  type CoverageKind,
  COVERAGES,
  type DrawnRoad,
  type Op,
  type TownState,
  type UtilitiesSlot,
  type ZoneKind,
} from '../types';

export const HALL_X = TOWN_HALL_AT[0];
export const HALL_Y = TOWN_HALL_AT[1];

/** Is (x, y) on the road lattice? */
export const isLattice = (x: number, y: number): boolean => y % 5 === 4 || x % 10 === 2;

/** Manhattan distance from the Town Hall: how "central" a tile is. */
export const centrality = (x: number, y: number): number => Math.abs(x - HALL_X) + Math.abs(y - HALL_Y);

/** A session's read of the town's tiles: one pass over the planes, reused by every helper. */
export interface TownMap {
  t: TownState;
  use: Uint16Array;
  lvl: Uint8Array;
  terrain: Uint8Array;
  /** Open parcel and buildable terrain. */
  land: Uint8Array;
  road: Uint8Array;
  /** A road within two tiles (Chebyshev): a lot can develop and a building attaches. */
  reach: Uint8Array;
  /** Can take something new: empty, or an empty zoned lot with nothing under way (ops.ts freeTile). */
  free: Uint8Array;
  /** Tiles a plan in this session has already claimed. */
  claimed: Uint8Array;
  /** The lenses the phone shows (coverage per cell, the grids), if the session computed them. */
  lens: Lens | null;
  /** The land-value lens (32×32 cells), decoded on first use. */
  lvCells?: Uint8Array;
}

/**
 * The coverage and utility lenses (§9.4): the engine's own service and grid
 * code run on the town as it stands, which is what the page draws. A bot
 * reads them the way a player reads the map, before deciding where a
 * surgery goes or whether the town needs another plant.
 */
export interface Lens {
  /** Per COVERAGES kind, 1,024 cells, 0–100 (a copy: the session adds its own placements). */
  cov: Float64Array[];
  util: UtilitiesSlot;
  coveredAt: number;
}

export function lensOf(t: TownState, townIndex: number, env: TownEnv, at: number): Lens {
  const ctx = townContext(t, townIndex, t.tick, env, at, false);
  const run = runFor(t, ctx, null);
  const sv = servicesOf(run);
  return { cov: sv.slot.cov.map((a) => a.slice()), util: utilitiesOf(run), coveredAt: env.params.civic.coveredAt };
}

/** After placing a building this session, its coverage joins the lens (falloff only; the next month's run applies capacity and staffing). */
export function lensAdd(m: TownMap, id: string, s: Site): void {
  if (!m.lens) return;
  const def = BUILDINGS[buildingIndex(id)];
  if (!def?.cover || def.radius <= 0) return;
  const [w, h] = footprint(def.w, def.h, s.rot);
  const px = s.x + w / 2;
  const py = s.y + h / 2;
  for (const k of Object.keys(def.cover) as CoverageKind[]) {
    const field = m.lens.cov[COVERAGES.indexOf(k)];
    const strength = def.cover[k] ?? 0;
    for (let c = 0; c < field.length; c++) {
      const f = falloff(cellDistance(c, px, py), def.radius);
      if (f > 0) field[c] = Math.min(100, field[c] + strength * f);
    }
  }
}

export function mapOf(t: TownState): TownMap {
  const p = planesOf(t);
  const terrain = terrainOf(t);
  const land = new Uint8Array(TILES);
  const road = new Uint8Array(TILES);
  const free = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) {
    const x = i % MAP;
    const y = (i - x) / MAP;
    if (parcelOpen(t, x, y) && buildable(terrain[i])) land[i] = 1;
    const u = p.use[i];
    if (useCat(u) === CAT_ROAD) road[i] = 1;
    if (u === USE_EMPTY || (useCat(u) === CAT_ZONE && lvlLevel(p.lvl[i]) === 0 && pairGet(t.construction, i) === 0)) free[i] = 1;
  }
  // A copy: the engine memoises roadAccess, and a session marks its planned roads' reach on it.
  return { t, use: p.use, lvl: p.lvl, terrain, land, road, reach: roadAccess(t, 2).slice(), free, claimed: new Uint8Array(TILES), lens: null };
}

// ---- Counting ---------------------------------------------------------------------------------------

export interface ZoneCounts {
  /** Zoned tiles by ZONE (any level). */
  zoned: number[];
  /** Zoned tiles still empty (level 0, nothing under way): the "for sale" stock. */
  emptyLots: number[];
  /** Built capacity by ZONE (persons for Homes, jobs otherwise), counting levels under way. */
  capacity: number[];
  /** Free lots a new zone could go on now (land, reach, empty, off the lattice). */
  freeLots: number;
}

export function zoneCounts(m: TownMap): ZoneCounts {
  const zoned = new Array<number>(ZONES.length).fill(0);
  const emptyLots = new Array<number>(ZONES.length).fill(0);
  const capacity = new Array<number>(ZONES.length).fill(0);
  let freeLots = 0;
  for (let i = 0; i < TILES; i++) {
    const u = m.use[i];
    if (useCat(u) === CAT_ZONE) {
      const z = usePayload(u);
      zoned[z]++;
      const level = lvlLevel(m.lvl[i]);
      const building = constructionLeft(m.t, i) > 0;
      if (level === 0 && !building) emptyLots[z]++;
      const lv = building ? Math.max(level + 1, ZONE_DEFS[z].minLevel) : level;
      if (lv > 0) capacity[z] += ZONE_DEFS[z].capacity[lv - 1] ?? 0;
    } else if (u === USE_EMPTY && m.land[i] && m.reach[i]) {
      const x = i % MAP;
      if (!isLattice(x, (i - x) / MAP)) freeLots++;
    }
  }
  return { zoned, emptyLots, capacity, freeLots };
}

/** Completed (or under way) buildings by catalogue id. */
export function buildingCounts(t: TownState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of t.buildings) {
    const id = BUILDINGS[b[B_KIND]]?.id;
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

// ---- Roads ------------------------------------------------------------------------------------------

/** £ for one new road tile of `kind` at `tile` (Hills: ×1.5 on hill or high tiles, as ops.ts prices it). */
export function roadTileCost(m: TownMap, kind: DrawnRoad, tile: number, p: Params): number {
  const build = roadDef(kind).build;
  if (m.t.siteKind !== 'hills') return build;
  const v = m.terrain[tile];
  return terrainKind(v) === T_HILL || terrainElevation(v) >= 2 ? Math.round(build * p.build.hillRoadMult) : build;
}

/**
 * Up to `n` new lattice road tiles, grown from the existing network nearest
 * the Town Hall first (so the network stays one connected piece), within
 * `budget` £. Claims the tiles in `m` and returns them in growth order.
 */
export function growRoads(m: TownMap, n: number, kind: DrawnRoad, budget: number, p: Params): { tiles: number[]; cost: number } {
  const inFrontier = new Uint8Array(TILES);
  const frontier: number[] = [];
  const ok = (i: number) => {
    const x = i % MAP;
    const y = (i - x) / MAP;
    return isLattice(x, y) && m.land[i] === 1 && m.free[i] === 1 && m.road[i] === 0 && m.claimed[i] === 0;
  };
  const offer = (i: number) => {
    if (i < 0 || i >= TILES || inFrontier[i] || !ok(i)) return;
    inFrontier[i] = 1;
    frontier.push(i);
  };
  const around = (i: number) => {
    const x = i % MAP;
    if (i >= MAP) offer(i - MAP);
    if (i < TILES - MAP) offer(i + MAP);
    if (x > 0) offer(i - 1);
    if (x < MAP - 1) offer(i + 1);
  };
  for (let i = 0; i < TILES; i++) if (m.road[i]) around(i);
  const tiles: number[] = [];
  let cost = 0;
  while (tiles.length < n && frontier.length > 0) {
    // Nearest the Town Hall first, going round woodland where it can (clearing it costs Nature); ties by tile index.
    let best = 0;
    const detour = (i: number) => centrality(i % MAP, (i - (i % MAP)) / MAP) + (terrainKind(m.terrain[i]) === T_FOREST ? 4 : 0);
    for (let k = 1; k < frontier.length; k++) {
      const a = frontier[k];
      const b = frontier[best];
      const ca = detour(a);
      const cb = detour(b);
      if (ca < cb || (ca === cb && a < b)) best = k;
    }
    const tile = frontier[best];
    frontier.splice(best, 1);
    const c = roadTileCost(m, kind, tile, p);
    if (cost + c > budget) break;
    cost += c;
    tiles.push(tile);
    m.claimed[tile] = 1;
    markReach(m, tile);
    around(tile);
  }
  return { tiles, cost };
}

/** A planned road tile gives the lots within two tiles of it reach, for the rest of the session. */
function markReach(m: TownMap, tile: number): void {
  const x = tile % MAP;
  const y = (tile - x) / MAP;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < MAP && yy < MAP) m.reach[tileIndex(xx, yy)] = 1;
    }
}

/** Road ops for a set of tiles: straight runs, horizontal first. */
export function roadOps(tiles: readonly number[], kind: DrawnRoad): Op[] {
  const mark = new Uint8Array(TILES);
  for (const i of tiles) mark[i] = 1;
  const done = new Uint8Array(TILES);
  const ops: Op[] = [];
  const sorted = [...tiles].sort((a, b) => a - b);
  for (const i of sorted) {
    if (done[i]) continue;
    const x = i % MAP;
    const y = (i - x) / MAP;
    let x1 = x;
    while (x1 + 1 < MAP && mark[tileIndex(x1 + 1, y)] && !done[tileIndex(x1 + 1, y)]) x1++;
    if (x1 > x) {
      for (let k = x; k <= x1; k++) done[tileIndex(k, y)] = 1;
      ops.push({ op: 'road', kind, path: [x, y, x1, y] });
      continue;
    }
    let y1 = y;
    while (y1 + 1 < MAP && mark[tileIndex(x, y1 + 1)] && !done[tileIndex(x, y1 + 1)]) y1++;
    for (let k = y; k <= y1; k++) done[tileIndex(x, k)] = 1;
    ops.push({ op: 'road', kind, path: [x, y, x, y1] });
  }
  return ops;
}

/** Road tiles of a lower class than `kind` on the two main lines (row and column through the hall). */
export function upgradeCandidates(m: TownMap, kind: DrawnRoad, n: number): number[] {
  const target = ['lane', 'street', 'avenue'].indexOf(kind);
  const out: number[] = [];
  for (let i = 0; i < TILES && out.length < n; i++) {
    if (!m.road[i]) continue;
    const x = i % MAP;
    const y = (i - x) / MAP;
    if (y !== HALL_Y && x !== HALL_X - 1) continue;
    const from = usePayload(m.use[i]);
    if (from < target) out.push(i);
  }
  return out;
}

// ---- Zones --------------------------------------------------------------------------------------------

/** Land value an office lot needs (the L3 entry of develop.lvReq, §3.3). */
const OFFICE_LV = 70;

/** Land value at tile i (the town's 32×32 plane, decoded once per map). */
function lvAt(m: TownMap, i: number): number {
  if (!m.lvCells) m.lvCells = decodeCells(m.t.lv);
  return m.lvCells[cellOf(i)] ?? 0;
}

/** Per-zone lot preferences: higher is better. Centre for shops and offices (on land that can take them), an industrial quarter, farms on the edge. */
export function lotScore(m: TownMap, zone: number, i: number, nearIndustry: Uint8Array): number {
  const x = i % MAP;
  const y = (i - x) / MAP;
  const c = centrality(x, y);
  switch (zone) {
    case Z_HOMES:
      return -c - (nearIndustry[i] ? 40 : 0);
    case Z_SHOPS:
      return -1.5 * c + (y === HALL_Y - 1 || y === HALL_Y + 1 || x === HALL_X - 2 || x === HALL_X ? 6 : 0);
    case Z_OFFICES: {
      // Offices start at L3, which needs land value 70 (§3.3): a lot below it never grows, however
      // loud the Offices bar, so the bot zones offices where the land can take them.
      const lv = lvAt(m, i);
      return lv >= OFFICE_LV ? -c + 0.2 * lv : -1000 + lv;
    }
    case Z_LEISURE:
      return -1.2 * c;
    case Z_INDUSTRY:
      // The industrial quarter grows from the south-east, beside the County Road's freight.
      return -(Math.abs(x - 44) + Math.abs(y - 47));
    case Z_FARMS:
      return c + (x < HALL_X ? 4 : 0);
    default:
      return -c;
  }
}

/** Tiles within 3 of an Industry zone (homes keep their distance). */
export function industryHalo(m: TownMap): Uint8Array {
  const out = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) {
    if (useCat(m.use[i]) !== CAT_ZONE || usePayload(m.use[i]) !== Z_INDUSTRY) continue;
    const x = i % MAP;
    const y = (i - x) / MAP;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < MAP && yy < MAP) out[tileIndex(xx, yy)] = 1;
      }
  }
  return out;
}

/**
 * Up to `n` free lots for `zone`, best first by lotScore (ties by tile index).
 * `score` may override the ranking (the Kid's random picks). Claims them.
 */
export function pickLots(m: TownMap, zone: number, n: number, score?: (i: number) => number): number[] {
  if (n <= 0) return [];
  const halo = zone === Z_HOMES ? industryHalo(m) : new Uint8Array(0);
  const cand: [number, number][] = [];
  for (let i = 0; i < TILES; i++) {
    if (m.use[i] !== USE_EMPTY || !m.land[i] || !m.reach[i] || m.claimed[i]) continue;
    const x = i % MAP;
    if (isLattice(x, (i - x) / MAP)) continue;
    cand.push([score ? score(i) : lotScore(m, zone, i, halo), i]);
  }
  cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = cand.slice(0, n).map(([, i]) => i);
  for (const i of out) m.claimed[i] = 1;
  return out;
}

/** Zone ops for lots: horizontal runs as one rectangle each. */
export function zoneOps(lots: readonly number[], zone: ZoneKind): Op[] {
  const sorted = [...lots].sort((a, b) => a - b);
  const ops: Op[] = [];
  let k = 0;
  while (k < sorted.length) {
    const i = sorted[k];
    const x = i % MAP;
    const y = (i - x) / MAP;
    let w = 1;
    while (k + w < sorted.length && sorted[k + w] === i + w && (i + w) % MAP !== 0) w++;
    ops.push({ op: 'zone', zone, rect: [x, y, w, 1] });
    k += w;
  }
  return ops;
}

// ---- Buildings --------------------------------------------------------------------------------------

/** £ to place catalogue item `id` here (ops.ts placeCost). */
export function placeCostOf(t: TownState, id: string, p: Params): number {
  const def = BUILDINGS[buildingIndex(id)];
  let c = def.build;
  if (t.siteKind === 'forest') c *= p.build.forestBuildMult;
  if (t.siteKind === 'river' && def.group === 'water') c *= p.build.riverWaterMult;
  return Math.round(c);
}

/** Summed-area table over a 64×64 tile weight (one extra row and column of zeros). */
function sat(w: Float64Array | Uint8Array): Float64Array {
  const S = new Float64Array((MAP + 1) * (MAP + 1));
  for (let y = 0; y < MAP; y++) {
    let row = 0;
    for (let x = 0; x < MAP; x++) {
      row += w[y * MAP + x];
      S[(y + 1) * (MAP + 1) + x + 1] = S[y * (MAP + 1) + x + 1] + row;
    }
  }
  return S;
}

/** Sum over the rectangle [x0, x1) × [y0, y1), clipped to the map. */
function box(S: Float64Array, x0: number, y0: number, x1: number, y1: number): number {
  const a = Math.max(0, Math.min(MAP, x0));
  const b = Math.max(0, Math.min(MAP, y0));
  const c = Math.max(0, Math.min(MAP, x1));
  const d = Math.max(0, Math.min(MAP, y1));
  if (c <= a || d <= b) return 0;
  const W = MAP + 1;
  return S[d * W + c] - S[b * W + c] - S[d * W + a] + S[b * W + a];
}

/** Homes weight per tile: built capacity, or 8 for a zoned lot still empty (it will fill). */
export function homesWeight(m: TownMap): Float64Array {
  const w = new Float64Array(TILES);
  const caps = ZONE_DEFS[Z_HOMES].capacity;
  for (let i = 0; i < TILES; i++) {
    const u = m.use[i];
    if (useCat(u) !== CAT_ZONE || usePayload(u) !== Z_HOMES) continue;
    const level = lvlLevel(m.lvl[i]);
    w[i] = level > 0 ? caps[level - 1] : caps[0];
  }
  return w;
}

/** Tiles that already reach `kind` coverage from a building (within 0.75 of its radius: the field there is past the checklist's line). */
export function coveredBy(t: TownState, kind: CoverageKind): Uint8Array {
  const out = new Uint8Array(TILES);
  for (const b of t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    if (!def || !(def.cover?.[kind] ?? 0) || def.radius <= 0) continue;
    if (def.radius === Infinity) {
      out.fill(1);
      return out;
    }
    const [w, h] = footprint(def.w, def.h, b[3]);
    const cx = b[B_X] + w / 2;
    const cy = b[B_Y] + h / 2;
    const r = 0.75 * def.radius;
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MAP - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MAP - 1, Math.ceil(cx + r)); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) out[tileIndex(x, y)] = 1;
      }
  }
  return out;
}

/** Is tile i's cell covered for `kind` (the lens, or the radius estimate without one)? */
function coveredTiles(m: TownMap, kind: CoverageKind, margin = 0): Uint8Array {
  if (!m.lens) return coveredBy(m.t, kind);
  const field = m.lens.cov[COVERAGES.indexOf(kind)];
  const out = new Uint8Array(TILES);
  const at = m.lens.coveredAt + margin;
  for (let i = 0; i < TILES; i++) if (field[cellOf(i)] >= at) out[i] = 1;
  return out;
}

/** Share of homes weight (built and planned) inside `kind` coverage: the §7 checklist's "within reach of N% of homes". */
export function coverageShare(m: TownMap, kind: CoverageKind, margin = 2): number {
  const w = homesWeight(m);
  const cov = coveredTiles(m, kind, margin);
  let all = 0;
  let inside = 0;
  for (let i = 0; i < TILES; i++) {
    if (w[i] === 0) continue;
    all += w[i];
    if (cov[i]) inside += w[i];
  }
  return all > 0 ? inside / all : 1;
}

export type SiteGoal =
  /** Cover as many homes not yet covered for this kind as possible. */
  | { kind: 'cover'; cover: CoverageKind }
  /** Near the centre (culture, attractions, depots). */
  | { kind: 'central' }
  /** Away from homes and the centre (plants, wells, freight). */
  | { kind: 'edge' };

export interface Site {
  x: number;
  y: number;
  rot: 0 | 1;
  score: number;
  /** Built zoned tiles the plan must bulldoze first (a clearing site, see findSite). */
  clear?: number[];
}

/**
 * What clearing a built zoned tile costs a clearing site, in the cover goal's
 * units (persons of homes): farms first, then low-level homes, workshops and
 * shops. Offices, leisure and anything above level 2 are never cleared.
 */
function clearCost(m: TownMap, i: number): number {
  const u = m.use[i];
  if (useCat(u) !== CAT_ZONE) return Infinity;
  const z = usePayload(u);
  const level = lvlLevel(m.lvl[i]);
  if (z === Z_FARMS) return 3;
  if (level > 2) return Infinity;
  const cap = ZONE_DEFS[z].capacity[Math.max(0, level - 1)] ?? 0;
  if (z === Z_HOMES) return cap;
  if (z === Z_INDUSTRY || z === Z_SHOPS) return 2 * cap;
  return Infinity;
}

/**
 * The best legal spot for catalogue item `id`: every footprint tile free open
 * land off the lattice, at least one within reach of a road, best by the goal
 * (ties: lower y, then lower x, then rot 0). Null if nowhere fits.
 */
export function findSite(m: TownMap, id: string, goal: SiteGoal, clearing = false): Site | null {
  const def = BUILDINGS[buildingIndex(id)];
  if (!def) return null;
  const okTile = new Uint8Array(TILES);
  // A clearing search (a checklist building in a town with no free land left) may also take built zoned tiles, at a cost.
  const cost = clearing ? new Float64Array(TILES) : null;
  for (let i = 0; i < TILES; i++) {
    const x = i % MAP;
    if (!m.land[i] || m.claimed[i] || m.road[i] || isLattice(x, (i - x) / MAP)) continue;
    if (m.free[i]) okTile[i] = 1;
    else if (cost) {
      const k = clearCost(m, i);
      if (k < Infinity) {
        okTile[i] = 1;
        cost[i] = k;
      }
    }
  }
  if (def.requires) return clearing ? null : requiredSite(m, def, okTile);
  const S_ok = sat(okTile);
  const S_cost = cost ? sat(cost) : null;
  const S_reach = sat(m.reach);
  const forest = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) if (terrainKind(m.terrain[i]) === T_FOREST) forest[i] = 1;
  const S_forest = sat(forest);
  let S_gain: Float64Array | null = null;
  let half = 0;
  if (goal.kind === 'cover') {
    const w = homesWeight(m);
    // Homes just over the line count as uncovered too: a bot wants headroom, not a knife edge.
    const cov = coveredTiles(m, goal.cover, 10);
    for (let i = 0; i < TILES; i++) if (cov[i]) w[i] = 0;
    S_gain = sat(w);
    half = def.radius === Infinity ? MAP : Math.max(1, Math.floor(0.75 * def.radius));
  }
  let best: Site | null = null;
  for (const rot of [0, 1] as const) {
    if (rot === 1 && def.w === def.h) continue;
    const [w, h] = footprint(def.w, def.h, rot);
    for (let y = 0; y + h <= MAP; y++)
      for (let x = 0; x + w <= MAP; x++) {
        if (box(S_ok, x, y, x + w, y + h) !== w * h) continue;
        if (box(S_reach, x, y, x + w, y + h) === 0) continue;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const c = Math.abs(cx - HALL_X - 1) + Math.abs(cy - HALL_Y - 1);
        let score: number;
        const trees = box(S_forest, x, y, x + w, y + h);
        if (goal.kind === 'cover') {
          const gain = box(S_gain!, Math.floor(cx - half), Math.floor(cy - half), Math.ceil(cx + half), Math.ceil(cy + half));
          score = gain - 0.01 * c - 0.5 * trees;
        } else if (goal.kind === 'central') score = -c - 2 * trees;
        else score = c - 2 * trees;
        if (S_cost) score -= box(S_cost, x, y, x + w, y + h);
        if (!best || score > best.score) best = { x, y, rot, score };
      }
  }
  if (best && goal.kind === 'cover' && best.score <= 0) return null;
  if (best && cost) {
    const [w, h] = footprint(def.w, def.h, best.rot);
    const clear: number[] = [];
    for (let y = best.y; y < best.y + h; y++) for (let x = best.x; x < best.x + w; x++) if (!m.free[tileIndex(x, y)]) clear.push(tileIndex(x, y));
    best.clear = clear;
  }
  return best;
}

/** Placement for buildings with a terrain rule (coast, water, river, scenic): scan for a footprint that passes ops.ts's test. */
function requiredSite(m: TownMap, def: BuildingDef, okTile: Uint8Array): Site | null {
  const terr = m.terrain;
  const ring = (tiles: number[], f: (v: number) => boolean) =>
    tiles.some((tile) => {
      const x = tile % MAP;
      const y = (tile - x) / MAP;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < MAP && yy < MAP && f(terr[tileIndex(xx, yy)])) return true;
        }
      return false;
    });
  for (const rot of [0, 1] as const) {
    const [w, h] = footprint(def.w, def.h, rot);
    for (let y = 0; y + h <= MAP; y++)
      for (let x = 0; x + w <= MAP; x++) {
        const tiles: number[] = [];
        let fits = true;
        let reach = false;
        for (let yy = y; yy < y + h && fits; yy++)
          for (let xx = x; xx < x + w; xx++) {
            const i = tileIndex(xx, yy);
            if (!okTile[i]) {
              fits = false;
              break;
            }
            if (m.reach[i]) reach = true;
            tiles.push(i);
          }
        if (!fits || !reach) continue;
        const pass =
          def.requires === 'coast'
            ? m.t.siteKind === 'coast' && ring(tiles, (v) => (v & TF_COAST) !== 0 && terrainKind(v) === T_WATER)
            : def.requires === 'water'
              ? ring(tiles, (v) => terrainKind(v) === T_WATER)
              : def.requires === 'river'
                ? tiles.some((i) => (terr[i] & TF_RIVER) !== 0)
                : ring(tiles, (v) => (v & (TF_COAST | TF_RIVER)) !== 0 || terrainKind(v) === T_HILL || terrainElevation(v) === 3);
        if (pass) return { x, y, rot, score: 0 };
      }
  }
  return null;
}

/** Claims a site's footprint so later picks in the same session avoid it. */
export function claimSite(m: TownMap, id: string, s: Site): void {
  const def = BUILDINGS[buildingIndex(id)];
  const [w, h] = footprint(def.w, def.h, s.rot);
  for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) m.claimed[tileIndex(x, y)] = 1;
}

// ---- Utilities ------------------------------------------------------------------------------------------

export interface UtilityBalance {
  powerSupply: number;
  powerNeed: number;
  waterSupply: number;
  waterNeed: number;
}

/**
 * Supply from every plant (under way counts: it finishes within a few ticks)
 * against the demand of everything built, under way and zoned (§3.5), so a
 * bot builds ahead of growth rather than after the brownout.
 */
export function utilityBalance(m: TownMap, p: Params, ahead = true): UtilityBalance {
  const u = p.utilities;
  let powerSupply = 0;
  let waterSupply = 0;
  let powerNeed = 0;
  let waterNeed = 0;
  for (const b of m.t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    if (!def) continue;
    const mult = def.siteMult && def.siteMult.sites.includes(m.t.siteKind) ? def.siteMult.supply : 1;
    powerSupply += (def.supply?.power ?? 0) * mult;
    waterSupply += (def.supply?.water ?? 0) * mult;
    if (!def.supply) {
      const area = def.w * def.h;
      const k = area <= 1 ? 0 : area <= 4 ? 1 : area <= 9 ? 2 : 3;
      powerNeed += u.civicPower[k];
      waterNeed += u.civicWater[k] + 0.5 * def.staff;
    }
  }
  const caps = ZONE_DEFS.map((z) => z.capacity);
  for (let i = 0; i < TILES; i++) {
    const use = m.use[i];
    if (useCat(use) !== CAT_ZONE) continue;
    const z = usePayload(use);
    const level = lvlLevel(m.lvl[i]);
    const next = ahead ? Math.min(5, Math.max(level + 1, ZONE_DEFS[z].minLevel)) : Math.max(level, ZONE_DEFS[z].minLevel);
    // Count each lot at its next level (what it is about to need), or as it stands.
    const cap = caps[z][next - 1] || caps[z][Math.max(0, level - 1)] || 0;
    if (z === Z_HOMES) {
      powerNeed += cap * u.powerPerResident;
      waterNeed += cap * u.waterPerResident;
    } else if (z === Z_INDUSTRY) {
      powerNeed += cap * u.powerPerIndustryJob;
      waterNeed += cap * u.waterPerIndustryJob;
    } else {
      powerNeed += cap * u.powerPerJob;
      waterNeed += cap * u.waterPerJob;
    }
  }
  return { powerSupply, powerNeed, waterSupply, waterNeed };
}

// ---- Land ------------------------------------------------------------------------------------------------

/** The openable parcel with the most buildable land, nearest the hall on ties (§3.1). */
export function bestParcel(t: TownState, open = t.parcels): number | null {
  const terr = terrainOf(t);
  let best: number | null = null;
  let bestScore = -Infinity;
  // `open`: the town's parcels plus any this session has already asked for.
  for (const q of openableParcels(open)) {
    const px = q % 4;
    const py = (q - px) / 4;
    let land = 0;
    for (let y = py * 16; y < py * 16 + 16; y++) for (let x = px * 16; x < px * 16 + 16; x++) if (buildable(terr[tileIndex(x, y)])) land++;
    const score = land - 2 * centrality(px * 16 + 8, py * 16 + 8) / 16;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

