// WP2c tourism (spec §5.10): the real UK calendar, the pool and the shares,
// beds, satisfaction, reputation and awareness, the events that touch
// visitors, what a town records for the Regional Day, the visitors' Why, and
// §13.2's scripted over-build: reputation falls within two days and stays
// down until a new attraction.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { marketSteps, marketSupply, placeFree, scriptedLabour, seasideTown } from '../../../../../scripts/hometowns/market-kit';
import { monthContext, runMonths } from '../../../../../scripts/hometowns/people-kit';
import { neutralFlows } from './core';
import { neutral } from './derived';
import { paramsFor } from './params';
import { attractionsOf, hotelPrice, realSeason, satisfaction, stepTourism, touristPoolBase, touristPull, touristShares } from './tourism';
import type { CountyState, DerivedCache, MonthContext, TownState } from './types';

const P = paramsFor('v1');

function ctx(c: CountyState, i: number, t: TownState, beds: number, flows: Partial<ReturnType<typeof neutralFlows>> = {}, over: Partial<DerivedCache> = {}): MonthContext {
  c.snapshot.flows = c.towns.map(() => neutralFlows());
  c.snapshot.flows[i] = { ...neutralFlows(), ...flows };
  const dev = marketSupply(t);
  dev.beds = beds;
  const coverage = { ...neutral.coverage(t), town: [0, 0, 0, 0, 40, 0, 0, 0] };
  const m = monthContext(c, i, { development: dev, labour: scriptedLabour(t, dev), fields: { ...neutral.fields(t), safety: 70 }, coverage, ...over });
  m.world = { ...m.world, goods: 1, office: 1, tourism: 1, event: null };
  return m;
}

function town(kind: 'hamlet' | 'town' = 'hamlet') {
  const f = fixture(kind);
  return { c: f.county, i: f.town, t: f.county.towns[f.town] };
}

describe('the real UK calendar (§5.10)', () => {
  it('follows the table, and coast sites swing 1.5× as far from 1.0', () => {
    expect(realSeason(0, false, P)).toBe(0.75);
    expect(realSeason(7, false, P)).toBe(1.35);
    expect(realSeason(11, false, P)).toBe(1.1); // Christmas markets
    expect(realSeason(7, true, P)).toBeCloseTo(1.525, 12);
    expect(realSeason(0, true, P)).toBeCloseTo(0.625, 12);
    expect(realSeason(3, true, P)).toBe(1);
  });

  it("drives a town's visitors by the calendar month of the tick, not the game month", () => {
    const stays = (month: number) => {
      const { c, i, t } = town();
      const m = { ...ctx(c, i, t, 1e6), calendarMonth: month };
      stepTourism(t, m);
      return m.derived.tourism!.stays;
    };
    // An uncrowded inland hamlet: visitors scale exactly with the season.
    expect(stays(7) / stays(0)).toBeCloseTo(1.35 / 0.75, 9);
    expect(stays(3) / stays(10)).toBeCloseTo(1 / 0.8, 9);
  });

  it('a whole run picks the season up from the clock: the same town hosts more in August than in November', () => {
    const run = (daysBack: number) => {
      const { c, i, t } = town('town');
      c.epoch -= daysBack * 86_400_000;
      const [d] = runMonths(c, i, 1, marketSteps({ labour: {}, fields: { safety: 70 }, beds: 1e6 }));
      return { stays: d.tourism!.stays, t };
    };
    expect(run(70).stays).toBeGreaterThan(run(-20).stays * 1.5);
  });
});

describe('the pool, the pull and the shares', () => {
  it('pool base = 3,000 + 0.3·ΣN + 40·ΣAttr visitors a month (WP2c ×10 of §5.10)', () => {
    expect(touristPoolBase(10_000, [50, 25], P)).toBe(3000 + 3000 + 40 * 75);
    expect(touristPoolBase(0, [], P)).toBe(3000);
  });

  it('pull X = (Attr·Q)^1.1 · (Rep/50) · (0.3 + 0.7·Aw)', () => {
    expect(touristPull(100, 50, 1, 1, 1, P)).toBeCloseTo(158.489319, 5);
    expect(touristPull(100, 25, 1, 1, 1, P)).toBeCloseTo(158.489319 / 2, 5);
    expect(touristPull(100, 50, 0, 1, 1, P)).toBeCloseTo(158.489319 * 0.3, 5);
    expect(touristPull(0, 50, 1, 1, 1, P)).toBe(0);
  });

  it("shares never sum past 1 (Kingsport and elsewhere take the rest), and a better town takes more", () => {
    const sh = touristShares([100, 200, 300, 0], [true, true, true, true], P);
    let s = 0;
    for (const x of sh) s += x;
    expect(s).toBeLessThan(1);
    expect(sh[3]).toBe(0);
    expect(sh[2]).toBeGreaterThan(sh[1]);
    // X_c / (ΣX + 2·mean of the others + X_elsewhere)
    expect(sh[0]).toBeCloseTo(100 / (600 + 2 * 250 + P.tourism.elsewhere), 12);
    expect(touristShares([100, 200], [false, true], P)[0]).toBe(0);
  });

  it('in a solo county reputation still matters (the 2·mean of all towns would pin the share at 1/3)', () => {
    const [low] = touristShares([touristPull(120, 25, 0.8, 1, 1, P)], [true], P);
    const [high] = touristShares([touristPull(120, 75, 0.8, 1, 1, P)], [true], P);
    expect(high / low).toBeGreaterThan(1.8);
  });

  it("uses the Regional Day's fixed pool and share when the snapshot has them", () => {
    const { c, i, t } = town();
    const m = { ...ctx(c, i, t, 1e6, { touristPool: 10_000, touristShare: 0.1 }), calendarMonth: 3 };
    stepTourism(t, m);
    const sat = m.derived.tourism!.satisfaction;
    expect(m.derived.tourism!.stays).toBeCloseTo(10_000 * 0.1 * (0.6 + (0.4 * sat) / 100), 9);
  });
});

describe('hotel tax is a price (§5.13)', () => {
  it('leaves the pull alone below City and at the default rate, and costs pull above it', () => {
    const { t } = town('town');
    t.taxes.hotel = 1200;
    expect(hotelPrice(t, P)).toBe(1); // a Town has no hotel tax yet
    t.tier = 3;
    t.taxes.hotel = P.finance.defaults.hotel;
    expect(hotelPrice(t, P)).toBeCloseTo(1, 12);
    t.taxes.hotel = 1200;
    const high = hotelPrice(t, P);
    expect(high).toBeCloseTo((1.05 / 1.12) ** 2, 9);
    t.taxes.hotel = 0;
    expect(hotelPrice(t, P)).toBeGreaterThan(1);
    expect(touristPull(10, 50, 1, 1, 1, P, high)).toBeLessThan(touristPull(10, 50, 1, 1, 1, P));
  });
});

describe('beds, satisfaction, reputation and awareness', () => {
  it('stays are capped at 12 stays a bed-month at 85% occupancy', () => {
    const { c, i, t } = town('town');
    const m = ctx(c, i, t, 10);
    stepTourism(t, m);
    expect(m.derived.tourism!.stays).toBeCloseTo(10 * 12 * 0.85, 9);
    expect(m.derived.tourism!.hotelNights).toBeCloseTo(10 * 12 * 0.85 * 2.5, 9);
    expect(t.marketMemo!.bedDemand).toBeGreaterThan(10);
  });

  it('crowds, crime and slow roads lower satisfaction; quality raises it', () => {
    const base = satisfaction(500, 1000, 0.8, 20, 50, P);
    expect(base).toBeCloseTo(60 + 0.3 * 30, 9);
    // Twice the attractions' capacity (with the 200 base) costs 40 points.
    expect(satisfaction(2 * 1200, 1000, 0.8, 20, 50, P)).toBeCloseTo(base - 40, 9);
    expect(satisfaction(500, 1000, 0.8, 50, 50, P)).toBeCloseTo(base - 0.3 * 20, 9);
    expect(satisfaction(500, 1000, 0.8, 20, 80, P)).toBeCloseTo(base + 0.2 * 30, 9);
    expect(satisfaction(1e7, 0, 0, 100, 0, P)).toBe(0);
  });

  it('reputation follows satisfaction with τ 12 months; awareness spreads by Bass diffusion and fades', () => {
    const { c, i, t } = town();
    t.rep = 40;
    t.aw = 0.2;
    const m = ctx(c, i, t, 1e6);
    stepTourism(t, m);
    const sat = m.derived.tourism!.satisfaction;
    expect(t.rep).toBeCloseTo(40 + (sat - 40) / 12, 12);
    expect(t.aw).toBeCloseTo(0.2 + ((0.01 + 0.3 * 0.2) * 0.8) / 12 - (0.01 * 0.2) / 12, 12);
    // Tourism Promotion triples the innovation rate.
    const b = town();
    b.t.aw = 0.2;
    b.t.policies.push({ card: 'tourismPromotion', sinceTick: 0, area: null });
    stepTourism(b.t, ctx(b.c, b.i, b.t, 1e6));
    expect(b.t.aw).toBeCloseTo(0.2 + ((0.03 + 0.3 * 0.2) * 0.8) / 12 - (0.01 * 0.2) / 12, 12);
  });

  it('Attr counts finished, undamaged attractions by funding, the beach, culture and fun; Q falls with crime', () => {
    const { c, i, t } = town('town');
    const m = ctx(c, i, t, 0);
    const a = attractionsOf(t, m);
    expect(a.appeal).toBeGreaterThan(0);
    expect(a.cap).toBeGreaterThan(0);
    t.funding = t.funding.map(() => 0);
    const low = attractionsOf(t, m);
    expect(low.appeal).toBeLessThan(a.appeal);
    const crime = attractionsOf(t, { ...m, derived: { ...m.derived, fields: { ...m.derived.fields!, safety: 20 } } });
    expect(crime.quality).toBeLessThan(a.quality);
  });
});

describe('events, the day books and the Why', () => {
  it('Ferry Fun lifts coast towns only; Sunny Weekend and Big Concert lift day trips', () => {
    const stays = (kind: 'hamlet' | 'town', id: string | null, trips = 0) => {
      const { c, i, t } = town(kind);
      const m = ctx(c, i, t, 1e6, { dayTripsIn: trips });
      m.world = { ...m.world, event: id ? { id, fromMonth: 0, toMonth: 1e9 } : null };
      stepTourism(t, m);
      return m.derived.tourism!;
    };
    expect(stays('hamlet', 'ferryFun').stays).toBeCloseTo(stays('hamlet', null).stays, 9);
    expect(stays('town', 'ferryFun').stays).toBeGreaterThan(stays('town', null).stays);
    expect(stays('hamlet', 'sunnyWeekend', 100).dayTrips).toBeCloseTo(140, 9);
    expect(stays('hamlet', 'bigConcert', 100).dayTrips).toBeCloseTo(125, 9);
  });

  it("adds the month's stays, day trips and their spending to the town's day for the Regional Day", () => {
    const { c, i, t } = town('town');
    const m = ctx(c, i, t, 1e6, { dayTripsIn: 40 });
    stepTourism(t, m);
    const tr = m.derived.tourism!;
    expect(t.realised.visitorsHosted).toBeCloseTo(tr.stays, 9);
    expect(t.realised.dayTripsHosted).toBe(40);
    expect(t.realised.touristSpend).toBeCloseTo(tr.stays * 2.5 * (95 + 60), 6);
    expect(t.realised.dayTripSpend).toBeCloseTo(40 * 35, 9);
    expect(tr.spend).toBeCloseTo(tr.stays * 2.5 * 155 + 40 * 35, 6);
    expect(tr.visitorRatio).toBeGreaterThan(0);
  });

  it("the visitors' terms add up to the visitors exactly", () => {
    const { c, i, t } = town('town');
    t.rep = 35;
    t.aw = 0.4;
    const m = { ...ctx(c, i, t, 50, { dayTripsIn: 25 }), calendarMonth: 7 };
    const adds: [string, number, string | undefined][] = [];
    let total = NaN;
    const spy: MonthContext = { ...m, why: { add: (k, a, q) => void adds.push([k, a, q]), set: (q, v) => void (q === 'visitors' && (total = v)) } };
    stepTourism(t, spy);
    let sum = 0;
    for (const [, a, q] of adds) if (q === 'visitors') sum += a;
    expect(sum).toBeCloseTo(total, 6);
    expect(total).toBeCloseTo(m.derived.tourism!.stays + 25, 6);
    const keys = adds.map(([k]) => k);
    for (const k of ['vis.attractions', 'vis.season', 'vis.reputation', 'vis.beds', 'vis.dayTrips']) expect(keys).toContain(k);
    expect(adds.find(([k]) => k === 'vis.reputation')![1]).toBeLessThan(0); // Rep 35 is below the neutral 50
    expect(adds.find(([k]) => k === 'vis.beds')![1]).toBeLessThan(0); // 50 beds turn people away
  });
});

describe('a scripted over-build (§13.2 acceptance)', () => {
  it('reputation falls within two days, stays down, and recovers only when a new attraction opens', () => {
    const { c, i, t } = seasideTown();
    const steps = marketSteps({ labour: {}, fields: { safety: 70 }, beds: 3000 });
    const rep: number[] = [];
    for (let k = 0; k < 120; k++) {
      runMonths(c, i, 1, steps);
      rep.push(t.rep);
    }
    expect(Math.min(...rep.slice(0, 24))).toBeLessThan(67 - 10);
    for (const r of rep.slice(24)) expect(r).toBeLessThan(67 - 10);
    const stuck = rep[rep.length - 1];
    expect(placeFree(t, 'museum')).toBe(true);
    expect(placeFree(t, 'botanicGarden')).toBe(true);
    for (let k = 0; k < 36; k++) {
      runMonths(c, i, 1, steps);
      rep.push(t.rep);
    }
    expect(rep[rep.length - 1]).toBeGreaterThan(stuck + 5);
  });
});
