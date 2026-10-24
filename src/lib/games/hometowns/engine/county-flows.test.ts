// WP3 tomorrow's flows (spec §8.5, §5.10, §5.12): commuters fill at most a
// work town's vacancies and a link's trips; goods go cheapest landed price
// first, within link capacity, never more than a seller has or a buyer
// needs; the county price stays inside Kingsport's band; and every flow is
// the same, relabelled, for any order of the towns.

import { describe, expect, it } from 'vitest';
import { multiCounty, nextContext, openLink } from '../../../../../scripts/hometowns/region-kit';
import { allocateGoods, fixFlows, nextPrice, stepFixFlows, type FlowTown, type GoodsTown } from './county-flows';
import { pairLinks, regionOf, type PairLink } from './region-state';
import { regionParams } from './region-params';

const Q = regionParams('v1');

function ft(over: Partial<FlowTown> = {}): FlowTown {
  return { active: true, pop: 5000, unemployed: [200, 50, 10], vacancies: [100, 100, 20], shopAppeal: 40, salesTax: 200, retail: 900_000, attrQ: 30, pull: 50, healthNeed: 5000, uniNeed: 200, ...over };
}

function links(n: number, minutes: (i: number, j: number) => number, trips = 3000, goods = 2000): PairLink[] {
  const out: PairLink[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const m = i === j ? Infinity : minutes(i, j);
      out.push({ minutes: m, trips: Number.isFinite(m) ? trips : 0, goods: Number.isFinite(m) ? goods : 0, rail: false });
    }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('fixFlows', () => {
  it('fills at most each work town’s vacancies with commuters', () => {
    const T = [ft({ unemployed: [5000, 0, 0] }), ft({ unemployed: [5000, 0, 0] }), ft({ unemployed: [0, 0, 0], vacancies: [300, 0, 0] })];
    const r = fixFlows(T, links(3, () => 40), Q, 0.25, () => false);
    expect(r.towns[2].commutersIn[0]).toBeLessThanOrEqual(300 + 1e-9);
    // Two equal home towns share the work town equally.
    expect(Math.abs(r.towns[0].commutersOut[0] - r.towns[1].commutersOut[0])).toBeLessThan(1e-9);
  });

  it('keeps a link’s commuters and day trips within its trips a day', () => {
    const T = [ft({ unemployed: [20_000, 0, 0], pop: 60_000 }), ft({ vacancies: [20_000, 0, 0] })];
    const r = fixFlows(T, links(2, () => 30, 1000), Q, 0.25, () => false);
    let load = 0;
    for (let h = 0; h < 3; h++) load += r.commute[(0 * 2 + 1) * 3 + h] + r.commute[(1 * 2 + 0) * 3 + h];
    load += (r.dayTrips[1] + r.dayTrips[2]) * Q.dayTripLoad;
    expect(load).toBeLessThanOrEqual(1000 + 1e-6);
  });

  it('sends no flows between unlinked or inactive towns', () => {
    const r = fixFlows([ft(), ft({ active: false }), ft()], links(3, (i, j) => (i + j === 2 ? Infinity : 30)), Q, 0.25, () => false);
    expect(r.towns[1].commutersIn).toEqual([0, 0, 0]);
    expect(r.towns[1].shoppersIn).toBe(0);
    expect(r.dayTrips[0 * 3 + 2]).toBe(0);
  });

  it('caps the shopping leak at leakCap and draws shoppers toward the better high street', () => {
    const T = [ft({ shopAppeal: 1 }), ft({ shopAppeal: 400 }), ft({ shopAppeal: 100 })];
    const r = fixFlows(T, links(3, () => 25), Q, 0.25, () => false);
    for (const f of r.towns) expect(f.leak).toBeLessThanOrEqual(0.25);
    expect(r.towns[1].shoppersIn).toBeGreaterThan(r.towns[2].shoppersIn);
  });

  it('a dearer sales tax over the border draws fewer shoppers', () => {
    const cheap = fixFlows([ft(), ft({ salesTax: 200 })], links(2, () => 25), Q, 0.25, () => false).towns[1].shoppersIn;
    const dear = fixFlows([ft(), ft({ salesTax: 600 })], links(2, () => 25), Q, 0.25, () => false).towns[1].shoppersIn;
    expect(dear).toBeLessThan(cheap);
  });

  it('Twin Towns raise day trips both ways', () => {
    const plain = fixFlows([ft(), ft()], links(2, () => 25), Q, 0.25, () => false).dayTrips[1];
    const twin = fixFlows([ft(), ft()], links(2, () => 25), Q, 0.25, () => true).dayTrips[1];
    expect(twin).toBeGreaterThan(plain);
  });

  it('gives the same flows, relabelled, for any order of the towns', () => {
    const T = [ft({ pop: 3000, unemployed: [120, 30, 0], shopAppeal: 12 }), ft({ pop: 9000, vacancies: [400, 80, 10], shopAppeal: 80 }), ft({ pop: 5000, attrQ: 70, salesTax: 300 }), ft({ pop: 7000, unemployed: [10, 300, 40] })];
    const mins = (i: number, j: number) => [[0, 25, 50, 37], [25, 0, 25, 50], [50, 25, 0, 25], [37, 50, 25, 0]][i][j];
    const ref = fixFlows(T, links(4, mins), Q, 0.25, () => false);
    const perm = [2, 0, 3, 1];
    const T2: FlowTown[] = new Array(4);
    T.forEach((t, i) => (T2[perm[i]] = t));
    const inv = [1, 3, 0, 2];
    const r = fixFlows(T2, links(4, (i, j) => mins(inv[i], inv[j])), Q, 0.25, () => false);
    for (let i = 0; i < 4; i++) {
      const a = ref.towns[i];
      const b = r.towns[perm[i]];
      for (let h = 0; h < 3; h++) {
        expect(b.commutersIn[h]).toBeCloseTo(a.commutersIn[h], 9);
        expect(b.commutersOut[h]).toBeCloseTo(a.commutersOut[h], 9);
      }
      expect(b.shoppersIn).toBeCloseTo(a.shoppersIn, 6);
      expect(b.leak).toBeCloseTo(a.leak, 12);
      expect(b.dayTripsIn).toBeCloseTo(a.dayTripsIn, 9);
    }
  });
});

describe('allocateGoods', () => {
  const G = (s: number, active = true): GoodsTown => ({ active, surplus: s });

  it('buys from the nearest (cheapest landed) seller first', () => {
    // Buyer 0 needs 100; seller 1 is 25 minutes away, seller 2 is 50.
    const L = links(3, (i, j) => (i + j === 1 ? 25 : i + j === 2 ? 50 : 25));
    const a = allocateGoods([G(-100), G(150), G(150)], L, 1000, 2, 800, 'goods');
    expect(a).toEqual([expect.objectContaining({ seller: 1, buyer: 0, units: 100, price: 1000 - 2 * 25 })]);
  });

  it('never ships more than a seller has, a buyer needs, or a link carries', () => {
    const T = [G(-500), G(-300), G(400), G(250)];
    const L = links(4, () => 30, 3000, 120);
    const a = allocateGoods(T, L, 1000, 2, 800, 'goods');
    for (let i = 0; i < 4; i++) {
      const sold = sum(a.filter((x) => x.seller === i).map((x) => x.units));
      const bought = sum(a.filter((x) => x.buyer === i).map((x) => x.units));
      expect(sold).toBeLessThanOrEqual(Math.max(0, T[i].surplus));
      expect(bought).toBeLessThanOrEqual(Math.max(0, -T[i].surplus));
    }
    for (const x of a) {
      expect(x.units).toBeLessThanOrEqual(120);
      expect(Number.isInteger(x.units)).toBe(true);
    }
  });

  it('shares a seller pro rata between buyers at the same distance (no index wins)', () => {
    const a = allocateGoods([G(-100), G(-100), G(100)], links(3, () => 25), 1000, 2, 800, 'goods');
    const to0 = sum(a.filter((x) => x.buyer === 0).map((x) => x.units));
    const to1 = sum(a.filter((x) => x.buyer === 1).map((x) => x.units));
    expect(to0).toBe(to1);
  });

  it('does not ship where the seller would net less than Kingsport pays', () => {
    expect(allocateGoods([G(-100), G(100)], links(2, () => 150), 1000, 2, 800, 'goods')).toEqual([]);
  });
});

describe('nextPrice', () => {
  it('moves at most 5% a day and stays inside Kingsport’s band', () => {
    expect(nextPrice(1, 100, 1000, 0.8, 1.25, Q)).toBeCloseTo(1.05, 9);
    expect(nextPrice(1, 1000, 100, 0.8, 1.25, Q)).toBeCloseTo(0.95, 9);
    expect(nextPrice(1.24, 100, 1000, 0.8, 1.25, Q)).toBe(1.25);
    expect(nextPrice(0.81, 1000, 0, 0.8, 1.25, Q)).toBe(0.8);
    expect(nextPrice(1, 0, 0, 0.8, 1.25, Q)).toBe(1);
  });
});

describe('stepFixFlows (the county step)', () => {
  it('fixes flows only along open links, keeps the county price in its band and allocations within surpluses', () => {
    const { c } = multiCounty(3, 'town');
    openLink(c, 0, 1);
    for (const [i, s] of [[0, [-300, -50]], [1, [500, 80]], [2, [400, 0]]] as const) {
      const t = c.towns[i];
      t.marketMemo = { surplus: [...s], lowMonths: [0, 0, 0, 0, 0], sat: 60, visitors: 0, bedDemand: 0, attrQ: 20, pull: 10, shopAppeal: 30 };
    }
    const r = nextContext(c);
    stepFixFlows(c, r);
    // Town 2 has no link: no allocation, no commuters, no shoppers.
    expect(c.allocations.every((a) => a.seller !== 2 && a.buyer !== 2)).toBe(true);
    expect(c.flows.towns[2].commutersIn).toEqual([0, 0, 0]);
    expect(c.allocations.length).toBeGreaterThan(0);
    for (const a of c.allocations) expect(a.seller === 1 && a.buyer === 0).toBe(true);
    for (const m of [c.market.goods, c.market.food]) {
      expect(m.p).toBeGreaterThan(0.5);
      expect(m.p).toBeLessThan(1.5);
    }
    // Every active town shares one tourist pool.
    expect(new Set(c.flows.towns.map((f) => f.touristPool)).size).toBe(1);
    expect(regionOf(c).commute.length).toBe(6 * 6 * 3);
  });

  it('door-to-door minutes include both ends; a bus shortens a road link', () => {
    const { c } = multiCounty(2);
    openLink(c, 0, 1);
    const before = pairLinks(c)[1].minutes;
    openLink(c, 0, 1, 'bus');
    const after = pairLinks(c)[1].minutes;
    expect(before).toBe(25 + 2 * 5 + 2 * 5);
    expect(after).toBeLessThan(before);
  });
});
