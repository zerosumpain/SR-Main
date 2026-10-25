// The shared spatial model (space.ts): the road net (components, attachment,
// ports, the compressed graph), shortest paths against brute force, the
// table-driven decay, the §5.4 falloff and the month's occupancy.

import { describe, expect, it } from 'vitest';
import { kitTown, people, place, road, zone, zoneRect } from '../../../../../scripts/hometowns/space-kit';
import { expFx } from './fx';
import { STREAMS, h32 } from './rand';
import { arcWeights, buildModel, buildRoadNet, cellBox, cellDistance, decay, dijkstraInto, edgeWeights, falloff, roadNetOf, type RoadNet } from './space';
import { CELLS, CELLS_PER_SIDE, MAP, TILES, districtOf, planesOf, tileIndex } from './tiles';
import { paramsFor } from './params';

const P = paramsFor('v1');

/** A road key from a list of tiles (all streets), as buildRoadNet reads it. */
function keyOf(tiles: number[]): Uint8Array {
  const key = new Uint8Array(TILES);
  for (const i of tiles) key[i] = 2;
  return key;
}

/** Brute force: Dijkstra over road tiles with edge cost (w_i + w_j)/2, O(N²). */
function bruteDistances(net: RoadNet, tileW: Float64Array, src: number): Float64Array {
  const dist = new Float64Array(TILES).fill(Infinity);
  const done = new Uint8Array(TILES);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (const r of net.roads) if (!done[r] && dist[r] !== Infinity && (u < 0 || dist[r] < dist[u])) u = r;
    if (u < 0) break;
    done[u] = 1;
    const x = u % MAP;
    for (const v of [u >= MAP ? u - MAP : -1, x > 0 ? u - 1 : -1, x < MAP - 1 ? u + 1 : -1, u < TILES - MAP ? u + MAP : -1]) {
      if (v < 0 || net.kind[v] < 0 || done[v]) continue;
      const nd = dist[u] + (tileW[u] + tileW[v]) / 2;
      if (nd < dist[v]) dist[v] = nd;
    }
  }
  return dist;
}

/** A random small road map: segments inside a 28×28 box, seeded. */
function randomRoads(seed: number): number[] {
  const out = new Set<number>();
  const n = 6 + (h32(seed, STREAMS.forecast, 0, 0, 0) % 8);
  for (let k = 0; k < n; k++) {
    const r = (j: number) => h32(seed, STREAMS.forecast, k, j, 0);
    const x0 = 4 + (r(1) % 28);
    const y0 = 4 + (r(2) % 28);
    const len = 3 + (r(3) % 20);
    const horizontal = r(4) % 2 === 0;
    for (let s = 0; s < len; s++) {
      const x = horizontal ? Math.min(MAP - 1, x0 + s) : x0;
      const y = horizontal ? y0 : Math.min(MAP - 1, y0 + s);
      out.add(tileIndex(x, y));
    }
  }
  return [...out].sort((a, b) => a - b);
}

describe('the road net', () => {
  it('labels components, attaches lots to the nearest road within reach, and picks ports', () => {
    const tiles: number[] = [];
    for (let x = 2; x <= 12; x++) tiles.push(tileIndex(x, 4)); // a street along y = 4
    for (let y = 2; y <= 6; y++) tiles.push(tileIndex(7, y)); // crossing at (7, 4)
    tiles.push(tileIndex(30, 30)); // a lone tile, its own component
    const net = buildRoadNet(keyOf(tiles), 2);
    expect(net.comps).toBe(2);
    expect(net.comp[tileIndex(2, 4)]).toBe(net.comp[tileIndex(7, 6)]);
    expect(net.comp[tileIndex(30, 30)]).not.toBe(net.comp[tileIndex(2, 4)]);
    // Attachment: Chebyshev first, then Manhattan, then the lower tile.
    expect(net.attach[tileIndex(4, 6)]).toBe(tileIndex(4, 4)); // two below the street
    expect(net.attachDist[tileIndex(4, 6)]).toBe(2);
    expect(net.attach[tileIndex(4, 7)]).toBe(-1); // three away: no road access
    expect(net.attach[tileIndex(8, 5)]).toBe(tileIndex(8, 4)); // (7,5) and (8,4) tie on Chebyshev 1, Manhattan 1 → lower index
    // The district (0,0) port prefers the junction at (7,4) to plain stretches nearer its centre.
    expect(net.port[districtOf(tileIndex(7, 4))]).toBe(tileIndex(7, 4));
    expect(net.nodeOf[tileIndex(7, 4)]).toBeGreaterThanOrEqual(0);
  });

  it('compresses plain stretches and keeps every chain once', () => {
    const tiles: number[] = [];
    for (let x = 0; x < 20; x++) tiles.push(tileIndex(x, 10));
    const net = buildRoadNet(keyOf(tiles), 2);
    // Ends, ports (districts 8 and 9 here, x 0–7 and 8–15 and 16–19) are the nodes.
    const interior = net.edgeTiles.length;
    expect(net.nodeTile.length + interior).toBe(20);
    expect(net.edgeA.length).toBe(net.nodeTile.length - 1);
  });

  it('a ring road with no junction still gets a node', () => {
    const tiles: number[] = [];
    for (let x = 40; x <= 44; x++) tiles.push(tileIndex(x, 40), tileIndex(x, 44));
    for (let y = 41; y <= 43; y++) tiles.push(tileIndex(40, y), tileIndex(44, y));
    const net = buildRoadNet(keyOf(tiles), 2);
    expect(net.comps).toBe(1);
    expect(net.nodeTile.length).toBeGreaterThanOrEqual(1);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('shortest paths match brute force on random map %i', (seed) => {
    const net = buildRoadNet(keyOf(randomRoads(seed)), 2);
    const tileW = new Float64Array(TILES);
    for (const r of net.roads) tileW[r] = 0.5 + (h32(seed, STREAMS.forecast, r, 9, 0) % 1000) / 500; // 0.5–2.5 min
    const aw = arcWeights(net, edgeWeights(net, tileW));
    const V = net.nodeTile.length;
    const dist = new Float64Array(V);
    const parent = new Int32Array(V);
    const order = new Int32Array(V);
    for (let d = 0; d < 64; d++) {
      const src = net.portNode[d];
      if (src < 0) continue;
      const count = dijkstraInto(net, aw, src, dist, parent, order, 0);
      const brute = bruteDistances(net, tileW, net.port[d]);
      for (let n = 0; n < V; n++) {
        const b = brute[net.nodeTile[n]];
        if (b === Infinity) expect(dist[n]).toBe(Infinity);
        else expect(Math.abs(dist[n] - b)).toBeLessThan(1e-9 * (1 + b));
      }
      // The settle order is parent-first (what the loading and re-measuring rely on).
      const seen = new Uint8Array(V);
      seen[order[0]] = 1;
      for (let k = 1; k < count; k++) {
        const n = order[k];
        const e = parent[n];
        const o = net.edgeA[e] === n ? net.edgeB[e] : net.edgeA[e];
        expect(seen[o]).toBe(1);
        seen[n] = 1;
      }
    }
  });

  it('stops early once every wanted node is settled', () => {
    const net = buildRoadNet(keyOf(randomRoads(3)), 2);
    const tileW = new Float64Array(TILES).fill(1);
    const aw = arcWeights(net, edgeWeights(net, tileW));
    const V = net.nodeTile.length;
    const full = new Float64Array(V);
    const part = new Float64Array(V);
    const par = new Int32Array(V);
    const ord = new Int32Array(V);
    const src = net.portNode.find((n) => n >= 0)!;
    const all = dijkstraInto(net, aw, src, full, par, ord, 0);
    const want = new Uint8Array(V);
    const target = ord[Math.floor(all / 2)];
    want[target] = 1;
    const some = dijkstraInto(net, aw, src, part, par, ord, 0, want, 1);
    expect(some).toBeLessThanOrEqual(all);
    expect(part[target]).toBe(full[target]);
  });

  it('is memoised on the exact road layout and rebuilt when a road changes', () => {
    const k = kitTown();
    road(k.t, 10, 10, 20, 10);
    const a = roadNetOf(k.t, 2);
    zone(k.t, 12, 11, 'homes', 1);
    expect(roadNetOf(k.t, 2)).toBe(a); // a zoning change keeps the net
    road(k.t, 15, 11, 15, 14);
    const b = roadNetOf(k.t, 2);
    expect(b).not.toBe(a);
    // A revived copy builds an equal net from scratch.
    const copy = JSON.parse(JSON.stringify(k.t));
    const c = roadNetOf(copy, 2);
    expect(Array.from(c.port)).toEqual(Array.from(b.port));
    expect(Array.from(c.attach)).toEqual(Array.from(b.attach));
  });
});

describe('maths helpers', () => {
  it('decay(x) is within 2e-6 of e^(−x)', () => {
    let worst = 0;
    for (let k = 0; k <= 40000; k++) {
      const x = k / 1000;
      worst = Math.max(worst, Math.abs(decay(x) - expFx(-x)));
    }
    expect(worst).toBeLessThan(2e-6);
    expect(decay(0)).toBe(1);
    expect(decay(-3)).toBe(1);
    expect(decay(Infinity)).toBe(0);
    expect(decay(Number.NaN)).toBe(0);
  });

  it('falloff is full to half the radius, then linear to zero at the radius (§5.4)', () => {
    // A radius of 8 tiles is 4 cells: full to 2 cells, half at 3, none from 4.
    expect(falloff(0, 8)).toBe(1);
    expect(falloff(2, 8)).toBe(1);
    expect(falloff(3, 8)).toBeCloseTo(0.5, 12);
    expect(falloff(4, 8)).toBe(0);
    expect(falloff(10, 8)).toBe(0);
    expect(falloff(31, Infinity)).toBe(1);
  });

  it('cellBox contains every cell within the radius and cellDistance is in cells', () => {
    const px = 21;
    const py = 9.5;
    const r = 7;
    const [x0, x1, y0, y1] = cellBox(px, py, r);
    for (let c = 0; c < CELLS; c++) {
      const cx = c % CELLS_PER_SIDE;
      const cy = (c - cx) / CELLS_PER_SIDE;
      if (cellDistance(c, px, py) <= r / 2) {
        expect(cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1).toBe(true);
      }
    }
    expect(cellDistance(0, 1, 1)).toBe(0); // cell 0's centre is tile (1, 1)
    expect(cellDistance(1, 1, 1)).toBe(1); // one cell east
  });
});

describe('the month occupancy model', () => {
  it('spreads each tier over its own homes by capacity, and conserves residents', () => {
    const k = kitTown();
    road(k.t, 10, 10, 30, 10);
    zoneRect(k.t, 10, 11, 4, 1, 'homes', 1, 0); // four £ L1 cottages: 32 persons
    zoneRect(k.t, 20, 11, 2, 1, 'homes', 2, 1); // two ££ L2 houses: 40 persons
    zone(k.t, 25, 11, 'shops', 2); // eight jobs
    people(k.t, 0, 10, 6, 6, 2); // 24 £
    people(k.t, 1, 10, 10, 10, 0); // 30 ££
    const m = buildModel(k.t, P);
    expect(m.homesCap).toEqual([32, 40, 0]);
    expect(m.res[tileIndex(10, 11)]).toBeCloseTo(24 / 4, 12);
    expect(m.res[tileIndex(20, 11)]).toBeCloseTo(30 / 2, 12);
    let total = 0;
    for (let i = 0; i < TILES; i++) total += m.res[i];
    expect(total).toBeCloseTo(54, 9);
    expect(m.jobs[tileIndex(25, 11)]).toBe(8);
    // Workforce: 0.85·W + 0.72·P per tier.
    expect(m.workforce[0]).toBeCloseTo(0.85 * 10 + 0.72 * 6, 12);
    let w0 = 0;
    for (let d = 0; d < 64; d++) w0 += m.distWorkers[0][d];
    expect(w0).toBeCloseTo(m.workforce[0], 9);
  });

  it('skips tiles under construction and closed by an incident; a tier without homes spills over all homes', () => {
    const k = kitTown();
    road(k.t, 10, 10, 30, 10);
    zoneRect(k.t, 10, 11, 2, 1, 'homes', 1, 0);
    k.t.construction = [tileIndex(11, 11), 2];
    people(k.t, 2, 4); // four £££ Workers with no £££ homes
    const m = buildModel(k.t, P);
    expect(m.homesCap[0]).toBe(8);
    expect(m.level[tileIndex(11, 11)]).toBe(0);
    expect(m.res[tileIndex(10, 11)]).toBeCloseTo(4, 12);
    expect(planesOf(k.t).use[tileIndex(11, 11)]).not.toBe(0);
  });

  it('puts civic staff in the district of the building’s road', () => {
    const k = kitTown();
    road(k.t, 10, 10, 30, 10);
    place(k.t, 'constablePost', 12, 11);
    const m = buildModel(k.t, P);
    const d = districtOf(tileIndex(12, 10));
    expect(m.distJobs[d]).toBe(6);
    // Village-tier building: the public-service mix 30/50/20 (A2 only exempts Hamlet-tier buildings).
    expect(m.distJobsT[0][d]).toBeCloseTo(1.8, 12);
    expect(m.distJobsT[1][d]).toBeCloseTo(3, 12);
  });
});

describe('the space steps are a pure function of stored state', () => {
  it('revive-then-continue equals never-stored, and a second run gives the same months', async () => {
    const { fixture } = await import('../../../../../scripts/hometowns/fixture');
    const { stepUtilities } = await import('./utilities');
    const { stepFields } = await import('./fields');
    const { stepTransport } = await import('./transport');
    const { makeContext } = await import('./tick');
    const { newDerivedCache } = await import('./derived');
    const { MonthWhy } = await import('./why');
    const f = fixture('town');
    const months = (t: (typeof f.county.towns)[number], n: number, county = f.county) => {
      const out: string[] = [];
      for (let k = 0; k < n; k++) {
        const ctx = makeContext(county, f.town, t.tick);
        const m = { ...ctx, month: ctx.world.month, derived: newDerivedCache(), why: new MonthWhy() };
        stepUtilities(t, m);
        stepFields(t, m);
        stepTransport(t, m);
        out.push(JSON.stringify([t.lv, t.lag, t.ps, m.derived.fields!.safety, Array.from(m.derived.travel!.minutes.slice(0, 200))]));
        t.tick += 4;
      }
      return out;
    };
    const a = f.county.towns[f.town];
    const first = months(a, 3);
    const revived = JSON.parse(JSON.stringify(a));
    const restA = months(a, 4);
    const copy = JSON.parse(JSON.stringify(f.county));
    copy.towns[f.town] = revived;
    const restB = months(revived, 4, copy);
    expect(restB).toEqual(restA);
    const g = fixture('town');
    expect(months(g.county.towns[g.town], 3, g.county)).toEqual(first);
  });
});
