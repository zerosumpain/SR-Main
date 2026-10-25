// M4 Transport (spec §5.9). The map has 64 districts of 8×8 tiles, each with
// a port on its road. Travel times come from shortest-path trees over the road
// tiles, which space.ts compresses to junctions, ports and signposts (a
// metropolis' 1,500 road tiles become about 220 nodes), so the times are exact
// for the tile network.
//
// Each road tile costs its kind's minutes × its district's BPR factor
// 1 + 0.15·(Load/Cap)^4 (last month's, stored in lag.congestion: A26) ×
// potholes (roads funded Low) × the Car-Free Centre factor. Workers commute by
// production-constrained gravity, tier by tier,
//
//   Trips_h(a→b) = Workers_h(a) · Jobs_h(b)·e^(−c_ab/λ_h) / Σ_b' Jobs_h(b')·e^(−c_ab'/λ_h),
//
// over the job districts within 60 minutes; a district with none sends its
// workers nowhere ("too far to work"). Bus and rail take their shares of each
// covered pair, the rest drive, and car trips load the trees all-or-nothing.
//
// Two choices keep this stable and inside the month budget (WP2a acceptance):
// - Drivers keep their ROUTES until a district's congestion has moved by
//   transport.routeBand since they last re-routed. The factors they routed by
//   are stored (lag.routes, sticky per district), routes are the shortest
//   paths under them, and the trees are memoised per town on exactly those
//   weights; TIMES are always measured along the routes with the exact
//   factors. Everything is a pure function of stored state, so a revived town
//   and a long-running one agree whether or not the memo is warm. All-or-
//   nothing loading otherwise flips a whole corridor's traffic between
//   parallel roads every month, and regrowing 64 trees each time is most of
//   the month's cost.
// - The successive averages run ACROSS months: one assignment a month, and
//   the stored congestion blends this month's Load/Cap with last month's
//   (transport.carry). More passes inside a month (transport.passes) are
//   supported.
//
// M3 needs the same travel times (access, road pollution and noise), so it
// computes this through travelOf() and M4 publishes it: one set a month.

import { RAIL_DEF, RAIL_WAIT_MINUTES } from './content';
import { flowsFor } from './core';
import { monthF64, monthI16, monthI32, monthU8 } from './pool';
import { servicesOf } from './services';
import {
  DISTRICT_OF,
  arcWeights,
  decay,
  arcSpan,
  dijkstraInto,
  edgeWeights,
  modelOf,
  policyOn,
  roadCapacity,
  roadMinutes,
  runFor,
  scratch,
  scratchI32,
  type RoadNet,
  type SpaceRun,
} from './space';
import { CELLS_PER_SIDE, DISTRICTS, DISTRICTS_PER_SIDE, MAP, MARK_CARFREE, TILES, tileX } from './tiles';
import { FUNDING_KEYS, FUND_LOW, type MonthContext, type TownState, type TravelSlot } from './types';

export interface Travel {
  slot: TravelSlot;
  /** Car trips per district pair (all tiers), for tests and lenses. */
  trips: Float64Array;
}

/** BPR factor of a load-to-capacity ratio (§5.9), with the ratio capped. */
export function bprOf(ratio: number, alpha: number, maxRatio: number): number {
  const x = ratio > maxRatio ? maxRatio : ratio < 0 ? 0 : ratio;
  const x2 = x * x;
  return 1 + alpha * x2 * x2;
}

/** The Load/Cap a BPR factor stands for (the inverse of bprOf, by two square roots). */
export function ratioOfBpr(bpr: number, alpha: number): number {
  return bpr > 1 && alpha > 0 ? Math.sqrt(Math.sqrt((bpr - 1) / alpha)) : 0;
}

/**
 * Per-district Load/Cap from tile loads: the load-weighted mean ratio of the
 * district's road tiles (what the average trip through it experiences), capped.
 */
export function districtRatio(net: RoadNet, load: Float64Array, maxRatio: number): Float64Array {
  const num = monthF64(DISTRICTS);
  const den = monthF64(DISTRICTS);
  for (let k = 0; k < net.roads.length; k++) {
    const i = net.roads[k];
    const l = load[i];
    if (l <= 0) continue;
    const d = DISTRICT_OF[i];
    const r = l / roadCapacity(net.kind[i]);
    num[d] += l * (r > maxRatio ? maxRatio : r);
    den[d] += l;
  }
  const out = monthF64(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) out[d] = den[d] > 0 ? num[d] / den[d] : 0;
  return out;
}

/** Per-district BPR factors from tile loads. */
export function districtBpr(net: RoadNet, load: Float64Array, alpha: number, maxRatio: number): number[] {
  const x = districtRatio(net, load, maxRatio);
  const out = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) out[d] = bprOf(x[d], alpha, maxRatio);
  return out;
}

/** Mean of a per-cell array over each district's 4×4 cells. */
function perDistrict(cells: Float64Array): Float64Array {
  const out = monthF64(DISTRICTS);
  for (let c = 0; c < cells.length; c++) {
    const v = cells[c];
    if (v === 0) continue;
    const cx = c % CELLS_PER_SIDE;
    const cy = (c - cx) / CELLS_PER_SIDE;
    out[(cy >> 2) * DISTRICTS_PER_SIDE + (cx >> 2)] += v / 16;
  }
  return out;
}

function neighbours(i: number): number[] {
  const x = tileX(i);
  return [i >= MAP ? i - MAP : -1, x > 0 ? i - 1 : -1, x < MAP - 1 ? i + 1 : -1, i < TILES - MAP ? i + MAP : -1];
}

/** Rail time between districts (∞ where no two different connected stations serve them). */
function railTimes(run: SpaceRun): Float64Array | null {
  const m = modelOf(run);
  const net = m.net;
  const stations = m.buildings.filter((b) => b.active && b.def.id === 'railStation');
  if (stations.length < 2) return null;
  // Rail distance in tiles between stations: breadth-first over track from the tiles beside each station.
  const S = stations.length;
  const between = monthF64(S * S).fill(Infinity);
  const dist = monthI32(TILES);
  const queue = monthI32(TILES);
  const touching = stations.map((b) => {
    const out: number[] = [];
    for (const ti of b.tiles) for (const j of neighbours(ti)) if (j >= 0 && net.rail[j] && !out.includes(j)) out.push(j);
    return out.sort((a, b) => a - b);
  });
  for (let s = 0; s < S; s++) {
    dist.fill(-1);
    let head = 0;
    let tail = 0;
    for (const j of touching[s]) {
      dist[j] = 1;
      queue[tail++] = j;
    }
    while (head < tail) {
      const i = queue[head++];
      for (const j of neighbours(i)) {
        if (j < 0 || !net.rail[j] || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
    for (let o = 0; o < S; o++) {
      if (o === s) continue;
      let best = Infinity;
      for (const j of touching[o]) if (dist[j] > 0 && dist[j] < best) best = dist[j];
      between[s * S + o] = best;
    }
  }
  // Each district uses its nearest station (Manhattan from the district centre; lower index on ties).
  const nearest = monthI32(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) {
    const x = (d % DISTRICTS_PER_SIDE) * 8 + 4;
    const y = ((d - (d % DISTRICTS_PER_SIDE)) / DISTRICTS_PER_SIDE) * 8 + 4;
    let bi = 0;
    let bd = Infinity;
    for (let s = 0; s < S; s++) {
      const dd = Math.abs(stations[s].cx - x) + Math.abs(stations[s].cy - y);
      if (dd < bd) {
        bd = dd;
        bi = s;
      }
    }
    nearest[d] = bi;
  }
  const out = monthF64(DISTRICTS * DISTRICTS).fill(Infinity);
  const wait = run.p.transport.rail[1] ?? RAIL_WAIT_MINUTES;
  for (let a = 0; a < DISTRICTS; a++)
    for (let b = 0; b < DISTRICTS; b++) {
      const sa = nearest[a];
      const sb = nearest[b];
      if (sa === sb) continue;
      const tiles = between[sa * S + sb];
      if (tiles !== Infinity) out[a * DISTRICTS + b] = wait + RAIL_DEF.minutesPerTile * tiles + run.p.transport.terminalMinutes;
    }
  return out;
}

// ---- Routes: shortest-path trees, memoised per town on their (rounded) weights ---------------

/**
 * One month's routes: a tree from every port to the ports after it (the graph
 * is undirected, so a→b is the reverse of b→a and each pair needs one tree),
 * plus a whole tree from each signpost. Flat arrays, tree s at offset s·V.
 */
export interface Routes {
  net: RoadNet;
  /** The rounded arc weights they were grown on (the memo key). */
  key: Float64Array;
  /** Ports in district order, and their graph nodes. */
  portD: Int32Array;
  portN: Int32Array;
  parent: Int32Array;
  order: Int32Array;
  counts: Int32Array;
  /** Signpost trees (SIGNPOSTS order; count 0 where a signpost has no road). */
  signParent: Int32Array[];
  signOrder: Int32Array[];
  signCounts: number[];
}

const ROUTES = new WeakMap<TownState, Routes>();

function sameWeights(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/** Grows (or reuses) the routes for these rounded arc weights. */
export function routesFor(t: TownState, net: RoadNet, key: Float64Array): Routes {
  const hit = ROUTES.get(t);
  if (hit && hit.net === net && sameWeights(hit.key, key)) return hit;
  const V = net.nodeTile.length;
  const portList: number[] = [];
  for (let d = 0; d < DISTRICTS; d++) if (net.portNode[d] >= 0) portList.push(d);
  const P = portList.length;
  const portD = Int32Array.from(portList);
  const portN = Int32Array.from(portList.map((d) => net.portNode[d]));
  const dist = monthF64(V);
  const parent = new Int32Array(P * V);
  const order = new Int32Array(P * V);
  const counts = new Int32Array(P);
  const want = monthU8(V);
  const par = monthI32(V);
  const ord = monthI32(V);
  // Every tree runs on the same weights: their lightest and heaviest arc once, not once a tree.
  const span = monthF64(2);
  arcSpan(key, span);
  for (let s = 0; s < P; s++) {
    for (let q = s + 1; q < P; q++) want[portN[q]] = 1;
    const c = s < P - 1 ? dijkstraInto(net, key, portN[s], dist, par, ord, 0, want, P - 1 - s, span) : 0;
    for (let q = s + 1; q < P; q++) want[portN[q]] = 0;
    parent.set(par, s * V);
    if (c > 0) order.set(ord.subarray(0, c), s * V);
    else order[s * V] = portN[s];
    counts[s] = c > 0 ? c : 1;
  }
  const signParent: Int32Array[] = [];
  const signOrder: Int32Array[] = [];
  const signCounts: number[] = [];
  for (let k = 0; k < net.signNode.length; k++) {
    const sp = new Int32Array(V);
    const so = new Int32Array(V);
    signCounts.push(net.signNode[k] >= 0 ? dijkstraInto(net, key, net.signNode[k], dist, sp, so, 0, null, 0, span) : 0);
    signParent.push(sp);
    signOrder.push(so);
  }
  const out: Routes = { net, key: Float64Array.from(key), portD, portN, parent, order, counts, signParent, signOrder, signCounts };
  ROUTES.set(t, out);
  return out;
}

/** Forgets a town's memoised routes (tests: a cold month). */
export function forgetRoutes(t: TownState): void {
  ROUTES.delete(t);
}

/** Exact distances along a tree (its settle order is parent-first). Unreached nodes stay ∞. */
function measure(net: RoadNet, w: Float64Array, parent: Int32Array, order: Int32Array, off: number, count: number, out: Float64Array): void {
  out.fill(Infinity);
  if (count <= 0) return;
  out[order[off]] = 0;
  for (let k = 1; k < count; k++) {
    const n = order[off + k];
    const e = parent[off + n];
    const o = net.edgeA[e] === n ? net.edgeB[e] : net.edgeA[e];
    out[n] = out[o] + w[e];
  }
}

/** Pushes node flows up a tree onto its edges (leaves first). `flow` is left zeroed. */
function pushUp(net: RoadNet, parent: Int32Array, order: Int32Array, off: number, count: number, flow: Float64Array, edgeLoad: Float64Array): void {
  for (let k = count - 1; k > 0; k--) {
    const n = order[off + k];
    const f = flow[n];
    if (f === 0) continue;
    flow[n] = 0;
    const e = parent[off + n];
    edgeLoad[e] += f;
    flow[net.edgeA[e] === n ? net.edgeB[e] : net.edgeA[e]] += f;
  }
  flow[order[off]] = 0;
}

/**
 * Production-constrained gravity for one tier (kept small so the engine
 * inlines decay into it). Writes trips into `th` (P×P) and into `stats`:
 * [trips, trip-minutes, bus riders, rail riders, workers with no job in reach].
 */
function gravity(
  th: Float64Array,
  C: Float64Array,
  P: number,
  portD: Int32Array,
  W: Float64Array,
  J: Float64Array,
  stay: number,
  invLam: number,
  maxC: number,
  busS: Float64Array,
  railS: Float64Array,
  railC: Float64Array,
  busFactor: number,
  busWait: number,
  stats: Float64Array,
): void {
  th.fill(0);
  let n = 0;
  let sum = 0;
  let bus = 0;
  let rail = 0;
  let none = 0;
  for (let s = 0; s < P; s++) {
    const Ws = W[portD[s]] * stay;
    if (Ws <= 0) continue;
    const row = s * P;
    let S = 0;
    for (let q = 0; q < P; q++) {
      const Jq = J[portD[q]];
      const c = C[row + q];
      if (Jq > 0 && c <= maxC) {
        const g = Jq * decay(c * invLam);
        th[row + q] = g;
        S += g;
      }
    }
    if (S <= 0) {
      none += Ws;
      continue;
    }
    const k = Ws / S;
    for (let q = 0; q < P; q++) {
      const g = th[row + q];
      if (g === 0) continue;
      const x = g * k;
      th[row + q] = x;
      const car = C[row + q];
      const bs = busS[row + q];
      const rs = railS[row + q];
      n += x;
      sum += x * ((1 - bs - rs) * car + bs * (busFactor * car + busWait) + (rs > 0 ? rs * railC[row + q] : 0));
      bus += x * bs;
      rail += x * rs;
    }
  }
  stats[0] = n;
  stats[1] = sum;
  stats[2] = bus;
  stats[3] = rail;
  stats[4] = none;
}

/** The whole of M4 for one run (memoised: M3 computes it first for access and road pollution). */
export function travelOf(run: SpaceRun): Travel {
  if (run.travel) return run.travel as Travel;
  const { t, p } = run;
  const m = modelOf(run);
  const net = m.net;
  const svc = servicesOf(run);
  const tp = p.transport;
  const V = net.nodeTile.length;
  const E = net.edgeA.length;
  const lambda = p.labour.lambda;
  const maxC = p.labour.maxCommute;
  const [alpha, maxRatio] = tp.bpr;
  const roads = net.roads;
  const R = roads.length;

  // Fixed per-tile factors: potholes and the Car-Free Centre.
  const roadsLow = t.funding[FUNDING_KEYS.indexOf('roads')] === FUND_LOW;
  const carFree = policyOn(t, 'carFreeCentre');
  const base = scratch('tr.base', R);
  const dOf = scratchI32('tr.dOf', R);
  for (let k = 0; k < R; k++) {
    const i = roads[k];
    dOf[k] = DISTRICT_OF[i];
    let wk = roadMinutes(net.kind[i]);
    if (roadsLow) wk *= tp.potholes;
    if (carFree && m.marks[i] & MARK_CARFREE) wk *= tp.carFree;
    base[k] = wk;
  }

  const lagBpr = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) {
    const v = t.lag.congestion[d];
    lagBpr[d] = typeof v === 'number' && Number.isFinite(v) && v >= 1000 ? v / 1000 : 1;
  }

  // Workers and jobs by tier and district; out-commuters leave the local gravity.
  const flows = flowsFor(run.ctx);
  const wTot = [0, 0, 0];
  const jTot = [0, 0, 0];
  for (let h = 0; h < 3; h++)
    for (let d = 0; d < DISTRICTS; d++) {
      wTot[h] += m.distWorkers[h][d];
      jTot[h] += m.distJobsT[h][d];
    }
  const stay = [0, 1, 2].map((h) => (wTot[h] > 0 ? Math.max(0, 1 - (flows.commutersOut[h] ?? 0) / wTot[h]) : 1));

  // Transit: bus and rail coverage per district, rail times.
  const busD = perDistrict(svc.bus);
  const railD = perDistrict(svc.rail);
  const rail = railTimes(run);
  const [busMax, busFactor, busWait] = tp.bus;
  const busPolicy = policyOn(t, 'freeBusFridays') ? tp.freeBusFridays : 1;
  const railMax = tp.rail[0];
  let anyBus = false;
  for (let d = 0; d < DISTRICTS; d++) if (busD[d] > 0) anyBus = true;

  const tileW = scratch('tr.tileW', TILES);
  const tileQ = scratch('tr.tileQ', TILES);
  const w = scratch('tr.w', E);
  const wq = scratch('tr.wq', E);
  const awq = scratch('tr.awq', net.adjEdge.length);
  const nodeDist = scratch('tr.nodeDist', V);
  const flow = scratch('tr.flow', V);
  const edgeLoad = scratch('tr.edgeLoad', E);
  const loadSum = scratch('tr.loadSum', TILES);
  const tileLoad = scratch('tr.tileLoad', TILES);
  const passes = Math.max(1, Math.round(tp.passes));
  const routeBpr = routeFactors(t);
  let bpr = lagBpr;
  let routes: Routes | null = null;
  let P = 0;
  let C = new Float64Array(0);
  let busS = new Float64Array(0);
  let railS = new Float64Array(0);
  let railC = new Float64Array(0);
  let tripsH: Float64Array[] = [];
  const unreachable = [0, 0, 0];
  const avgCommute = [0, 0, 0];
  let tripsAll = 0;
  let busAll = 0;
  let railAll = 0;
  const kDist = monthF64(V).fill(Infinity);
  const kNode = net.signNode[0];
  const stats = monthF64(5);

  for (let pass = 0; pass < passes; pass++) {
    // Exact and route (rounded) weights.
    for (let k = 0; k < R; k++) {
      const i = roads[k];
      tileW[i] = base[k] * bpr[dOf[k]];
      tileQ[i] = base[k] * (pass === 0 ? routeBpr[dOf[k]] : bpr[dOf[k]]);
    }
    edgeWeights(net, tileW, w);
    edgeWeights(net, tileQ, wq);
    arcWeights(net, wq, awq);
    routes = routesFor(t, net, awq);
    const { portD, portN, parent, order, counts } = routes;
    if (P === 0) {
      P = portD.length;
      C = scratch('tr.C', P * P);
      busS = scratch('tr.bus', P * P);
      railS = scratch('tr.rail', P * P);
      railC = scratch('tr.railC', P * P).fill(Infinity);
      tripsH = [scratch('tr.t0', P * P), scratch('tr.t1', P * P), scratch('tr.t2', P * P)];
      if (anyBus || rail)
        for (let s = 0; s < P; s++) {
          const a = portD[s];
          const busA = busD[a];
          const railA = railD[a];
          for (let q = 0; q < P; q++) {
            const b = portD[q];
            const rt = rail ? rail[a * DISTRICTS + b] : Infinity;
            const bs = anyBus ? (busMax * Math.min(busA, busD[b]) * busPolicy) / 100 : 0;
            const rs = rt !== Infinity ? (railMax * Math.min(railA, railD[b])) / 100 : 0;
            const tot = bs + rs;
            const k = tot > tp.maxTransitShare ? tp.maxTransitShare / tot : 1;
            busS[s * P + q] = bs * k;
            railS[s * P + q] = rs * k;
            railC[s * P + q] = rt;
          }
        }
    }
    // Times along the routes, with the exact factors.
    for (let s = 0; s < P; s++) {
      measure(net, w, parent, order, s * V, counts[s], nodeDist);
      C[s * P + s] = tp.intraMinutes;
      for (let q = s + 1; q < P; q++) {
        const dd = nodeDist[portN[q]];
        const c = dd === Infinity ? Infinity : dd + tp.terminalMinutes;
        C[s * P + q] = c;
        C[q * P + s] = c;
      }
    }
    if (kNode >= 0) measure(net, w, routes.signParent[0], routes.signOrder[0], 0, routes.signCounts[0], kDist);

    // Gravity by tier over the job ports within reach, with the commute statistics.
    tripsAll = 0;
    busAll = 0;
    railAll = 0;
    for (let h = 0; h < 3; h++) {
      gravity(tripsH[h], C, P, portD, m.distWorkers[h], m.distJobsT[h], stay[h], 1 / lambda[h], maxC, busS, railS, railC, busFactor, busWait, stats);
      unreachable[h] = m.unattachedWorkers[h] + stats[4];
      avgCommute[h] = stats[0] > 0 ? stats[1] / stats[0] : 0;
      tripsAll += stats[0];
      busAll += stats[2];
      railAll += stats[3];
    }

    // All-or-nothing car loading: both directions of a pair on the earlier port's tree;
    // commuters to and from the Kingsport signpost on the signpost's tree.
    edgeLoad.fill(0);
    const t0 = tripsH[0];
    const t1 = tripsH[1];
    const t2 = tripsH[2];
    for (let s = 0; s < P; s++) {
      let any = false;
      for (let q = s + 1; q < P; q++) {
        const sq = s * P + q;
        const qs = q * P + s;
        const car = (t0[sq] + t1[sq] + t2[sq]) * (1 - busS[sq] - railS[sq]) + (t0[qs] + t1[qs] + t2[qs]) * (1 - busS[qs] - railS[qs]);
        if (car > 0 && C[sq] !== Infinity) {
          flow[portN[q]] += car * tp.peakShare;
          any = true;
        }
      }
      if (any) pushUp(net, parent, order, s * V, counts[s], flow, edgeLoad);
    }
    if (kNode >= 0 && routes.signCounts[0] > 0) {
      let any = false;
      for (let s = 0; s < P; s++) {
        const d = portD[s];
        let c = 0;
        for (let h = 0; h < 3; h++) {
          if (wTot[h] > 0) c += (flows.commutersOut[h] ?? 0) * (m.distWorkers[h][d] / wTot[h]);
          if (jTot[h] > 0) c += (flows.commutersIn[h] ?? 0) * (m.distJobsT[h][d] / jTot[h]);
        }
        if (c > 0 && kDist[portN[s]] !== Infinity) {
          flow[portN[s]] += c * tp.peakShare;
          any = true;
        }
      }
      if (any) pushUp(net, routes.signParent[0], routes.signOrder[0], 0, routes.signCounts[0], flow, edgeLoad);
    }

    // Tile loads: interior tiles carry their edge; a node carries its busiest edge.
    tileLoad.fill(0);
    for (let e = 0; e < E; e++) {
      const l = edgeLoad[e];
      if (l === 0) continue;
      for (let k = net.edgeStart[e]; k < net.edgeStart[e + 1]; k++) tileLoad[net.edgeTiles[k]] = l;
      const ta = net.nodeTile[net.edgeA[e]];
      const tb = net.nodeTile[net.edgeB[e]];
      if (l > tileLoad[ta]) tileLoad[ta] = l;
      if (l > tileLoad[tb]) tileLoad[tb] = l;
    }
    for (let k = 0; k < R; k++) loadSum[roads[k]] += tileLoad[roads[k]];
    // Successive averages inside the month: the next pass sees the BPR of the mean load so far.
    if (pass < passes - 1) {
      for (let k = 0; k < R; k++) tileLoad[roads[k]] = loadSum[roads[k]] / (pass + 1);
      bpr = districtBpr(net, tileLoad, alpha, maxRatio);
    }
  }
  const meanLoad = monthF64(TILES);
  for (let k = 0; k < R; k++) meanLoad[roads[k]] = loadSum[roads[k]] / passes;
  // And across months: blend this month's Load/Cap with last month's.
  const xNew = districtRatio(net, meanLoad, maxRatio);
  const bprFinal = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) bprFinal[d] = bprOf((1 - tp.carry) * xNew[d] + tp.carry * ratioOfBpr(lagBpr[d], alpha), alpha, maxRatio);

  // Outputs: the 64×64 matrix, signpost times, trips, congestion.
  const rt = routes as Routes;
  const portD = rt.portD;
  const minutes = monthF64(DISTRICTS * DISTRICTS).fill(Infinity);
  const trips = monthF64(DISTRICTS * DISTRICTS);
  {
    const t0 = tripsH[0];
    const t1 = tripsH[1];
    const t2 = tripsH[2];
    for (let s = 0; s < P; s++) {
      const rowAB = portD[s] * DISTRICTS;
      for (let q = 0; q < P; q++) {
        const sq = s * P + q;
        const ab = rowAB + portD[q];
        minutes[ab] = C[sq];
        trips[ab] = (t0[sq] + t1[sq] + t2[sq]) * (1 - busS[sq] - railS[sq]);
      }
    }
  }
  const toSignpost = [monthF64(DISTRICTS).fill(Infinity), monthF64(DISTRICTS).fill(Infinity), monthF64(DISTRICTS).fill(Infinity)];
  for (let k = 0; k < 3; k++) {
    if (net.signNode[k] < 0 || rt.signCounts[k] <= 0) continue;
    const dk = k === 0 ? kDist : monthF64(V);
    if (k > 0) measure(net, w, rt.signParent[k], rt.signOrder[k], 0, rt.signCounts[k], dk);
    for (let s = 0; s < P; s++) toSignpost[k][portD[s]] = dk[rt.portN[s]];
  }
  let cn = 0;
  let cd = 0;
  for (let k = 0; k < R; k++) {
    const l = meanLoad[roads[k]];
    if (l <= 0) continue;
    const x = bprFinal[dOf[k]] - 1;
    cn += l * (x > 1 ? 1 : x);
    cd += l;
  }

  const port = monthI16(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) port[d] = net.port[d];
  const slot: TravelSlot = {
    port,
    minutes,
    load: meanLoad,
    bpr: bprFinal,
    avgCommute,
    congestion: cd > 0 ? cn / cd : 0,
    toSignpost,
    busShare: tripsAll > 0 ? busAll / tripsAll : 0,
    railShare: tripsAll > 0 ? railAll / tripsAll : 0,
    unreachable,
  };
  const out: Travel = { slot, trips };
  run.travel = out;
  return out;
}

/** The factors drivers last routed by (lag.routes ×1000), free flow where absent. */
function routeFactors(t: TownState): number[] {
  const r = t.lag.routes;
  const out = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) {
    const v = r ? r[d] : 1000;
    out[d] = typeof v === 'number' && Number.isFinite(v) && v >= 1000 ? v / 1000 : 1;
  }
  return out;
}

/**
 * Next month's route factors (×1000): a district keeps the factor drivers
 * routed by until its congestion has moved by more than `band` of it.
 */
export function nextRoutes(prev: number[] | undefined, bpr: readonly number[], band: number): number[] {
  const out = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) {
    const old = prev && typeof prev[d] === 'number' && prev[d] >= 1000 ? prev[d] : 1000;
    const now = Math.max(1000, Math.round((bpr[d] ?? 1) * 1000));
    const diff = now > old ? now - old : old - now;
    out[d] = diff > band * old ? now : old;
  }
  return out;
}

/** The stored lag (A26): next month's BPR factors ×1000 per district, as integers. */
export function congestionLag(bpr: readonly number[]): number[] {
  const out = new Array<number>(DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) out[d] = Math.max(1000, Math.round((bpr[d] ?? 1) * 1000));
  return out;
}

/** M4 Transport → derived.travel (+ t.lag.congestion). */
export function stepTransport(t: TownState, m: MonthContext): void {
  const tr = travelOf(runFor(t, m, m.derived));
  m.derived.travel = tr.slot;
  t.lag.congestion = congestionLag(tr.slot.bpr);
  t.lag.routes = nextRoutes(t.lag.routes, tr.slot.bpr, m.params.transport.routeBand);
}
