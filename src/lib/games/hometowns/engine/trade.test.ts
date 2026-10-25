// WP2c's M7b and the town side of the goods market (spec §5.12, A7, A8):
// the sale order with hand-worked fixtures, Kingsport's price band and the
// freight premium, the seller's shortfall charge (A17), household, commuter,
// shopper and visitor spending, and what a town records for the Regional Day.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { marketSupply, scriptedLabour } from '../../../../../scripts/hometowns/market-kit';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { buildingIndex } from './content';
import { neutralFlows } from './core';
import { neutral } from './derived';
import { paramsFor } from './params';
import { newBuilding } from './tiles';
import { FOOD, GOOD, S_FARMS, freightScore, pricesOf, sectorTiles, settle, shortfallCharge, stepSpending, tradeScratch } from './trade';
import type { Allocation, CountyState, TownState } from './types';

const P = paramsFor('v1');

function town(kind: 'hamlet' | 'town' = 'town') {
  const f = fixture(kind);
  return { c: f.county, i: f.town, t: f.county.towns[f.town] };
}

/** A month context with the given flows for this town, the World at 1.0 and no event. */
function ctxFor(c: CountyState, i: number, t: TownState, over: Parameters<typeof monthContext>[2] = {}, flows: Partial<ReturnType<typeof neutralFlows>> = {}) {
  c.snapshot.flows = c.towns.map(() => neutralFlows());
  c.snapshot.flows[i] = { ...neutralFlows(), ...flows };
  const dev = marketSupply(t);
  const m = monthContext(c, i, { development: dev, labour: scriptedLabour(t, dev), tourism: neutral.tourism(), ...over });
  m.world = { ...m.world, goods: 1, office: 1, tourism: 1, event: null };
  return m;
}

describe('the sale order (A8)', () => {
  it('serves local use first at the county price, then allocations, then the stock, then Kingsport', () => {
    const s = settle(100, 60, 0, 10, 1000, 900, 1250, [{ index: 0, units: 20, price: 980 }]);
    expect(s.local).toBe(60);
    expect(s.shipped).toEqual([20]);
    expect(s.toStock).toBe(10);
    expect(s.exported).toBe(10);
    expect(s.imported).toBe(0);
    // 60 × £1,000 + 20 × £980 + 10 × £1,000 (sold into the town's stock) + 10 × £900.
    expect(s.revenue).toBe(98_600);
    expect(s.inputCost).toBe(60_000);
    expect(s.stockAfter).toBe(10);
  });

  it('a buyer short of local supply takes its allocations, then its stock, then imports at the dear end', () => {
    const s = settle(10, 50, 5, 0, 1000, 900, 1250, [], [{ index: 1, units: 20, price: 1050 }]);
    expect(s.local).toBe(10);
    expect(s.received).toEqual([20]);
    expect(s.fromStock).toBe(5);
    expect(s.imported).toBe(15);
    // 10 × £1,000 + 20 × £1,050 + 5 × £1,000 + 15 × £1,250.
    expect(s.inputCost).toBe(54_750);
    expect(s.revenue).toBe(10_000);
    expect(s.stockAfter).toBe(0);
  });

  it('stocks allocations received beyond need, and a short seller ships only what it has', () => {
    const buyer = settle(0, 40, 0, 0, 1000, 900, 1250, [], [{ index: 0, units: 60, price: 1000 }]);
    expect(buyer.imported).toBe(0);
    expect(buyer.stockAfter).toBe(20);
    const seller = settle(30, 20, 0, 0, 1000, 900, 1250, [{ index: 0, units: 25, price: 1000 }]);
    expect(seller.shipped).toEqual([10]);
    expect(seller.exported).toBe(0);
  });

  it('the seller of a short allocation pays the import price gap, capped at 10% of its value (A17)', () => {
    const a: Allocation = { good: 'goods', seller: 0, buyer: 1, units: 100, price: 1100 };
    expect(shortfallCharge(a, 100, 1250)).toBe(0);
    expect(shortfallCharge(a, 90, 1250)).toBe(1500); // 10 short × £150
    expect(shortfallCharge(a, 0, 1250)).toBe(11_000); // 100 × £150 = £15,000, capped at 10% of £110,000
  });
});

describe('prices (§5.12, A7)', () => {
  it("keeps the county price inside Kingsport's band, and good freight earns a better export price", () => {
    const { c, i, t } = town();
    const m = ctxFor(c, i, t);
    const pr = pricesOf(t, m);
    const fs = freightScore(t, m);
    expect(pr.exportP[GOOD]).toBeCloseTo(1000 * (0.8 + 0.12 * fs), 9);
    expect(pr.importP[GOOD]).toBeCloseTo(1250, 9);
    expect(pr.exportP[FOOD]).toBeCloseTo(48, 9);
    expect(pr.importP[FOOD]).toBeCloseTo(75, 9);
    expect(pr.county).toEqual([1000, 60]);
    // A harbour adds 0.35 to FreightScore, so 4.2% more for every exported unit.
    t.buildings.push(newBuilding(buildingIndex('harbour'), 0, 0, 0, 0, 1));
    expect(pricesOf(t, m).exportP[GOOD]).toBeCloseTo(1000 * (0.8 + 0.12 * Math.min(1.6, fs + 0.35)), 9);
    // A county price drifting outside the band is held at its edge.
    m.snapshot.prices = { goods: 2, food: 0.1 };
    const out = pricesOf(t, m);
    expect(out.county[GOOD]).toBeCloseTo(out.importP[GOOD], 9);
    expect(out.county[FOOD]).toBeCloseTo(out.exportP[FOOD], 9);
  });

  it('Bumper Harvest makes all food 20% cheaper', () => {
    const { c, i, t } = town();
    const m = ctxFor(c, i, t);
    m.world = { ...m.world, event: { id: 'bumperHarvest', fromMonth: 0, toMonth: 1e9 } };
    const pr = pricesOf(t, m);
    expect(pr.exportP[FOOD]).toBeCloseTo(48 * 0.8, 9);
    expect(pr.county[FOOD]).toBeCloseTo(48, 9);
  });
});

describe('M7b spending', () => {
  /** A labour slot with fixed incomes by tier and 10 £ in-commuters. */
  function labour(t: TownState) {
    const l = scriptedLabour(t, marketSupply(t));
    l.income = [100_000, 50_000, 20_000];
    l.commutersIn = [10, 0, 0];
    l.wage = [1600, 2600, 4500];
    return l;
  }

  it('households spend α_h on retail and β_h on leisure; leaks, shoppers, commuters and visitors land where §5.12 says', () => {
    const { c, i, t } = town();
    const tour = { ...neutral.tourism(), stays: 100, dayTrips: 50, hotelNights: 250, beds: 100 };
    const m = ctxFor(c, i, t, { labour: labour(t), tourism: tour }, { leak: 0.1, shoppersIn: 5000 });
    stepSpending(t, m);
    const s = m.derived.spend!;
    expect(s.retail).toBeCloseTo(0.3 * 100_000 + 0.25 * 50_000 + 0.2 * 20_000, 6); // 46,500
    expect(s.leisure).toBeCloseTo(0.06 * 100_000 + 0.09 * 50_000 + 0.12 * 20_000, 6); // 12,900
    expect(s.shoppersOut).toBeCloseTo(4650, 6);
    expect(s.shoppersIn).toBe(5000);
    expect(s.inCommuterRetail).toBeCloseTo(0.15 * 0.3 * 10 * 1600, 6); // 720
    // A stay night's £60 is split evenly; a day trip's £35 goes 60/40.
    expect(s.visitorShops).toBeCloseTo(100 * 2.5 * 60 * 0.5 + 50 * 35 * 0.6, 6); // 8,550
    expect(s.visitorLeisure).toBeCloseTo(100 * 2.5 * 60 * 0.5 + 50 * 35 * 0.4, 6); // 8,200
    // The sales-tax base: shops' and leisure's takings; hotel rooms pay hotel tax instead.
    expect(s.turnover).toBeCloseTo(46_500 - 4650 + 5000 + 720 + 8550 + 12_900 + 8200, 6);
    const sc = tradeScratch(m)!;
    expect(sc.hotelSales).toBeCloseTo(250 * 95, 6);
    // Local use: shops' stock at 50% of sales (40% food at £60, 60% goods at £1,000), leisure's 30% goods, and construction.
    const shop = 46_500 - 4650 + 5000 + 720 + 8550;
    const goods = (shop * 0.5 * 0.6 + (12_900 + 8200 + 250 * 95) * 0.3) / 1000 + 2 * sectorTiles(t, m).startsPerMonth;
    expect(m.derived.goods!.localUse[FOOD]).toBeCloseTo((shop * 0.5 * 0.4) / 60, 6);
    expect(m.derived.goods!.localUse[GOOD]).toBeCloseTo(goods, 6);
    expect(t.realised.shopperSpendOut).toBeCloseTo(4650, 6);
    expect(t.realised.shopperSpendIn).toBe(5000);
  });

  it('a town with no shops takes no retail: its people shop elsewhere and nothing is taxed here', () => {
    const { c, i, t } = town();
    const dev = marketSupply(t);
    for (let h = 0; h < 3; h++) dev.jobs[2 * 3 + h] = 0;
    const m = ctxFor(c, i, t, { development: dev, labour: labour(t) }, { shoppersIn: 5000 });
    stepSpending(t, m);
    const s = m.derived.spend!;
    expect(s.retail).toBeGreaterThan(0);
    expect(s.shoppersIn).toBe(0);
    expect(s.turnover).toBeCloseTo(s.leisure, 6);
    expect(m.derived.goods!.localUse[FOOD]).toBe(0);
  });

  it('Bargain Week lifts shop spending 10% and the Night Market leisure 8%', () => {
    const { c, i, t } = town();
    const m = ctxFor(c, i, t, { labour: labour(t) });
    m.world = { ...m.world, event: { id: 'bargainWeek', fromMonth: 0, toMonth: 1e9 } };
    t.policies.push({ card: 'nightMarket', sinceTick: 0, area: null });
    stepSpending(t, m);
    expect(m.derived.spend!.retail).toBeCloseTo(46_500 * 1.1, 6);
    expect(m.derived.spend!.leisure).toBeCloseTo(12_900 * 1.08, 6);
  });

  it("records the day's shipments and receipts for the Regional Day, and keeps a stock", () => {
    const { c, i, t } = town('hamlet');
    c.snapshot.allocations = [
      { good: 'food', seller: i, buyer: i + 1, units: 50, price: 58 },
      { good: 'goods', seller: i + 1, buyer: i, units: 7, price: 1050 },
    ];
    const m = ctxFor(c, i, t);
    t.realised.shipped = [];
    t.realised.received = [];
    stepSpending(t, m);
    const g = m.derived.goods!;
    expect(g.production[FOOD]).toBeGreaterThan(g.localUse[FOOD] + 50);
    expect(t.realised.shipped).toEqual([50, 0]);
    expect(t.realised.received).toEqual([0, 7]);
    expect(g.allocatedOut[FOOD]).toBe(50);
    expect(g.allocatedIn[GOOD]).toBe(7);
    // The town keeps half a month of local food use, and exports the rest.
    expect(t.goodsStock[FOOD]).toBeCloseTo(P.firms.stockMonths * g.localUse[FOOD], 6);
    expect(g.exported[FOOD]).toBeCloseTo(g.production[FOOD] - g.localUse[FOOD] - 50 - t.goodsStock[FOOD], 6);
    expect(t.marketMemo!.surplus[FOOD]).toBeCloseTo((g.production[FOOD] - g.localUse[FOOD]) / P.firms.surplusTau, 6);
  });

  it("farms sell locally first at the county price, so they earn more than Kingsport's £48 a unit (A8)", () => {
    const { c, i, t } = town('hamlet');
    const m = ctxFor(c, i, t);
    stepSpending(t, m);
    const g = m.derived.goods!;
    const sale = tradeScratch(m)!.sale[FOOD];
    expect(g.production[FOOD]).toBeGreaterThan(0);
    expect(sale.local).toBeCloseTo(g.localUse[FOOD], 6);
    expect(sale.revenue / g.production[FOOD]).toBeGreaterThan(48);
    expect(sale.revenue / g.production[FOOD]).toBeLessThan(60);
    // A farm tile's 3 jobs make 100 food units (×1.3 on Flatland).
    const staff = m.derived.labour!.sectorEffective![S_FARMS];
    expect(g.production[FOOD]).toBeCloseTo((staff / 3) * 100 * (t.siteKind === 'flatland' ? 1.3 : 1), 6);
  });
});
