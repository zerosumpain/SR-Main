// WP2a's shared spatial model (spec §3.5, §3.6, §5.4, §5.9). The space steps
// (M2 utilities, M3 fields, M4 transport) all look at the town the same way,
// so the way is computed once here:
//
// - the ROAD NET: road components (the utility grids of §3.5), each tile's
//   attachment road (the nearest road within reach, which is how a lot or a
//   building "touches" the network), district ports, and the road graph
//   compressed to junctions and ports so 64 shortest-path trees a month stay
//   cheap. It depends only on where the roads are, so it is memoised per town
//   on an exact copy of the road layout (never on a hash: a collision would let
//   a long-running server and a freshly revived phone disagree);
// - the month's OCCUPANCY: who lives and works where. People are stocks, not
//   agents, so residents are spread over completed homes in proportion to
//   capacity by tier, and jobs sit on completed job tiles and civic buildings.
//
// A `SpaceRun` carries one month's (or one pure query's) results between the
// three steps, keyed on the month's blackboard object, so M3 and M4 share one
// set of shortest-path trees instead of computing them twice.

import { BUILDINGS, CIVIC_MIX, ENTRY_MIX_L1, ROAD_DEFS, ZONE_DEFS, tileMix, type BuildingDef } from './content';
import { expFx } from './fx';
import { monthF64, monthI16, monthI32, monthI8, monthU8 } from './pool';
import type { Params } from './params';
import { SIGNPOST_EAST, SIGNPOST_KINGSPORT, SIGNPOST_WEST, TF_COAST, T_SAND, terrainKind, terrainOf } from './terrain';
import {
  B_DAMAGED,
  B_KIND,
  B_ROT,
  B_STAFF,
  B_X,
  B_Y,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  CELLS,
  CELLS_PER_SIDE,
  DISTRICTS,
  DISTRICTS_PER_SIDE,
  MAP,
  MARK_DAMAGED,
  TILES,
  VARIANT_HOTEL,
  cellOf,
  decodeCells,
  decodeCellsShared,
  districtOf,
  footprint,
  lvlLevel,
  lvlTier,
  parcelOpen,
  planesOf,
  sameUse,
  tileIndex,
  tileX,
  tileY,
  useCat,
  usePayload,
  zonedTiles,
} from './tiles';
import { FUNDING_KEYS, PERSON_S, STAGE_C, STAGE_P, STAGE_R, STAGE_W, ZONE_SECTOR, Z_HOMES, Z_LEISURE, person, type DerivedCache, type TickContext, type TownState } from './types';

/** Per tile: its cell and its district (tables, so hot loops avoid the divisions). */
export const CELL_OF = (() => {
  const out = new Int16Array(TILES);
  for (let i = 0; i < TILES; i++) out[i] = cellOf(i);
  return out;
})();
export const DISTRICT_OF = (() => {
  const out = new Int8Array(TILES);
  for (let i = 0; i < TILES; i++) out[i] = districtOf(i);
  return out;
})();

/** Job skill mix per (sector, level) as flat Float64 rows: MIX[(s·6 + level)·3 + h] (A2 entry levels applied). */
function mixTable(l2: readonly number[]): Float64Array {
  const out = new Float64Array(5 * 6 * 3);
  for (let s = 0; s < 5; s++)
    for (let lv = 1; lv <= 5; lv++) {
      const m = tileMix(s, lv, l2);
      for (let h = 0; h < 3; h++) out[(s * 6 + lv) * 3 + h] = m[h];
    }
  return out;
}
const MIX_CACHE: { key: string; src: readonly number[]; table: Float64Array }[] = [];
function mixFor(l2: readonly number[]): Float64Array {
  // The params' (frozen) array is the same object every month: found by identity before its key is built.
  for (const e of MIX_CACHE) if (e.src === l2) return e.table;
  const key = l2.join(',');
  for (const e of MIX_CACHE) if (e.key === key) return e.table;
  const table = mixTable(l2);
  MIX_CACHE.push({ key, src: l2, table });
  if (MIX_CACHE.length > 8) MIX_CACHE.shift();
  return table;
}

/** The three signposts in TravelSlot.toSignpost order: Kingsport (south), west, east. */
export const SIGNPOSTS: readonly number[] = [SIGNPOST_KINGSPORT, SIGNPOST_WEST, SIGNPOST_EAST];

// ---- e^(−x), table-driven ------------------------------------------------------------
//
// Access and gravity call e^(−c/λ) tens of thousands of times a month. Like T
// and σ in fx.ts, a table built once by expFx and read back with fixed
// interpolation is deterministic on every engine; linear interpolation at
// h = 1/256 is within 2e-6 of e^(−x) and costs two loads and a multiply.

const DEC_STEP = 256;
const DEC_MAX = 32;
const DEC_TABLE = (() => {
  const out = new Float64Array(DEC_MAX * DEC_STEP + 2);
  for (let i = 0; i < out.length; i++) out[i] = expFx(-i / DEC_STEP);
  return out;
})();

/** e^(−x) for x ≥ 0 (0 at Infinity or NaN; x ≤ 0 gives 1). Absolute error < 2e-6. */
export function decay(x: number): number {
  if (!(x > 0)) return x <= 0 ? 1 : 0;
  if (x >= DEC_MAX) return x === Infinity ? 0 : expFx(-x);
  const p = x * DEC_STEP;
  const i = p | 0;
  const y0 = DEC_TABLE[i];
  return y0 + (p - i) * (DEC_TABLE[i + 1] - y0);
}

// ---- The road net ----------------------------------------------------------------------

export interface RoadNet {
  /** The memo key: per tile 1 + road kind, 8 for rail, else 0; and the attachment reach. */
  key: Uint8Array;
  reach: number;
  /** Per tile: road kind (ROAD_KINDS index) or −1. */
  kind: Int8Array;
  rail: Uint8Array;
  /** Rail tiles in ascending order. */
  railTiles: Int32Array;
  hasRail: boolean;
  /** Road tiles in ascending order. */
  roads: Int32Array;
  /** Road component per road tile (−1 elsewhere), numbered in order of first tile. */
  comp: Int32Array;
  comps: number;
  /** Per tile: the nearest road tile within `reach` (Chebyshev, then Manhattan, then index), or −1. */
  attach: Int32Array;
  /** Chebyshev distance to that road tile (127 when none). */
  attachDist: Int8Array;
  /** Port tile per district, or −1 (§5.9: the road tile nearest the centre with the most frontage). */
  port: Int32Array;
  /** The compressed graph: junctions, dead ends, ports and signposts are nodes. */
  nodeTile: Int32Array;
  nodeOf: Int32Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  /** Interior tiles of edge e: edgeTiles[edgeStart[e] .. edgeStart[e + 1]). */
  edgeStart: Int32Array;
  edgeTiles: Int32Array;
  /** Edges incident to node n: adjEdge[adjStart[n] .. adjStart[n + 1]). */
  adjStart: Int32Array;
  adjEdge: Int32Array;
  /** The node at the other end of each adjacency entry. */
  adjNode: Int32Array;
  /** Node of each district's port, or −1. */
  portNode: Int32Array;
  /** Node of each signpost (SIGNPOSTS order), or −1 if no road reaches it. */
  signNode: Int32Array;
  /** Component of the County Road at the Kingsport signpost, or −1. */
  kingsportComp: number;
  /** The district a cell's access is measured from: its own if it has a port, else the nearest that has one (lower index on ties), else −1. */
  cellDistrict: Int16Array;
}

const NETS = new WeakMap<TownState, RoadNet>();

function roadKey(use: Uint16Array): Uint8Array {
  const key = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) {
    const c = useCat(use[i]);
    key[i] = c === CAT_ROAD ? 1 + usePayload(use[i]) : c === CAT_RAIL ? 8 : 0;
  }
  return key;
}

function sameRoads(key: Uint8Array, use: Uint16Array): boolean {
  for (let i = 0; i < TILES; i++) {
    const c = use[i] >>> 12;
    const k = c === CAT_ROAD ? 1 + (use[i] & 0xfff) : c === CAT_RAIL ? 8 : 0;
    if (key[i] !== k) return false;
  }
  return true;
}

/** The town's road net, rebuilt only when a road or rail tile changed. */
export function roadNetOf(t: TownState, reach: number): RoadNet {
  const use = planesOf(t).use;
  const hit = NETS.get(t);
  if (hit && hit.reach === reach) {
    // The whole plane unchanged since the last check answers it at once (sameUse); else the roads alone.
    const plane = NET_PLANES.get(hit);
    if (plane !== undefined && sameUse(plane, use)) return hit;
    if (sameRoads(hit.key, use)) {
      if (plane !== undefined && plane.length === use.length) plane.set(use);
      else NET_PLANES.set(hit, use.slice());
      return hit;
    }
  }
  const net = buildRoadNet(roadKey(use), reach, hit ?? null);
  NETS.set(t, net);
  NET_PLANES.set(net, use.slice());
  return net;
}

/** The use plane each net was last checked against (a copy). */
const NET_PLANES = new WeakMap<RoadNet, Uint16Array>();

/** Orthogonal neighbour of tile i in direction d (0 N, 1 W, 2 E, 3 S), or −1 off the map. */
function step(i: number, d: number): number {
  const x = tileX(i);
  if (d === 0) return i >= MAP ? i - MAP : -1;
  if (d === 1) return x > 0 ? i - 1 : -1;
  if (d === 2) return x < MAP - 1 ? i + 1 : -1;
  return i < TILES - MAP ? i + MAP : -1;
}

/** Builds the road net from a road key (exported for tests: Dijkstra versus brute force). */
export function buildRoadNet(key: Uint8Array, reach: number, prev: RoadNet | null = null): RoadNet {
  // Neighbours are written out (N, W, E, S as step() numbers them) rather than called through
  // step() and a closure: the net is rebuilt in every month a road changed, and those months
  // were the slowest the Lab timed (G12). Same lists, same order, same numbers.
  const kind = new Int8Array(TILES).fill(-1);
  const rail = new Uint8Array(TILES);
  let nRoads = 0;
  let nRail = 0;
  for (let i = 0; i < TILES; i++) {
    const k = key[i];
    if (k >= 1 && k <= 4) nRoads++;
    else if (k === 8) nRail++;
  }
  const roads = new Int32Array(nRoads);
  const railTiles = new Int32Array(nRail);
  nRoads = 0;
  nRail = 0;
  for (let i = 0; i < TILES; i++) {
    const k = key[i];
    if (k >= 1 && k <= 4) {
      kind[i] = k - 1;
      roads[nRoads++] = i;
    } else if (k === 8) {
      rail[i] = 1;
      railTiles[nRail++] = i;
    }
  }
  const R = nRoads;

  // Components, by breadth-first search from each unlabelled road tile in order.
  const comp = new Int32Array(TILES).fill(-1);
  let comps = 0;
  const queue = monthI32(TILES);
  for (let r0 = 0; r0 < R; r0++) {
    const r = roads[r0];
    if (comp[r] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = r;
    comp[r] = comps;
    while (head < tail) {
      const i = queue[head++];
      const x = i & (MAP - 1);
      if (i >= MAP && kind[i - MAP] >= 0 && comp[i - MAP] < 0) {
        comp[i - MAP] = comps;
        queue[tail++] = i - MAP;
      }
      if (x > 0 && kind[i - 1] >= 0 && comp[i - 1] < 0) {
        comp[i - 1] = comps;
        queue[tail++] = i - 1;
      }
      if (x < MAP - 1 && kind[i + 1] >= 0 && comp[i + 1] < 0) {
        comp[i + 1] = comps;
        queue[tail++] = i + 1;
      }
      if (i < TILES - MAP && kind[i + MAP] >= 0 && comp[i + MAP] < 0) {
        comp[i + MAP] = comps;
        queue[tail++] = i + MAP;
      }
    }
    comps++;
  }

  // Attachment: the nearest road tile within `reach` (a lot "touches" the road it is served from).
  // Each road tile offers itself to the tiles around it; the order (Chebyshev, then Manhattan,
  // then tile index) is total, so this is the same argmin as a scan of every tile's window.
  // When the previous net had the same reach and every one of its roads is still a road (the
  // roads were only added to, or relaid as another kind), its attachment is the argmin over
  // the old roads, so only the new road tiles need to make their offers.
  let grown = prev !== null && prev.reach === reach;
  if (grown && prev) for (let k = 0; k < prev.roads.length; k++) if (kind[prev.roads[k]] < 0) grown = false;
  const attach = grown && prev ? prev.attach.slice() : new Int32Array(TILES).fill(-1);
  const attachDist = grown && prev ? prev.attachDist.slice() : new Int8Array(TILES).fill(127);
  for (let k = 0; k < R; k++) {
    const j = roads[k];
    if (grown && prev && prev.kind[j] >= 0) continue; // an old road: its offers are in the copy
    const jx = j & (MAP - 1);
    const jy = j >> 6;
    const y0 = jy - reach < 0 ? 0 : jy - reach;
    const y1 = jy + reach > MAP - 1 ? MAP - 1 : jy + reach;
    const x0 = jx - reach < 0 ? 0 : jx - reach;
    const x1 = jx + reach > MAP - 1 ? MAP - 1 : jx + reach;
    for (let yy = y0; yy <= y1; yy++) {
      const cy = yy < jy ? jy - yy : yy - jy;
      const row = yy * MAP;
      for (let xx = x0; xx <= x1; xx++) {
        const i = row + xx;
        const c = xx < jx ? jx - xx : xx - jx;
        const cheb = c > cy ? c : cy;
        const bc = attachDist[i];
        if (cheb > bc) continue;
        if (cheb < bc) {
          attach[i] = j;
          attachDist[i] = cheb;
          continue;
        }
        // A tie on Chebyshev distance: the current road's Manhattan distance, from its tile.
        const a = attach[i];
        const ax = a & (MAP - 1);
        const ay = a >> 6;
        const bm = (ax < xx ? xx - ax : ax - xx) + (ay < yy ? yy - ay : ay - yy);
        const man = c + cy;
        if (man < bm || (man === bm && j < a)) {
          attach[i] = j;
          attachDist[i] = cheb;
        }
      }
    }
  }

  // Degrees and ports (a neighbour off the map is not a road; one in the map and not a road is frontage).
  const deg = monthU8(TILES);
  const port = new Int32Array(DISTRICTS).fill(-1);
  const portScore = monthI32(DISTRICTS);
  const portFront = monthI32(DISTRICTS);
  for (let k = 0; k < R; k++) {
    const r = roads[k];
    const x = r & (MAP - 1);
    let dg = 0;
    let front = 0;
    if (r >= MAP) {
      if (kind[r - MAP] >= 0) dg++;
      else front++;
    }
    if (x > 0) {
      if (kind[r - 1] >= 0) dg++;
      else front++;
    }
    if (x < MAP - 1) {
      if (kind[r + 1] >= 0) dg++;
      else front++;
    }
    if (r < TILES - MAP) {
      if (kind[r + MAP] >= 0) dg++;
      else front++;
    }
    deg[r] = dg;
    FRONT[k] = front;
  }
  for (let k = 0; k < R; k++) {
    const r = roads[k];
    const d = DISTRICT_OF[r];
    const x0 = (d % DISTRICTS_PER_SIDE) * 8;
    const y0 = ((d - (d % DISTRICTS_PER_SIDE)) / DISTRICTS_PER_SIDE) * 8;
    const ax = 2 * (r & (MAP - 1)) - (2 * x0 + 7);
    const ay = 2 * (r >> 6) - (2 * y0 + 7);
    const score = (ax < 0 ? -ax : ax) + (ay < 0 ? -ay : ay);
    const front = FRONT[k];
    // A junction beats a plain stretch (it is already a graph node, and where routes meet);
    // then nearer the centre, then more frontage. Roads are visited in ascending tile
    // order, so a full tie keeps the lower tile.
    const junction = deg[r] >= 3 ? 1 : 0;
    const best = port[d] < 0 ? -1 : deg[port[d]] >= 3 ? 1 : 0;
    if (port[d] < 0 || junction > best || (junction === best && (score < portScore[d] || (score === portScore[d] && front > portFront[d])))) {
      port[d] = r;
      portScore[d] = score;
      portFront[d] = front;
    }
  }

  // Nodes: every tile that is not a plain stretch of road, plus ports and signposts.
  const isNode = monthU8(TILES);
  for (let k = 0; k < R; k++) if (deg[roads[k]] !== 2) isNode[roads[k]] = 1;
  for (let d = 0; d < DISTRICTS; d++) if (port[d] >= 0) isNode[port[d]] = 1;
  for (const sg of SIGNPOSTS) if (sg >= 0 && kind[sg] >= 0) isNode[sg] = 1;
  // A ring road with no junction still needs one node.
  const compHasNode = monthU8(comps);
  for (let k = 0; k < R; k++) if (isNode[roads[k]]) compHasNode[comp[roads[k]]] = 1;
  for (let k = 0; k < R; k++) {
    const r = roads[k];
    if (!compHasNode[comp[r]]) {
      isNode[r] = 1;
      compHasNode[comp[r]] = 1;
    }
  }
  const nodeOf = new Int32Array(TILES).fill(-1);
  let V = 0;
  for (let k = 0; k < R; k++) if (isNode[roads[k]]) V++;
  const nodeTile = new Int32Array(V);
  V = 0;
  for (let k = 0; k < R; k++) {
    const r = roads[k];
    if (isNode[r]) {
      nodeOf[r] = V;
      nodeTile[V++] = r;
    }
  }

  // Edges: walk from each node along plain stretches to the next node; keep each chain once.
  // (At most one edge per road tile and direction, and each interior tile lies on one edge.)
  const eA = monthI32(2 * R + 1);
  const eB = monthI32(2 * R + 1);
  const eStart = monthI32(2 * R + 2);
  const eTiles = monthI32(2 * R + 1); // a re-walked chain is written before it is dropped
  let E = 0;
  let nTiles = 0;
  eStart[0] = 0;
  for (let n = 0; n < V; n++) {
    const u = nodeTile[n];
    for (let d = 0; d < 4; d++) {
      let cur = step(u, d);
      if (cur < 0 || kind[cur] < 0) continue;
      let prev = u;
      const chainFrom = nTiles;
      while (!isNode[cur]) {
        eTiles[nTiles++] = cur;
        let next = -1;
        const x = cur & (MAP - 1);
        // The first road neighbour other than the one we came from, in step() order (N, W, E, S).
        if (cur >= MAP && cur - MAP !== prev && kind[cur - MAP] >= 0) next = cur - MAP;
        else if (x > 0 && cur - 1 !== prev && kind[cur - 1] >= 0) next = cur - 1;
        else if (x < MAP - 1 && cur + 1 !== prev && kind[cur + 1] >= 0) next = cur + 1;
        else if (cur < TILES - MAP && cur + MAP !== prev && kind[cur + MAP] >= 0) next = cur + MAP;
        prev = cur;
        cur = next;
      }
      const v = nodeOf[cur];
      if (v <= n) {
        nTiles = chainFrom; // found from the other end, or a loop back to itself
        continue;
      }
      eA[E] = n;
      eB[E] = v;
      E++;
      eStart[E] = nTiles;
    }
  }
  const adjCount = monthI32(V + 1);
  for (let e = 0; e < E; e++) {
    adjCount[eA[e] + 1]++;
    adjCount[eB[e] + 1]++;
  }
  for (let n = 0; n < V; n++) adjCount[n + 1] += adjCount[n];
  const adjStart = Int32Array.from(adjCount);
  const fillAt = monthI32(V + 1);
  fillAt.set(adjCount);
  const adjEdge = new Int32Array(2 * E);
  const adjNode = new Int32Array(2 * E);
  for (let e = 0; e < E; e++) {
    adjNode[fillAt[eA[e]]] = eB[e];
    adjEdge[fillAt[eA[e]]++] = e;
    adjNode[fillAt[eB[e]]] = eA[e];
    adjEdge[fillAt[eB[e]]++] = e;
  }
  const portNode = new Int32Array(DISTRICTS).fill(-1);
  for (let d = 0; d < DISTRICTS; d++) if (port[d] >= 0) portNode[d] = nodeOf[port[d]];
  const signNode = Int32Array.from(SIGNPOSTS.map((sg) => (sg >= 0 && kind[sg] >= 0 ? nodeOf[sg] : -1)));
  // The district each cell's access is measured from.
  const cellDistrict = new Int16Array(CELLS).fill(-1);
  const ported: number[] = [];
  for (let d = 0; d < DISTRICTS; d++) if (port[d] >= 0) ported.push(d);
  // The answer depends only on the cell's own district (dx, dy): find it once per district.
  const nearestPorted = monthI16(DISTRICTS);
  for (let own = 0; own < DISTRICTS; own++) {
    const dx = own % DISTRICTS_PER_SIDE;
    const dy = (own - dx) / DISTRICTS_PER_SIDE;
    let best = -1;
    let bd = 99;
    for (let k = 0; k < ported.length; k++) {
      const d = ported[k];
      const ex = d % DISTRICTS_PER_SIDE;
      const ey = (d - ex) / DISTRICTS_PER_SIDE;
      const m = Math.abs(ex - dx) + Math.abs(ey - dy);
      if (m < bd) {
        bd = m;
        best = d;
      }
    }
    nearestPorted[own] = best;
  }
  for (let c = 0; c < CELLS; c++) {
    const cx = c % CELLS_PER_SIDE;
    const cy = (c - cx) / CELLS_PER_SIDE;
    cellDistrict[c] = nearestPorted[(cy >> 2) * DISTRICTS_PER_SIDE + (cx >> 2)];
  }

  return {
    key,
    reach,
    kind,
    rail,
    railTiles,
    hasRail: nRail > 0,
    roads,
    comp,
    comps,
    attach,
    attachDist,
    port,
    nodeTile,
    nodeOf,
    edgeA: eA.slice(0, E),
    edgeB: eB.slice(0, E),
    edgeStart: eStart.slice(0, E + 1),
    edgeTiles: eTiles.slice(0, nTiles),
    adjStart,
    adjEdge,
    adjNode,
    portNode,
    signNode,
    kingsportComp: SIGNPOST_KINGSPORT >= 0 && kind[SIGNPOST_KINGSPORT] >= 0 ? comp[SIGNPOST_KINGSPORT] : -1,
    cellDistrict,
  };
}

/** buildRoadNet's scratch: each road tile's frontage (map neighbours that are not road), by road index. */
const FRONT = new Int32Array(TILES);

/** Per-tile minutes along a road (lane 1.2, street 0.8, avenue 0.5, County Road at avenue speed). */
export function roadMinutes(kind: number): number {
  return ROAD_DEFS[kind].minutesPerTile;
}

/** Per-tile capacity in trips per peak. */
export function roadCapacity(kind: number): number {
  return ROAD_DEFS[kind].capacity;
}

// ---- Shortest paths on the compressed graph -------------------------------------------------

// Scratch for the bucket queue, reused across calls (each call resets what it reads).
let HEAD = new Int32Array(0);
let ENODE = new Int32Array(0);
let ENEXT = new Int32Array(0);
let DONE = new Uint8Array(0);

/**
 * Dijkstra from `src` over the compressed graph, writing into flat arrays at
 * offset `off` (so many trees share one pool). Arc weights are per adjacency
 * entry (arcWeights). With `want` (a per-node mark) and `wanted` > 0 it stops
 * once that many marked nodes are settled. Returns how many nodes it settled;
 * their order (parents before children) is order[off .. off + count).
 *
 * The queue is a ring of buckets δ minutes wide (Dial's method) with δ no
 * larger than the lightest arc. That keeps it exact: a node settled from
 * bucket k can only reach nodes at k·δ + (an arc ≥ δ), so never one in its own
 * bucket, and every node in bucket k already has its final distance when the
 * bucket is opened. Within a bucket nodes leave in a fixed order (last in,
 * first out), so equal-cost paths resolve the same way on every engine.
 */
export function dijkstraInto(
  net: RoadNet,
  aw: Float64Array,
  src: number,
  dist: Float64Array,
  parent: Int32Array,
  order: Int32Array,
  off: number,
  want: Uint8Array | null = null,
  wanted = 0,
  arcRange: Float64Array | null = null,
): number {
  const V = net.nodeTile.length;
  dist.fill(Infinity, off, off + V);
  parent.fill(-1, off, off + V);
  if (src < 0) return 0;
  // The lightest and heaviest arc (arcRange: the caller's [min, max] of these same weights, found once for many trees).
  let minArc = Infinity;
  let maxArc = 0;
  if (arcRange !== null) {
    minArc = arcRange[0];
    maxArc = arcRange[1];
  } else {
    arcSpan(aw, ARC_SPAN);
    minArc = ARC_SPAN[0];
    maxArc = ARC_SPAN[1];
  }
  const delta = minArc < 0.25 ? minArc : 0.25;
  if (!(delta > 0)) return dijkstraHeap(net, aw, src, dist, parent, order, off, want, wanted);
  const NB = Math.floor(maxArc / delta) + 2;
  if (HEAD.length < NB) HEAD = new Int32Array(NB);
  HEAD.fill(-1, 0, NB);
  const cap = aw.length + 1;
  if (ENODE.length < cap) {
    ENODE = new Int32Array(cap);
    ENEXT = new Int32Array(cap);
  }
  if (DONE.length < V) DONE = new Uint8Array(V);
  const done = DONE;
  done.fill(0, 0, V);
  const adjStart = net.adjStart;
  const adjEdge = net.adjEdge;
  const adjNode = net.adjNode;
  let left = want ? wanted : -1;
  let entries = 1;
  let pending = 1;
  let cur = 0;
  let count = 0;
  dist[off + src] = 0;
  ENODE[0] = src;
  ENEXT[0] = -1;
  HEAD[0] = 0;
  while (pending > 0) {
    const slot = cur % NB;
    const e = HEAD[slot];
    if (e < 0) {
      cur++;
      continue;
    }
    HEAD[slot] = ENEXT[e];
    pending--;
    const n = ENODE[e];
    if (done[n]) continue;
    const d = dist[off + n];
    if (Math.floor(d / delta) !== cur) continue; // a stale entry: n was improved into an earlier bucket
    done[n] = 1;
    order[off + count++] = n;
    if (want && want[n] && --left === 0) break;
    for (let k = adjStart[n], end = adjStart[n + 1]; k < end; k++) {
      const o = adjNode[k];
      if (done[o]) continue;
      const nd = d + aw[k];
      if (!(nd < dist[off + o])) continue;
      dist[off + o] = nd;
      parent[off + o] = adjEdge[k];
      const b = Math.floor(nd / delta) % NB;
      if (entries >= ENODE.length) {
        const grow = (a: Int32Array) => {
          const x = new Int32Array(a.length * 2);
          x.set(a);
          return x;
        };
        ENODE = grow(ENODE);
        ENEXT = grow(ENEXT);
      }
      ENODE[entries] = o;
      ENEXT[entries] = HEAD[b];
      HEAD[b] = entries;
      entries++;
      pending++;
    }
  }
  return count;
}

/** [min, max] of the arc weights into `out` (Infinity and 0 for none), as dijkstraInto scans them. */
export function arcSpan(aw: Float64Array, out: Float64Array): void {
  let minArc = Infinity;
  let maxArc = 0;
  for (let k = 0; k < aw.length; k++) {
    const x = aw[k];
    if (x < minArc) minArc = x;
    if (x > maxArc) maxArc = x;
  }
  out[0] = minArc;
  out[1] = maxArc;
}
const ARC_SPAN = new Float64Array(2);

/** The binary-heap Dijkstra (used only if some arc weighs nothing, where buckets cannot be exact). */
function dijkstraHeap(
  net: RoadNet,
  aw: Float64Array,
  src: number,
  dist: Float64Array,
  parent: Int32Array,
  order: Int32Array,
  off: number,
  want: Uint8Array | null,
  wanted: number,
): number {
  const V = net.nodeTile.length;
  const pos = new Int32Array(V).fill(-1);
  const heap = new Int32Array(V);
  let left = want ? wanted : -1;
  let size = 1;
  let count = 0;
  dist[off + src] = 0;
  heap[0] = src;
  pos[src] = 0;
  const less = (a: number, b: number) => dist[off + a] < dist[off + b] || (dist[off + a] === dist[off + b] && a < b);
  while (size > 0) {
    const n = heap[0];
    pos[n] = -2;
    size--;
    if (size > 0) {
      const x = heap[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], x)) break;
        heap[i] = heap[c];
        pos[heap[i]] = i;
        i = c;
      }
      heap[i] = x;
      pos[x] = i;
    }
    order[off + count++] = n;
    if (want && want[n] && --left === 0) break;
    for (let k = net.adjStart[n]; k < net.adjStart[n + 1]; k++) {
      const o = net.adjNode[k];
      if (pos[o] === -2) continue;
      const nd = dist[off + n] + aw[k];
      if (!(nd < dist[off + o])) continue;
      dist[off + o] = nd;
      parent[off + o] = net.adjEdge[k];
      let i = pos[o] < 0 ? size++ : pos[o];
      while (i > 0) {
        const pi = (i - 1) >> 1;
        if (!less(o, heap[pi])) break;
        heap[i] = heap[pi];
        pos[heap[i]] = i;
        i = pi;
      }
      heap[i] = o;
      pos[o] = i;
    }
  }
  return count;
}

/** Edge weights laid out per adjacency entry (what the Dijkstra loop reads). */
export function arcWeights(net: RoadNet, w: Float64Array, into?: Float64Array): Float64Array {
  const out = into ?? new Float64Array(net.adjEdge.length);
  for (let k = 0; k < net.adjEdge.length; k++) out[k] = w[net.adjEdge[k]];
  return out;
}

/** Edge weights from per-tile minutes: half of each end node plus every interior tile. */
export function edgeWeights(net: RoadNet, tileMinutes: Float64Array, into?: Float64Array): Float64Array {
  const E = net.edgeA.length;
  const w = into ?? new Float64Array(E);
  for (let e = 0; e < E; e++) {
    let s = (tileMinutes[net.nodeTile[net.edgeA[e]]] + tileMinutes[net.nodeTile[net.edgeB[e]]]) / 2;
    for (let k = net.edgeStart[e]; k < net.edgeStart[e + 1]; k++) s += tileMinutes[net.edgeTiles[k]];
    w[e] = s;
  }
  return w;
}

// ---- The month's occupancy --------------------------------------------------------------------

export interface BuildingInfo {
  index: number;
  kind: number;
  def: BuildingDef;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: number;
  tiles: number[];
  /** Built (no construction left at the anchor). */
  complete: boolean;
  /** Built and not closed by an incident. */
  active: boolean;
  /** 0–1 (A26: written by WP2b in M5, read here the month after). Buildings with no staff are 1. */
  staffFill: number;
  /** Persons needed (Town Hall: 4 + 1 per 500 residents). */
  staffNeeded: number;
  staffMix: readonly number[];
  /** Best attachment road tile over the footprint, or −1, and its distance. */
  attach: number;
  attachDist: number;
  /** Footprint centre in tile coordinates. */
  cx: number;
  cy: number;
  /** District trips to and from it use (its attachment's, else its own cell's). */
  district: number;
  /** fields.fundEffect of the building's funding dial. */
  fundEffect: number;
}

export interface SpaceModel {
  net: RoadNet;
  terrain: Uint8Array;
  /** Per tile: zone index or −1 (zoned tiles only). */
  zone: Int8Array;
  /** Per tile: the level that counts this month (0 while empty, building, or closed). */
  level: Uint8Array;
  /** Per tile: residents and jobs this month (persons). */
  res: Float64Array;
  jobs: Float64Array;
  /** Per tile: 1 under construction (sparse list expanded). */
  building: Uint8Array;
  /** Per tile: MARK_* bits (sparse list expanded). */
  marks: Uint8Array;
  buildings: BuildingInfo[];
  // Per cell.
  cellRes: Float64Array;
  cellChildren: Float64Array;
  cellFamilies: Float64Array;
  cellRetired: Float64Array;
  cellJobs: Float64Array;
  /** Cells with residents, ascending. */
  popCells: Int32Array;
  /** Zoned tiles, ascending (zonedTiles: shared, read only); every tile with a level is one. */
  zoned: Int32Array;
  /** RoadNet.cellDistrict. */
  cellDistrict: Int16Array;
  // Per district (trips use the district of the attachment road).
  distWorkers: Float64Array[];
  distJobsT: Float64Array[];
  distJobs: Float64Array;
  distRes: Float64Array;
  /** Workers per tier whose home touches no road (they cannot commute). */
  unattachedWorkers: number[];
  // Town totals.
  pop: number;
  /** Residents per tier (W + P + C + R; Students apart). */
  tierPop: number[];
  workforce: number[];
  children: number;
  retirees: number;
  retireesByTier: number[];
  students: number;
  /** Completed Homes capacity per tier. */
  homesCap: number[];
}

/** Civic footprint class: 1 tile, ≤ 4, ≤ 9, larger (params.build.civicTicks uses the same split). */
export function areaClass(area: number): number {
  return area <= 1 ? 0 : area <= 4 ? 1 : area <= 9 ? 2 : 3;
}

/** Staff a civic building needs (§6: Town Hall 4 + 1 per 500 residents). */
export function staffNeededOf(def: BuildingDef, pop: number): number {
  return def.staff + (def.staffPerResidents ? Math.floor(pop / def.staffPerResidents) : 0);
}

/** A2: Hamlet-tier civic buildings hire £ only; the rest use the public-service mix. */
export function staffMixOf(def: BuildingDef): readonly number[] {
  return def.tier === 0 ? ENTRY_MIX_L1 : CIVIC_MIX;
}

const FOOTPRINTS = new Map<number, number[]>();

/**
 * The in-map tiles of a w×h footprint at (x, y), row by row: memoised and
 * SHARED (BuildingInfo.tiles is read only), since every month rebuilt the
 * same lists for every building.
 */
function footprintTiles(x: number, y: number, w: number, h: number): number[] {
  const cacheable = Number.isInteger(x) && Number.isInteger(y) && x >= -64 && x < 192 && y >= -64 && y < 192 && Number.isInteger(w) && Number.isInteger(h) && w >= 0 && w < 64 && h >= 0 && h < 64;
  const key = cacheable ? ((x + 64) * 256 + (y + 64)) * 4096 + w * 64 + h : -1;
  if (cacheable) {
    const hit = FOOTPRINTS.get(key);
    if (hit) return hit;
  }
  const tiles: number[] = [];
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= MAP || yy >= MAP) continue;
      tiles.push(tileIndex(xx, yy));
    }
  if (cacheable) FOOTPRINTS.set(key, tiles);
  return tiles;
}

/** Building i's footprint, status and attachment. */
export function buildingInfos(t: TownState, net: RoadNet, construction: Uint8Array, p: Params, pop: number): BuildingInfo[] {
  const out: BuildingInfo[] = [];
  for (let i = 0; i < t.buildings.length; i++) {
    const b = t.buildings[i];
    const kind = b[B_KIND];
    const def = BUILDINGS[kind];
    if (!def) continue;
    const [w, h] = footprint(def.w, def.h, b[B_ROT]);
    const x = b[B_X];
    const y = b[B_Y];
    const tiles = footprintTiles(x, y, w, h);
    let attach = -1;
    let ad = 127;
    for (let k = 0; k < tiles.length; k++) {
      const ti = tiles[k];
      const a = net.attach[ti];
      if (a >= 0 && (net.attachDist[ti] < ad || (net.attachDist[ti] === ad && a < attach))) {
        attach = a;
        ad = net.attachDist[ti];
      }
    }
    const anchor = tileIndex(x, y);
    const complete = construction[anchor] === 0;
    const staffNeeded = staffNeededOf(def, pop);
    const fill = staffNeeded > 0 ? clamp01((b[B_STAFF] ?? 1000) / 1000) : 1;
    const fundKey = FUNDING_KEYS.indexOf(def.funding);
    const fund = t.funding[fundKey] ?? 1;
    out.push({
      index: i,
      kind,
      def,
      x,
      y,
      w,
      h,
      anchor,
      tiles,
      complete,
      active: complete && !(b[B_DAMAGED] > 0),
      staffFill: fill,
      staffNeeded,
      staffMix: staffMixOf(def),
      attach,
      attachDist: ad,
      cx: x + w / 2,
      cy: y + h / 2,
      district: -1,
      fundEffect: p.fields.fundEffect[fund] ?? 1,
    });
  }
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Per tile 1 where a sparse [tile, value] list has a positive value. */
function expand(list: readonly number[]): Uint8Array {
  const out = monthU8(TILES);
  for (let i = 0; i + 1 < list.length; i += 2) {
    const tile = list[i];
    if (tile >= 0 && tile < TILES && list[i + 1] > 0) out[tile] = 1;
  }
  return out;
}

/** Builds the month's occupancy model from stored state alone. */
export function buildModel(t: TownState, p: Params): SpaceModel {
  const net = roadNetOf(t, p.develop.roadReach);
  const terrain = terrainOf(t);
  const pl = planesOf(t);
  const building = expand(t.construction);
  const marks = monthU8(TILES);
  for (let i = 0; i + 1 < t.marks.length; i += 2) if (t.marks[i] >= 0 && t.marks[i] < TILES) marks[t.marks[i]] = t.marks[i + 1] & 0xff;

  const P = t.people;
  const tierPop = [0, 0, 0];
  for (let h = 0; h < 3; h++) tierPop[h] = P[person(STAGE_W, h)] + P[person(STAGE_P, h)] + P[person(STAGE_C, h)] + P[person(STAGE_R, h)];
  const students = P[PERSON_S] ?? 0;
  const pop = tierPop[0] + tierPop[1] + tierPop[2] + students;
  const part = p.people.participation;

  // Completed tiles: zone, level and capacity.
  const zone = monthI8(TILES).fill(-1);
  const level = monthU8(TILES);
  const homesCap = [0, 0, 0];
  const zoned = zonedTiles(pl.use);
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    const u = pl.use[i];
    if (useCat(u) !== CAT_ZONE) continue;
    const z = usePayload(u);
    zone[i] = z;
    const lv = lvlLevel(pl.lvl[i]);
    if (lv === 0 || building[i] || marks[i] & MARK_DAMAGED) continue;
    const cap = ZONE_DEFS[z]?.capacity[lv - 1] ?? 0;
    if (cap <= 0) continue;
    level[i] = lv;
    if (z === Z_HOMES) homesCap[lvlTier(pl.lvl[i]) > 2 ? 2 : lvlTier(pl.lvl[i])] += cap;
  }

  // Residents: each tier fills its own homes in proportion to capacity; a
  // tier with no homes of its own (and Students when there are no £ or ££
  // homes) spreads over every home. Nobody is placed where there is no home.
  const totalCap = homesCap[0] + homesCap[1] + homesCap[2];
  const own = [0, 0, 0];
  const spill = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    if (homesCap[h] > 0) own[h] = tierPop[h] / homesCap[h];
    else if (totalCap > 0) spill[h] = tierPop[h] / totalCap;
  }
  const sTier = homesCap[0] > 0 ? 0 : homesCap[1] > 0 ? 1 : -1;
  const sOwn = sTier >= 0 ? students / homesCap[sTier] : 0;
  const sSpill = sTier < 0 && totalCap > 0 ? students / totalCap : 0;
  const share = (h: number, stage: number) => (tierPop[h] > 0 ? P[person(stage, h)] / tierPop[h] : 0);
  const wfShare = [0, 1, 2].map((h) => part.W * share(h, STAGE_W) + part.P * share(h, STAGE_P));
  const childShare = [0, 1, 2].map((h) => share(h, STAGE_C));
  const famShare = [0, 1, 2].map((h) => share(h, STAGE_C) + share(h, STAGE_P));
  const retShare = [0, 1, 2].map((h) => share(h, STAGE_R));

  const cellDistrict = net.cellDistrict;
  const res = monthF64(TILES);
  const jobs = monthF64(TILES);
  const cellRes = monthF64(CELLS);
  const cellChildren = monthF64(CELLS);
  const cellFamilies = monthF64(CELLS);
  const cellRetired = monthF64(CELLS);
  const cellJobs = monthF64(CELLS);
  const distWorkers = [monthF64(DISTRICTS), monthF64(DISTRICTS), monthF64(DISTRICTS)];
  const distJobsT = [monthF64(DISTRICTS), monthF64(DISTRICTS), monthF64(DISTRICTS)];
  const distJobs = monthF64(DISTRICTS);
  const distRes = monthF64(DISTRICTS);
  const unattachedWorkers = [0, 0, 0];
  const mix = mixFor(p.labour.entryMixL2);
  // Only zoned tiles have a level.
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    const lv = level[i];
    if (lv === 0) continue;
    const z = zone[i];
    const cap = ZONE_DEFS[z].capacity[lv - 1];
    const c = CELL_OF[i];
    const a = net.attach[i];
    const d = a >= 0 ? DISTRICT_OF[a] : -1;
    if (z === Z_HOMES) {
      const tier = lvlTier(pl.lvl[i]) > 2 ? 2 : lvlTier(pl.lvl[i]);
      let r = 0;
      let kids = 0;
      let fam = 0;
      let ret = 0;
      for (let h = 0; h < 3; h++) {
        const rh = cap * ((tier === h ? own[h] : 0) + spill[h]);
        if (rh === 0) continue;
        r += rh;
        kids += rh * childShare[h];
        fam += rh * famShare[h];
        ret += rh * retShare[h];
        const wf = rh * wfShare[h];
        if (d >= 0) distWorkers[h][d] += wf;
        else unattachedWorkers[h] += wf;
      }
      const s = cap * ((tier === sTier ? sOwn : 0) + sSpill);
      if (s > 0) {
        r += s;
        if (d >= 0) distWorkers[0][d] += s * part.S;
        else unattachedWorkers[0] += s * part.S;
      }
      res[i] = r;
      cellRes[c] += r;
      cellChildren[c] += kids;
      cellFamilies[c] += fam;
      cellRetired[c] += ret;
      if (d >= 0) distRes[d] += r;
    } else {
      jobs[i] = cap;
      cellJobs[c] += cap;
      if (d < 0) continue;
      const row = (ZONE_SECTOR[z] * 6 + lv) * 3;
      distJobsT[0][d] += cap * mix[row];
      distJobsT[1][d] += cap * mix[row + 1];
      distJobsT[2][d] += cap * mix[row + 2];
      distJobs[d] += cap;
    }
  }

  // Civic buildings: staff are jobs too, in the district they are reached from.
  const buildings = buildingInfos(t, net, building, p, pop);
  for (const b of buildings) {
    b.district = b.attach >= 0 ? districtOf(b.attach) : cellDistrict[cellOf(tileIndex(Math.min(MAP - 1, Math.floor(b.cx)), Math.min(MAP - 1, Math.floor(b.cy))))];
    if (!b.active || b.staffNeeded <= 0) continue;
    const c = cellOf(b.anchor);
    cellJobs[c] += b.staffNeeded;
    if (b.district < 0) continue;
    for (let h = 0; h < 3; h++) if (b.staffMix[h] > 0) distJobsT[h][b.district] += b.staffNeeded * b.staffMix[h];
    distJobs[b.district] += b.staffNeeded;
  }

  const workforce = [0, 1, 2].map((h) => part.W * P[person(STAGE_W, h)] + part.P * P[person(STAGE_P, h)] + (h === 0 ? part.S * students : 0));
  let nPop = 0;
  for (let c = 0; c < CELLS; c++) if (cellRes[c] > 0) nPop++;
  const popCells = monthI32(nPop);
  nPop = 0;
  for (let c = 0; c < CELLS; c++) if (cellRes[c] > 0) popCells[nPop++] = c;
  return {
    net,
    terrain,
    zone,
    level,
    res,
    jobs,
    building,
    marks,
    buildings,
    cellRes,
    cellChildren,
    cellFamilies,
    cellRetired,
    cellJobs,
    popCells,
    zoned,
    cellDistrict,
    distWorkers,
    distJobsT,
    distJobs,
    distRes,
    unattachedWorkers,
    pop,
    tierPop,
    workforce,
    children: P[person(STAGE_C, 0)] + P[person(STAGE_C, 1)] + P[person(STAGE_C, 2)],
    retirees: P[person(STAGE_R, 0)] + P[person(STAGE_R, 1)] + P[person(STAGE_R, 2)],
    retireesByTier: [P[person(STAGE_R, 0)], P[person(STAGE_R, 1)], P[person(STAGE_R, 2)]],
    students,
    homesCap,
  };
}

/** Is tile i a beach (sand on the coast) inside an open parcel? */
export function isBeach(t: TownState, terrain: Uint8Array, i: number): boolean {
  return terrainKind(terrain[i]) === T_SAND && (terrain[i] & TF_COAST) !== 0 && parcelOpen(t, tileX(i), tileY(i));
}

/** A Leisure tile grown as a hotel (its beds at its level). */
export function hotelBeds(lvlByte: number, level: number): number {
  const beds = ZONE_DEFS[Z_LEISURE].beds;
  return lvlTier(lvlByte) === VARIANT_HOTEL && beds ? (beds[level - 1] ?? 0) : 0;
}

/** Each cell's centre in tile coordinates (2·cx + 1, 2·cy + 1). */
export const CELL_X = (() => {
  const out = new Float64Array(CELLS);
  for (let c = 0; c < CELLS; c++) out[c] = 2 * (c % CELLS_PER_SIDE) + 1;
  return out;
})();
export const CELL_Y = (() => {
  const out = new Float64Array(CELLS);
  for (let c = 0; c < CELLS; c++) out[c] = 2 * ((c - (c % CELLS_PER_SIDE)) / CELLS_PER_SIDE) + 1;
  return out;
})();

/** Manhattan distance in cells between cell c's centre and a point in tile coordinates. */
export function cellDistance(c: number, px: number, py: number): number {
  const dx = CELL_X[c] - px;
  const dy = CELL_Y[c] - py;
  return ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy)) / 2;
}

/**
 * The rectangle of cells [x0, x1, y0, y1] whose centres can lie within
 * `radiusTiles` (Manhattan, in tiles) of a point: loops scan it instead of all
 * 1,024 cells. Infinity gives the whole grid.
 */
export function cellBox(px: number, py: number, radiusTiles: number): [number, number, number, number] {
  if (radiusTiles === Infinity) return [0, CELLS_PER_SIDE - 1, 0, CELLS_PER_SIDE - 1];
  // Written out rather than as two small closures: servicesOf calls this for every building, every month.
  return [
    Math.max(0, Math.ceil((px - radiusTiles - 1) / 2)),
    Math.min(CELLS_PER_SIDE - 1, Math.floor((px + radiusTiles - 1) / 2)),
    Math.max(0, Math.ceil((py - radiusTiles - 1) / 2)),
    Math.min(CELLS_PER_SIDE - 1, Math.floor((py + radiusTiles - 1) / 2)),
  ];
}

/** cellBox into `out` [x0, x1, y0, y1] (the same numbers, for loops that would otherwise allocate the tuple per building). */
export function cellBoxInto(px: number, py: number, radiusTiles: number, out: Int32Array): void {
  if (radiusTiles === Infinity) {
    out[0] = 0;
    out[1] = CELLS_PER_SIDE - 1;
    out[2] = 0;
    out[3] = CELLS_PER_SIDE - 1;
    return;
  }
  out[0] = Math.max(0, Math.ceil((px - radiusTiles - 1) / 2));
  out[1] = Math.min(CELLS_PER_SIDE - 1, Math.floor((px + radiusTiles - 1) / 2));
  out[2] = Math.max(0, Math.ceil((py - radiusTiles - 1) / 2));
  out[3] = Math.min(CELLS_PER_SIDE - 1, Math.floor((py + radiusTiles - 1) / 2));
}

/**
 * §5.4 falloff for a radius in tiles: full strength up to half the radius
 * (in cells), then linear to zero at the radius. Infinity covers the town.
 */
export function falloff(d: number, radiusTiles: number): number {
  if (radiusTiles === Infinity) return 1;
  const r = radiusTiles / 2;
  if (r <= 0) return 0;
  if (d <= r / 2) return 1;
  if (d >= r) return 0;
  return (r - d) / (r / 2);
}

/**
 * Decodes a stored 32×32 plane, falling back to `fill` for a missing or broken
 * string. With `shared`, a good decode is the memoised copy (decodeCellsShared):
 * the caller must only read it.
 */
export function cellsOr(s: string | undefined, fill: number, shared = false): Uint8Array {
  if (typeof s === 'string' && s.length > 0) {
    try {
      return shared ? decodeCellsShared(s) : decodeCells(s);
    } catch {
      // fall through
    }
  }
  return new Uint8Array(CELLS).fill(fill);
}

// ---- Scratch arrays ----------------------------------------------------------------------------

const SCRATCH = new Map<string, Float64Array<ArrayBuffer>>();

/**
 * A zeroed Float64 scratch array of length n, reused between calls under
 * `name` (a month allocates about a megabyte of working arrays otherwise, and
 * the collector's pauses showed up in the p95). Only for arrays that never
 * leave the function that asked: anything published in a slot is fresh.
 */
export function scratch(name: string, n: number): Float64Array<ArrayBuffer> {
  let a = SCRATCH.get(name);
  if (!a || a.length < n) {
    a = new Float64Array(n);
    SCRATCH.set(name, a);
  }
  const v = a.length === n ? a : a.subarray(0, n);
  v.fill(0);
  return v;
}

const SCRATCH_I32 = new Map<string, Int32Array<ArrayBuffer>>();
const SCRATCH_U8 = new Map<string, Uint8Array<ArrayBuffer>>();

/** As scratch, for Int32 arrays. */
export function scratchI32(name: string, n: number): Int32Array<ArrayBuffer> {
  let a = SCRATCH_I32.get(name);
  if (!a || a.length < n) {
    a = new Int32Array(n);
    SCRATCH_I32.set(name, a);
  }
  const v = a.length === n ? a : a.subarray(0, n);
  v.fill(0);
  return v;
}

/** As scratch, for byte arrays. */
export function scratchU8(name: string, n: number): Uint8Array<ArrayBuffer> {
  let a = SCRATCH_U8.get(name);
  if (!a || a.length < n) {
    a = new Uint8Array(n);
    SCRATCH_U8.set(name, a);
  }
  const v = a.length === n ? a : a.subarray(0, n);
  v.fill(0);
  return v;
}

// ---- One month's run --------------------------------------------------------------------------

/**
 * The work the space steps share within one month (or one pure query). The
 * modules attach their results here lazily; nothing in it outlives the month.
 */
export interface SpaceRun {
  t: TownState;
  ctx: TickContext;
  p: Params;
  /** The month's blackboard (null for a pure query, which computes everything itself). */
  derived: DerivedCache | null;
  model: SpaceModel | null;
  utilities: unknown;
  services: unknown;
  travel: unknown;
  fields: unknown;
}

const RUNS = new WeakMap<object, SpaceRun>();

/** The month's run for this blackboard (created on first use by M2, M3 or M4). */
export function runFor(t: TownState, ctx: TickContext, derived: DerivedCache | null): SpaceRun {
  if (derived) {
    const hit = RUNS.get(derived);
    if (hit && hit.t === t) return hit;
  }
  const run: SpaceRun = { t, ctx, p: ctx.params, derived, model: null, utilities: null, services: null, travel: null, fields: null };
  if (derived) RUNS.set(derived, run);
  return run;
}

export function modelOf(run: SpaceRun): SpaceModel {
  if (!run.model) run.model = buildModel(run.t, run.p);
  return run.model;
}

/** Is the policy card active? */
export function policyOn(t: TownState, card: string): boolean {
  for (const a of t.policies) if (a.card === card) return true;
  return false;
}
