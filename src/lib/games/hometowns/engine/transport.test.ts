// M4 Transport (§5.9): port-to-port times over the road tiles, BPR,
// production-constrained gravity, the 60-minute reach, all-or-nothing loads,
// the stored congestion lag, and the route memo's purity.

import { describe, expect, it } from 'vitest';
import { kitTown, monthOf, people, place, road, zoneRect, type Kit } from '../../../../../scripts/hometowns/space-kit';
import { paramsFor } from './params';
import { roadNetOf, runFor } from './space';
import { DISTRICTS, districtOf, tileIndex } from './tiles';
import { bprOf, congestionLag, forgetRoutes, ratioOfBpr, routesFor, stepTransport, travelOf, type Travel } from './transport';

const P = paramsFor('v1');

function travel(k: Kit): Travel {
  const m = monthOf(k);
  return travelOf(runFor(k.t, m, m.derived));
}

/** An avenue along y = 4 across the whole map: one port per district of the top row. */
function corridor(kind: 'avenue' | 'lane' = 'avenue'): Kit {
  const k = kitTown();
  road(k.t, 0, 4, 63, 4, kind);
  return k;
}

describe('BPR (§5.9)', () => {
  it('is 1 + 0.15·(Load/Cap)^4 with the ratio capped, and inverts', () => {
    const [a, cap] = P.transport.bpr;
    expect(bprOf(0, a, cap)).toBe(1);
    expect(bprOf(1, a, cap)).toBeCloseTo(1.15, 15);
    expect(bprOf(2, a, cap)).toBeCloseTo(1 + 0.15 * 16, 12);
    expect(bprOf(10, a, cap)).toBe(bprOf(cap, a, cap));
    expect(ratioOfBpr(bprOf(1.7, a, cap), a)).toBeCloseTo(1.7, 12);
    expect(ratioOfBpr(1, a)).toBe(0);
  });

  it('stores next month’s factors ×1000 as whole numbers ≥ 1000', () => {
    expect(congestionLag(new Array(64).fill(1.23456))[5]).toBe(1235);
    expect(congestionLag(new Array(64).fill(0.9))[0]).toBe(1000);
  });
});

describe('travel times', () => {
  it('are the road minutes between ports plus the terminal time, symmetric, intra-district fixed', () => {
    const k = corridor();
    const tr = travel(k).slot;
    const net = roadNetOf(k.t, 2);
    const a = districtOf(tileIndex(0, 4));
    const b = districtOf(tileIndex(63, 4));
    const tiles = Math.abs((net.port[b] % 64) - (net.port[a] % 64));
    expect(tr.minutes[a * DISTRICTS + b]).toBeCloseTo(tiles * 0.5 + P.transport.terminalMinutes, 12);
    expect(tr.minutes[b * DISTRICTS + a]).toBe(tr.minutes[a * DISTRICTS + b]);
    expect(tr.minutes[a * DISTRICTS + a]).toBe(P.transport.intraMinutes);
    expect(tr.minutes[a * DISTRICTS + districtOf(tileIndex(0, 40))]).toBe(Infinity); // no road there
  });

  it('slow down with last month’s congestion and with potholes', () => {
    const k = corridor();
    const a = districtOf(tileIndex(0, 4));
    const b = districtOf(tileIndex(63, 4));
    const free = travel(k).slot.minutes[a * DISTRICTS + b] - P.transport.terminalMinutes;
    k.t.lag.congestion = new Array(64).fill(1500);
    const busy = travel(k).slot.minutes[a * DISTRICTS + b] - P.transport.terminalMinutes;
    expect(busy).toBeCloseTo(free * 1.5, 9);
    k.t.lag.congestion = new Array(64).fill(1000);
    k.t.funding[7] = 0; // roads funded Low
    expect(travel(k).slot.minutes[a * DISTRICTS + b] - P.transport.terminalMinutes).toBeCloseTo(free * P.transport.potholes, 9);
  });
});

describe('commuting', () => {
  /** Homes in district 0, jobs in districts 3 and 6 of the corridor. */
  function commuters(kind: 'avenue' | 'lane' = 'avenue'): Kit {
    const k = corridor(kind);
    zoneRect(k.t, 1, 5, 4, 1, 'homes', 4, 0); // 480 capacity
    people(k.t, 0, 400); // 340 £ workers
    zoneRect(k.t, 26, 5, 2, 1, 'industry', 1); // 12 £ jobs in district 3
    zoneRect(k.t, 50, 5, 4, 1, 'industry', 1); // 24 £ jobs in district 6
    return k;
  }

  it('sends every worker somewhere: Σ_b Trips(a→b) = Workers(a), in gravity proportions', () => {
    const k = commuters();
    const t = travel(k);
    const home = districtOf(tileIndex(1, 4));
    const d3 = districtOf(tileIndex(26, 4));
    const d6 = districtOf(tileIndex(50, 4));
    const out = t.trips[home * DISTRICTS + d3] + t.trips[home * DISTRICTS + d6];
    expect(out).toBeCloseTo(0.85 * 400, 9);
    const c3 = t.slot.minutes[home * DISTRICTS + d3];
    const c6 = t.slot.minutes[home * DISTRICTS + d6];
    const g3 = 12 * Math.exp(-c3 / 18);
    const g6 = 24 * Math.exp(-c6 / 18);
    expect(t.trips[home * DISTRICTS + d3] / out).toBeCloseTo(g3 / (g3 + g6), 5);
    expect(t.slot.unreachable).toEqual([0, 0, 0]);
    expect(t.slot.avgCommute[0]).toBeCloseTo((g3 * c3 + g6 * c6) / (g3 + g6), 4);
  });

  it('counts workers with no job district within 60 minutes as unreachable', () => {
    const k = corridor('lane'); // 1.2 min a tile: the far end is over 60 minutes away
    zoneRect(k.t, 1, 5, 4, 1, 'homes', 4, 0);
    people(k.t, 0, 400);
    zoneRect(k.t, 60, 5, 2, 1, 'industry', 1);
    const t = travel(k);
    expect(t.slot.unreachable![0]).toBeCloseTo(0.85 * 400, 9);
    expect(t.slot.avgCommute[0]).toBe(0);
  });

  it('loads car trips onto every road tile they use, all or nothing', () => {
    const k = commuters();
    const t = travel(k);
    const home = districtOf(tileIndex(1, 4));
    const d6 = districtOf(tileIndex(50, 4));
    const toFar = t.trips[home * DISTRICTS + d6];
    // Between district 3's port and district 6's port only the trips to district 6 pass.
    expect(t.slot.load[tileIndex(40, 4)]).toBeCloseTo(toFar, 9);
    expect(t.slot.load[tileIndex(62, 4)]).toBe(0);
  });

  it('blends this month’s Load/Cap with last month’s into the stored congestion (A26)', () => {
    const k = commuters();
    for (let x = 0; x < 64; x++) road(k.t, x, 4, x, 4, 'lane'); // capacity 300: busy
    zoneRect(k.t, 1, 6, 4, 1, 'homes', 5, 0);
    people(k.t, 0, 1400);
    zoneRect(k.t, 50, 6, 8, 1, 'industry', 5);
    const m = monthOf(k);
    stepTransport(k.t, m);
    const tr = m.derived.travel!;
    const d = districtOf(tileIndex(40, 4));
    const x = Math.min(P.transport.bpr[1], tr.load[tileIndex(40, 4)] / 300);
    const expected = bprOf((1 - P.transport.carry) * x, P.transport.bpr[0], P.transport.bpr[1]);
    expect(tr.bpr[d]).toBeCloseTo(expected, 9);
    expect(k.t.lag.congestion[d]).toBe(Math.round(expected * 1000));
    expect(tr.congestion).toBeGreaterThan(0);
  });

  it('gives bus riders their share on covered pairs', () => {
    const k = commuters();
    place(k.t, 'windmill', 0, 3);
    place(k.t, 'busDepot', 10, 3);
    place(k.t, 'busStop', 3, 3);
    place(k.t, 'busStop', 51, 3);
    const t = travel(k);
    expect(t.slot.busShare).toBeGreaterThan(0);
    expect(t.slot.busShare).toBeLessThanOrEqual(P.transport.bus[0]);
  });
});

describe('routes are a pure function of stored state', () => {
  it('a cold memo, a warm memo and a revived copy give identical travel', () => {
    const k = kitTown();
    for (let y = 2; y < 64; y += 6) road(k.t, 0, y, 63, y, y % 12 === 2 ? 'avenue' : 'street');
    for (let x = 3; x < 64; x += 7) road(k.t, x, 0, x, 63, 'street');
    zoneRect(k.t, 4, 3, 20, 2, 'homes', 4, 0);
    zoneRect(k.t, 30, 27, 10, 2, 'offices', 3);
    zoneRect(k.t, 50, 51, 10, 2, 'industry', 3);
    people(k.t, 0, 2000, 1000, 800, 200);
    people(k.t, 1, 1000, 500, 300, 100);
    k.t.lag.congestion = Array.from({ length: 64 }, (_, d) => 1000 + ((d * 37) % 400));
    const warm1 = travel(k).slot;
    const warm2 = travel(k).slot;
    forgetRoutes(k.t);
    const cold = travel(k).slot;
    const revived = travel({ ...k, t: JSON.parse(JSON.stringify(k.t)) }).slot;
    for (const s of [warm2, cold, revived]) {
      expect(Array.from(s.minutes)).toEqual(Array.from(warm1.minutes));
      expect(Array.from(s.load)).toEqual(Array.from(warm1.load));
      expect(s.bpr).toEqual(warm1.bpr);
      expect(s.avgCommute).toEqual(warm1.avgCommute);
    }
  });

  it('keeps routes while the rounded congestion is unchanged, but times follow the exact factors', () => {
    const k = corridor();
    zoneRect(k.t, 1, 5, 4, 1, 'homes', 2, 0);
    people(k.t, 0, 50);
    const a = travel(k).slot.minutes[1 * DISTRICTS + 6];
    const net = roadNetOf(k.t, 2);
    const key = new Float64Array(net.adjEdge.length).fill(1);
    const r1 = routesFor(k.t, net, key);
    expect(routesFor(k.t, net, Float64Array.from(key))).toBe(r1);
    k.t.lag.congestion = new Array(64).fill(1040); // rounds to 1.0 at the 0.25 route step
    const b = travel(k).slot.minutes[1 * DISTRICTS + 6];
    expect(b).toBeGreaterThan(a);
  });
});
