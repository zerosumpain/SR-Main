// The Deputy's standing orders (spec §5.18): deterministic, logged to the
// inbox, bounded by their thresholds, switched off by Hold, and editable
// only as far as the seat's profile allows.

import { describe, expect, it } from 'vitest';
import { civicSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { kitTown, place, road } from '../../../../../scripts/hometowns/space-kit';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { applyCommand } from './commands';
import { ORDER_DEFAULTS } from './content';
import { monthlySpending } from './finance';
import { lineIndex, postWhole } from './core';
import { civicMemo, upkeepOf } from './finance';
import { stateHash } from './index';
import { AWAY_GREENS, AWAY_ROAD_TILES, GROWTH_KEEP_HOMES, GROWTH_STAFFED, MARKET_LOTS, MAX_ORDERS, backfillOrders, renewsContracts } from './orders';
import { DEPUTY_UNDO_MAX, applyBuild, applyUndo, mayorTilesToday } from './ops';
import { paramsFor } from './params';
import { B_KIND, CAT_ROAD, CAT_ZONE, MAP, planesForWrite, planesOf, tileIndex, useCat, usePayload, zoneUse } from './tiles';
import { BUILDINGS } from './content';
import { EngineError, FUNDING_KEYS, METER_INDUSTRY, METER_SHOPS, Z_HOMES, Z_INDUSTRY, Z_SHOPS, type StandingOrder } from './types';

const P = paramsFor('v1');

function refused(f: () => unknown, status: number, text?: RegExp): void {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).status).toBe(status);
    if (text) expect((e as Error).message).toMatch(text);
    return;
  }
  throw new Error('expected a refusal');
}

const town = (kind: 'hamlet' | 'town' = 'town') => {
  const f = fixture(kind);
  return { c: f.county, i: f.town, t: f.county.towns[f.town], now: f.now };
};

const only = (...kinds: string[]): StandingOrder[] => ORDER_DEFAULTS.map((o) => ({ kind: o.kind, on: kinds.includes(o.kind), args: [...o.args] }));

/** The town fixture's running costs, and a script that misses them by `gap` a month. */
function shortBy(t: ReturnType<typeof town>['t'], gap: number): CivicScript {
  const u = upkeepOf(t, P);
  return { housing: { rent: [0, 0, 0], occ: [0, 0, 0] }, firms: { turnover: (u.civic + u.utilities + u.roads - gap) / 0.04 } };
}

describe('Keep the budget healthy', () => {
  it('first sets Fun and Culture to Low, then raises homes tax 0.5 points a month, 2 points at most, never borrowing', () => {
    const { c, i, t } = town();
    t.orders = only('budgetHealthy');
    const script = shortBy(t, 20_000);
    // A month and a half of spending in reserve: under the 2-month line.
    postWhole(t, 'other', -t.money.reserves + 600_000);
    const seen: string[] = [];
    runMonths(c, i, 7, civicSteps(script), () => seen.push(`${t.funding[FUNDING_KEYS.indexOf('fun')]}${t.funding[FUNDING_KEYS.indexOf('culture')]}:${t.taxes.homes.join('/')}`));
    expect(seen).toEqual(['00:800/800/800', '00:850/850/850', '00:900/900/900', '00:950/950/950', '00:1000/1000/1000', '00:1000/1000/1000', '00:1000/1000/1000']);
    expect(civicMemo(t).deputyRaised).toBe(200);
    expect(t.money.loan).toBeNull();
    expect(t.money.bonds).toEqual([]);
    // Logged once per kind per day, with the amounts summed.
    const tax = t.inbox.find((x) => x.kind === 'deputy.budgetHealthy.tax')!;
    expect(tax.data.bp).toBe(200);
    expect(tax.data.times).toBe(4);
    expect(t.inbox.filter((x) => x.kind === 'deputy.budgetHealthy.funding')).toHaveLength(1);
  });

  it('does nothing while reserves are healthy, and forgets its raise once they are', () => {
    const { c, i, t } = town();
    t.orders = only('budgetHealthy');
    civicMemo(t).deputyRaised = 150;
    postWhole(t, 'other', 1e8);
    runMonths(c, i, 2, civicSteps(shortBy(t, -50_000)));
    expect(t.taxes.homes).toEqual([800, 800, 800]);
    expect(t.funding.every((f) => f === 1)).toBe(true);
    expect(civicMemo(t).deputyRaised).toBe(0);
  });

  it('is switched off by Hold, and by its own switch', () => {
    for (const orders of [only('budgetHealthy', 'hold'), only()]) {
      const { c, i, t } = town();
      t.orders = orders;
      postWhole(t, 'other', -t.money.reserves + 600_000);
      runMonths(c, i, 3, civicSteps(shortBy(t, 20_000)));
      expect(t.taxes.homes).toEqual([800, 800, 800]);
      expect(t.inbox.some((x) => x.kind.startsWith('deputy.budgetHealthy'))).toBe(false);
    }
  });
});

describe('While I am away, zone next to roads', () => {
  type Town = ReturnType<typeof town>['t'];
  const zoned = (t: Town, z: number) => {
    const p = planesOf(t);
    let n = 0;
    for (let k = 0; k < MAP * MAP; k++) if (useCat(p.use[k]) === CAT_ZONE && usePayload(p.use[k]) === z) n++;
    return n;
  };
  const roadside = (t: Town, k: number) => {
    const p = planesOf(t);
    const x = k % MAP;
    const y = (k - x) / MAP;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= 0 && x + dx < MAP && y + dy >= 0 && y + dy < MAP && useCat(p.use[(y + dy) * MAP + x + dx]) === CAT_ROAD);
  };

  it('zones up to 12 Homes or Shops tiles a day when the meter is above 60 and reserves exceed 3 months', () => {
    // An empty Village with one long street: plenty of roadside land.
    const { c, i, t } = kitTown({ tier: 1 });
    road(t, 4, 30, 60, 30, 'street');
    t.orders = only('awayZoning');
    t.away.lastHelloAt = 0; // long gone
    postWhole(t, 'other', 1e7);
    t.meters[0] = 80;
    t.meters[METER_SHOPS] = 70;
    const homes0 = zoned(t, Z_HOMES);
    const shops0 = zoned(t, Z_SHOPS);
    const before = planesOf(t).use.slice();
    const hold = (tt: typeof t) => {
      tt.meters[0] = 80;
      tt.meters[METER_SHOPS] = 70;
      return {};
    };
    runMonths(c, i, 12, civicSteps(hold));
    const homes = zoned(t, Z_HOMES) - homes0;
    const shops = zoned(t, Z_SHOPS) - shops0;
    expect(homes + shops).toBe(12); // one day's allowance
    expect(homes).toBe(6);
    expect(shops).toBe(6);
    const after = planesOf(t).use;
    for (let k = 0; k < MAP * MAP; k++) if (after[k] !== before[k]) expect(roadside(t, k)).toBe(true);
    expect(t.inbox.find((x) => x.kind === 'deputy.awayZoning')!.data.homes).toBe(6);
    c.dayIndex += 1;
    runMonths(c, i, 1, civicSteps(hold));
    expect(zoned(t, Z_HOMES) - homes0 + zoned(t, Z_SHOPS) - shops0).toBe(24);
  });

  it('does not zone for a mayor who said hello today, or with thin reserves', () => {
    for (const setup of ['present', 'poor'] as const) {
      const { c, i, t } = town('hamlet');
      t.orders = only('awayZoning');
      t.away.lastHelloAt = setup === 'present' ? 9e15 : 0;
      if (setup === 'poor') postWhole(t, 'other', -t.money.reserves);
      const before = planesOf(t).use.slice();
      runMonths(c, i, 2, civicSteps((tt) => ((tt.meters[0] = 80), {})));
      expect(Array.from(planesOf(t).use)).toEqual(Array.from(before));
    }
  });

  it('zones from a lower line in a Hamlet (civic.awayHamletMeterAt, G8): a hamlet’s meters never reach 60', () => {
    expect(P.civic.awayHamletMeterAt).toBe(20);
    const got: Record<number, number> = {};
    for (const tier of [0, 1] as const) {
      const { c, i, t } = kitTown({ tier });
      road(t, 4, 30, 60, 30, 'street');
      t.orders = only('awayZoning');
      t.away.lastHelloAt = 0;
      postWhole(t, 'other', 1e7);
      const homes0 = zoned(t, Z_HOMES);
      runMonths(c, i, 12, civicSteps((tt) => {
        tt.meters.fill(0);
        tt.meters[0] = 30; // above the Hamlet line (20), under the order's own 60
        tt.meters[METER_SHOPS] = -20;
        return {};
      }));
      got[tier] = zoned(t, Z_HOMES) - homes0;
    }
    expect(got[0]).toBe(12); // the Hamlet zones its day's allowance of Homes lots
    expect(got[1]).toBe(0); // a Village keeps the order's 60
  });
});

describe('While I am away, build the Village checklist (decision 6)', () => {
  type Town = ReturnType<typeof kitTown>['t'];
  /** A Hamlet with one street at y = 30 and twelve Homes lots along it, its mayor long gone. */
  const hamlet = () => {
    const k = kitTown({ tier: 0 });
    road(k.t, 4, 30, 60, 30, 'street');
    const w = planesForWrite(k.t);
    for (let x = 10; x < 22; x++) {
      w.use[tileIndex(x, 29)] = zoneUse(Z_HOMES);
      w.lvl[tileIndex(x, 29)] = 1;
    }
    k.t.orders = only('awayZoning');
    k.t.away.lastHelloAt = 0;
    return k;
  };
  /** Holds the meters where nothing else is zoned: Homes and jobs under 60, Shops unwanted unless `shops`. */
  const hold = (shops = -20) => (tt: Town) => {
    tt.meters.fill(0);
    tt.meters[METER_SHOPS] = shops;
    return {};
  };
  const ids = (t: Town) => t.buildings.map((b) => BUILDINGS[b[B_KIND]].id).filter((id) => id !== 'townHall');
  const notes = (t: Town, kind: string) => t.inbox.filter((x) => x.kind === kind);

  it('builds one item a Regional Day, a School House first, then a Village Green, paid from reserves, with a Deputy card for each', () => {
    const { c, i, t } = hamlet();
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 12, civicSteps(hold()));
    expect(ids(t)).toEqual(['schoolHouse']); // twelve months, one Regional Day: one item
    const card = notes(t, 'deputy.awayCivic.build');
    expect(card).toHaveLength(1);
    expect(card[0].data).toMatchObject({ building: 'schoolHouse', item: 'school', cost: 12_000 });
    expect(t.deputyUndo!.at(-1)!.planId).toBe(`deputy.${c.dayIndex}.schoolHouse`); // the same build plan as a mayor’s move, on the Deputy’s own undo list (decision 11)
    c.dayIndex += 1;
    runMonths(c, i, 12, civicSteps(hold()));
    expect(ids(t)).toEqual(['schoolHouse', 'villageGreen']);
    expect(notes(t, 'deputy.awayCivic.build').map((x) => x.data.building)).toEqual(['schoolHouse', 'villageGreen']);
  });

  it('puts a building within road reach but off the road edge, near the homes it serves', () => {
    const { c, i, t } = hamlet();
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 1, civicSteps(hold()));
    const b = t.buildings.find((x) => BUILDINGS[x[B_KIND]].id === 'schoolHouse')!;
    expect(b[2]).toBeGreaterThanOrEqual(28); // y: within two tiles of the street…
    expect(b[2]).toBeLessThanOrEqual(32);
    expect(b[2] === 29 || b[2] === 31).toBe(false); // …but not on its edge, which stays for homes and shops
    expect(b[1]).toBeGreaterThanOrEqual(10 - 4);
    expect(b[1]).toBeLessThanOrEqual(21 + 4);
  });

  it('only spends the money above the safety floor: a cheap green may go ahead of a dear school', () => {
    const { c, i, t } = hamlet();
    t.away.lastHelloAt = 9e15; // present for a month, so the books know the spending
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 1, civicSteps(hold()));
    const floor = 3 * monthlySpending(t);
    postWhole(t, 'other', -t.money.reserves + floor + 7_000); // a Green (£2,000) fits above the floor; a School House (£12,000) does not
    t.away.lastHelloAt = 0;
    runMonths(c, i, 1, civicSteps(hold()));
    expect(ids(t)).toEqual(['villageGreen']);
    expect(t.money.reserves).toBeGreaterThan(floor);
  });

  it('builds one thing at a time and stops at one school and three greens', () => {
    const { c, i, t } = hamlet();
    postWhole(t, 'other', 1e7);
    for (let d = 0; d < 8; d++) {
      runMonths(c, i, 12, civicSteps(hold()));
      c.dayIndex += 1;
    }
    const got = ids(t);
    expect(got.filter((x) => x === 'schoolHouse')).toHaveLength(1);
    expect(got.filter((x) => x === 'villageGreen').length).toBeLessThanOrEqual(AWAY_GREENS);
  });

  it('zones the market’s Shops lots by the road once shops are wanted, inside the day’s zoning allowance', () => {
    const { c, i, t } = hamlet();
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 1, civicSteps(hold(15)));
    const p = planesOf(t);
    let lots = 0;
    for (let k = 0; k < MAP * MAP; k++) if (p.use[k] === zoneUse(Z_SHOPS)) lots++;
    // The Shops meter (15) is under the zoning order's Hamlet line (20), so every lot is the market's.
    expect(lots).toBe(MARKET_LOTS);
    expect(notes(t, 'deputy.awayCivic.market')[0].data.shops).toBe(MARKET_LOTS);
    expect(ids(t)).toEqual([]); // the market was today's item
  });

  it('does nothing for a mayor who is here, under Hold, with the order off, or past Hamlet', () => {
    for (const setup of ['present', 'hold', 'off', 'village'] as const) {
      const { c, i, t } = hamlet();
      postWhole(t, 'other', 1e6);
      if (setup === 'present') t.away.lastHelloAt = 9e15;
      if (setup === 'hold') t.orders = only('awayZoning', 'hold');
      if (setup === 'off') t.orders = only();
      if (setup === 'village') t.tier = 1;
      runMonths(c, i, 12, civicSteps(hold(30)));
      expect(ids(t), setup).toEqual([]);
      expect(notes(t, 'deputy.awayCivic.build'), setup).toHaveLength(0);
      expect(notes(t, 'deputy.awayCivic.market'), setup).toHaveLength(0);
    }
  });
});

describe('While I am away, lay a short lane when the roadside is full (decision 8)', () => {
  type Town = ReturnType<typeof kitTown>['t'];
  /** A Hamlet with a Lane from x 20 to 25 at y 30, both sides lined with built homes, its mayor long gone. */
  const boxed = () => {
    const k = kitTown({ tier: 0 });
    road(k.t, 20, 30, 25, 30, 'lane');
    const w = planesForWrite(k.t);
    for (let x = 20; x <= 25; x++)
      for (const y of [29, 31]) {
        w.use[tileIndex(x, y)] = zoneUse(Z_HOMES);
        w.lvl[tileIndex(x, y)] = 1;
      }
    k.t.orders = only('awayZoning');
    k.t.away.lastHelloAt = 0;
    return k;
  };
  /** Homes wanted (80, over the order's 60); nothing else. */
  const homesWanted = (tt: Town) => {
    tt.meters.fill(0);
    tt.meters[0] = 80;
    return {};
  };
  const isRoad = (t: Town, x: number, y: number) => useCat(planesOf(t).use[tileIndex(x, y)]) === CAT_ROAD;
  const homesAt = (t: Town) => {
    const out: number[] = [];
    const p = planesOf(t);
    for (let k = 0; k < MAP * MAP; k++) if (p.use[k] === zoneUse(Z_HOMES) && p.lvl[k] === 0) out.push(k);
    return out;
  };

  it('extends a dead end by up to six tiles, once a Regional Day, through the build plan, then zones the new frontage', () => {
    const { c, i, t } = boxed();
    postWhole(t, 'other', 1e6);
    const before = t.money.reserves;
    runMonths(c, i, 12, civicSteps(homesWanted));
    // The east end is nearer the Town Hall: Lane tiles 26…31, and nothing else today.
    for (let x = 26; x < 26 + AWAY_ROAD_TILES; x++) expect(isRoad(t, x, 30), `x ${x}`).toBe(true);
    expect(isRoad(t, 19, 30)).toBe(false);
    expect(isRoad(t, 26 + AWAY_ROAD_TILES, 30)).toBe(false);
    const card = t.inbox.filter((x) => x.kind === 'deputy.awayRoad');
    expect(card).toHaveLength(1);
    expect(card[0].data).toMatchObject({ tiles: AWAY_ROAD_TILES, cost: AWAY_ROAD_TILES * 1500 });
    expect(t.deputyUndo!.some((e) => e.planId === `deputy.${c.dayIndex}.road`)).toBe(true);
    expect(before - t.money.reserves).toBeGreaterThanOrEqual(AWAY_ROAD_TILES * 1500);
    // The day's twelve Homes lots went on the new lane's sides; the tiles beyond both dead ends stay free.
    const lots = homesAt(t);
    expect(lots).toHaveLength(12);
    for (const k of lots) {
      const x = k % MAP;
      const y = (k - x) / MAP;
      expect(x >= 26 && x <= 31 && (y === 29 || y === 31), `lot ${x},${y}`).toBe(true);
    }
    expect(planesOf(t).use[tileIndex(19, 30)]).toBe(0);
    expect(planesOf(t).use[tileIndex(32, 30)]).toBe(0);
    // The next Regional Day: one more lane.
    c.dayIndex += 1;
    runMonths(c, i, 12, civicSteps(homesWanted));
    expect(t.inbox.filter((x) => x.kind === 'deputy.awayRoad')).toHaveLength(2);
  });

  it('only spends the money above the safety floor: a shorter lane when that is all it can pay for', () => {
    const { c, i, t } = boxed();
    t.away.lastHelloAt = 9e15; // present for a month, so the books know the spending
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 1, civicSteps(homesWanted));
    const floor = 3 * monthlySpending(t);
    postWhole(t, 'other', -t.money.reserves + floor + 7_000); // under six Lane tiles (£9,000) above the floor
    t.away.lastHelloAt = 0;
    runMonths(c, i, 1, civicSteps(homesWanted));
    const n = t.inbox.find((x) => x.kind === 'deputy.awayRoad')!.data.tiles as number;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(AWAY_ROAD_TILES);
    expect(isRoad(t, 25 + n, 30)).toBe(true);
    expect(isRoad(t, 26 + n, 30)).toBe(false);
    expect(t.money.reserves).toBeGreaterThan(floor);
  });

  it('lays no lane that would open no lot to zone: the tile beyond its dead end does not count', () => {
    const { c, i, t } = boxed();
    // Both ways out of the lane's ends lined with built homes: a lane there would only open the tile beyond its end,
    // which the Deputy leaves free as a dead end's continuation.
    const w = planesForWrite(t);
    for (const xs of [[14, 19], [26, 31]])
      for (let x = xs[0]; x <= xs[1]; x++)
        for (const y of [29, 31]) {
          w.use[tileIndex(x, y)] = zoneUse(Z_HOMES);
          w.lvl[tileIndex(x, y)] = 1;
        }
    postWhole(t, 'other', 1e6);
    runMonths(c, i, 12, civicSteps(homesWanted));
    expect(t.inbox.filter((x) => x.kind === 'deputy.awayRoad')).toHaveLength(0);
    expect(isRoad(t, 26, 30)).toBe(false);
    expect(isRoad(t, 19, 30)).toBe(false);
  });

  it('lays nothing while roadside land is free, when nothing is wanted, or for a mayor who is here', () => {
    for (const setup of ['free', 'unwanted', 'present'] as const) {
      const { c, i, t } = boxed();
      postWhole(t, 'other', 1e6);
      if (setup === 'free') road(t, 20, 40, 40, 40, 'lane');
      if (setup === 'present') t.away.lastHelloAt = 9e15;
      runMonths(c, i, 12, civicSteps(setup === 'unwanted' ? (tt: Town) => (tt.meters.fill(0), {}) : homesWanted));
      expect(t.inbox.filter((x) => x.kind === 'deputy.awayRoad'), setup).toHaveLength(0);
      expect(isRoad(t, 26, 30), setup).toBe(false);
    }
  });
});

describe('Keep the town growing: jobs and services for the next tier (G3)', () => {
  type Town = ReturnType<typeof kitTown>['t'];
  /** A Village with a street at y 30 and twenty built Homes lots along its north side; the mayor is here. */
  const village = () => {
    const k = kitTown({ tier: 1 });
    road(k.t, 4, 30, 60, 30, 'street');
    const w = planesForWrite(k.t);
    for (let x = 10; x < 30; x++) {
      w.use[tileIndex(x, 29)] = zoneUse(Z_HOMES);
      w.lvl[tileIndex(x, 29)] = 1;
    }
    k.t.orders = only('growthHelp');
    k.t.away.lastHelloAt = 9e15;
    postWhole(k.t, 'other', 1e6);
    return k;
  };
  /** Meters all at 0 but `industry`; services uncovered (the neutral coverage); `jobless` of `workforce` £ workers out of work. */
  const economy = (industry: number, jobless = 0, workforce = 300) => (tt: Town) => {
    tt.meters.fill(0);
    tt.meters[METER_INDUSTRY] = industry;
    return { labour: { workforce: [workforce, 0, 0], unemployed: [jobless, 0, 0] } };
  };
  const ids = (t: Town) => t.buildings.map((b) => BUILDINGS[b[B_KIND]].id);
  const notes = (t: Town, kind: string) => t.inbox.filter((x) => x.kind === kind);
  const lots = (t: Town, z: number, empty = true) => {
    const p = planesOf(t);
    let n = 0;
    for (let k = 0; k < MAP * MAP; k++) if (p.use[k] === zoneUse(z) && (!empty || p.lvl[k] === 0)) n++;
    return n;
  };

  it('builds the missing service for a lapsed coverage item, one a Regional Day in checklist order, with a Deputy card', () => {
    const { c, i, t } = village();
    runMonths(c, i, 12, civicSteps(economy(0)));
    expect(ids(t)).toEqual(['surgery']); // surgery70 comes first; one building a day
    const card = notes(t, 'deputy.growthHelp.build');
    expect(card).toHaveLength(1);
    expect(card[0].data).toMatchObject({ building: 'surgery', item: 'surgery70', cost: 30_000 });
    expect(t.deputyUndo!.at(-1)!.planId).toBe(`deputy.${c.dayIndex}.help.surgery`); // the same build plan as a mayor's move
    c.dayIndex += 1;
    runMonths(c, i, 12, civicSteps(economy(0)));
    expect(notes(t, 'deputy.growthHelp.build')).toHaveLength(2); // the next Regional Day, the next one
  });

  it('adds no more of a service while one is being built, or while its buildings are short of staff', () => {
    for (const o of [{ building: true }, { staff: GROWTH_STAFFED - 100 }]) {
      const { c, i, t } = village();
      place(t, 'surgery', 20, 32, o);
      runMonths(c, i, 1, civicSteps(economy(0)));
      expect(ids(t), JSON.stringify(o)).toEqual(['surgery', 'constablePost']); // police50 instead
    }
  });

  it('zones work lots by the road for the jobless when the jobs item is about to lapse', () => {
    const { c, i, t } = village();
    runMonths(c, i, 1, civicSteps(economy(20, 30))); // 10% out of work: within the 5-point margin of the item's 10%
    expect(lots(t, Z_INDUSTRY)).toBe(5); // 30 jobless ÷ 6 jobs a lot
    expect(notes(t, 'deputy.growthHelp.jobs')[0].data).toMatchObject({ tiles: 5, zone: 'industry' });
  });

  it('counts the workers of the Homes lots still waiting, and the jobs of the work lots already waiting', () => {
    const { c, i, t } = village();
    const w = planesForWrite(t);
    for (let x = 10; x < 22; x++) w.lvl[tileIndex(x, 29)] = 0; // twelve Homes lots nobody has built on yet
    runMonths(c, i, 1, civicSteps(economy(20, 30)));
    // 30 jobless + 12 lots × 8 residents × (300 workers ÷ the town's people), at most 24 lots a day.
    const pop = t.people.reduce((a, b) => a + b, 0);
    const wanted = 30 + (pop > 0 ? (300 / pop) * 12 * 8 : 0);
    expect(lots(t, Z_INDUSTRY)).toBe(Math.min(24, Math.ceil(wanted / 6)));
  });

  it('zones no work when no trade wants workers, or when unemployment is well under the line', () => {
    for (const [industry, jobless] of [[-10, 60], [20, 6]] as const) {
      const { c, i, t } = village();
      runMonths(c, i, 1, civicSteps(economy(industry, jobless)));
      expect(lots(t, Z_INDUSTRY, false), `${industry}/${jobless}`).toBe(0);
    }
  });

  it('repaints surplus empty Homes lots for work when the roads are full, keeping some for the builders', () => {
    // Both sides of a short street lined with empty Homes lots, its dead ends blocked: no free roadside land, no lane.
    const k = kitTown({ tier: 1 });
    road(k.t, 10, 40, 29, 40, 'street');
    place(k.t, 'villageGreen', 9, 40);
    place(k.t, 'villageGreen', 30, 40);
    const w = planesForWrite(k.t);
    for (let x = 10; x < 30; x++)
      for (const y of [39, 41]) {
        w.use[tileIndex(x, y)] = zoneUse(Z_HOMES);
        w.lvl[tileIndex(x, y)] = 0;
      }
    k.t.orders = only('growthHelp');
    k.t.away.lastHelloAt = 9e15;
    postWhole(k.t, 'other', 1e6);
    runMonths(k.c, k.i, 1, civicSteps(economy(20, 240, 1200)));
    const rezoned = notes(k.t, 'deputy.growthHelp.rezone');
    expect(rezoned).toHaveLength(1);
    expect(lots(k.t, Z_HOMES)).toBe(GROWTH_KEEP_HOMES);
    expect(lots(k.t, Z_INDUSTRY)).toBe(40 - GROWTH_KEEP_HOMES);
    expect(rezoned[0].data).toMatchObject({ tiles: 40 - GROWTH_KEEP_HOMES, zone: 'industry' });
  });

  it('repaints only empty Homes lots a builder can reach from a road', () => {
    const k = kitTown({ tier: 1 });
    road(k.t, 10, 40, 29, 40, 'street');
    place(k.t, 'villageGreen', 9, 40);
    place(k.t, 'villageGreen', 30, 40);
    const w = planesForWrite(k.t);
    for (let x = 10; x < 30; x++)
      for (const y of [39, 41]) {
        w.use[tileIndex(x, y)] = zoneUse(Z_HOMES);
        w.lvl[tileIndex(x, y)] = 0;
      }
    // Ten more empty Homes lots with no road in reach, nearer the Town Hall (33, 44) than the street's.
    for (let x = 33; x < 38; x++) for (const y of [46, 47]) w.use[tileIndex(x, y)] = zoneUse(Z_HOMES);
    k.t.orders = only('growthHelp');
    k.t.away.lastHelloAt = 9e15;
    postWhole(k.t, 'other', 1e6);
    runMonths(k.c, k.i, 1, civicSteps(economy(20, 240, 1200)));
    expect(lots(k.t, Z_INDUSTRY)).toBe(24); // the day's most
    expect(lots(k.t, Z_HOMES)).toBe(50 - 24);
    for (let x = 33; x < 38; x++) for (const y of [46, 47]) expect(planesOf(k.t).use[tileIndex(x, y)], `${x},${y}`).toBe(zoneUse(Z_HOMES));
  });

  it('does nothing in a Hamlet, under Hold, with the order off, or below the safety floor', () => {
    for (const setup of ['hamlet', 'hold', 'off', 'poor'] as const) {
      const { c, i, t } = village();
      if (setup === 'hamlet') t.tier = 0;
      if (setup === 'hold') t.orders = only('growthHelp', 'hold');
      if (setup === 'off') t.orders = only();
      if (setup === 'poor') postWhole(t, 'other', -t.money.reserves);
      runMonths(c, i, 12, civicSteps(economy(20, 60)));
      expect(ids(t), setup).toEqual([]);
      expect(lots(t, Z_INDUSTRY, false), setup).toBe(0);
    }
  });
});

describe('The Deputy leaves the mayor’s day alone (decision 11)', () => {
  type Town = ReturnType<typeof kitTown>['t'];
  const economy = (tt: Town) => {
    tt.meters.fill(0);
    tt.meters[METER_INDUSTRY] = 20;
    return { labour: { workforce: [1200, 0, 0], unemployed: [240, 0, 0] } };
  };
  /** A Village street lined on its north side with 20 empty Homes lots; its dead ends blocked (no lane). */
  const street = () => {
    const k = kitTown({ tier: 1 });
    road(k.t, 10, 40, 29, 40, 'street');
    place(k.t, 'villageGreen', 9, 40);
    place(k.t, 'villageGreen', 30, 40);
    const w = planesForWrite(k.t);
    for (let x = 10; x < 30; x++) w.use[tileIndex(x, 39)] = zoneUse(Z_HOMES);
    k.t.orders = only('growthHelp');
    k.t.away.lastHelloAt = 9e15;
    postWhole(k.t, 'other', 1e6);
    return k;
  };
  const kid = (c: { dayIndex: number }) => ({ params: P, dayIndex: c.dayIndex, profile: 'kid' as const });
  const lots = (t: Town, z: number) => {
    const p = planesOf(t);
    let n = 0;
    for (let k = 0; k < MAP * MAP; k++) if (p.use[k] === zoneUse(z)) n++;
    return n;
  };

  it('a child zones a street’s south side, then growth help repaints lots: the child’s lots are untouched and the child’s undo works', () => {
    const { c, i, t } = street();
    applyBuild(t, 'kid-zone', [{ op: 'zone', zone: 'homes', rect: [10, 41, 20, 1] }], kid(c));
    runMonths(c, i, 1, civicSteps(economy));
    const rezoned = t.inbox.filter((x) => x.kind === 'deputy.growthHelp.rezone');
    expect(rezoned).toHaveLength(1); // the order ran, and repainted the lots that were not the child’s
    for (let x = 10; x < 30; x++) expect(planesOf(t).use[tileIndex(x, 41)], `${x}`).toBe(zoneUse(Z_HOMES));
    expect(mayorTilesToday(t, c.dayIndex)![tileIndex(10, 41)]).toBe(1);
    expect(applyUndo(t, 'kid-zone', kid(c)).ok).toBe(true);
    for (let x = 10; x < 30; x++) expect(planesOf(t).use[tileIndex(x, 41)], `${x}`).toBe(0);
  });

  it('the same street on another day is the Deputy’s to repaint', () => {
    const { c, i, t } = street();
    applyBuild(t, 'kid-zone', [{ op: 'zone', zone: 'homes', rect: [10, 41, 20, 1] }], kid(c));
    t.undo = []; // the Regional Day closed: yesterday’s plans are no longer the mayor’s today
    runMonths(c, i, 1, civicSteps(economy));
    expect(lots(t, Z_INDUSTRY)).toBe(24);
  });

  it('puts its builds on its own list: a full mayor’s list keeps every entry, and the Deputy’s build can be undone the same day', () => {
    const k = kitTown({ tier: 1 });
    road(k.t, 4, 30, 60, 30, 'street');
    const w = planesForWrite(k.t);
    for (let x = 10; x < 30; x++) {
      w.use[tileIndex(x, 29)] = zoneUse(Z_HOMES);
      w.lvl[tileIndex(x, 29)] = 1;
    }
    k.t.orders = only('growthHelp');
    postWhole(k.t, 'other', 1e6);
    for (let n = 0; n < P.build.undoMax; n++) applyBuild(k.t, `m${n}`, [{ op: 'zone', zone: 'homes', rect: [4 + n, 31, 1, 1] }], kid(k.c));
    const mine = k.t.undo.map((e) => e.planId);
    expect(mine).toHaveLength(P.build.undoMax);
    const reserves = k.t.money.reserves;
    runMonths(k.c, k.i, 1, civicSteps((tt: Town) => (tt.meters.fill(0), {})));
    expect(k.t.undo.map((e) => e.planId)).toEqual(mine);
    const deputy = k.t.deputyUndo!;
    expect(deputy.map((e) => e.planId)).toEqual([`deputy.${k.c.dayIndex}.help.surgery`]);
    expect(k.t.buildings.map((b) => BUILDINGS[b[B_KIND]].id)).toEqual(['surgery']);
    const spent = reserves - k.t.money.reserves;
    const r = applyUndo(k.t, deputy[0].planId, kid(k.c));
    expect(r.cost).toBe(-30_000);
    expect(k.t.buildings).toEqual([]);
    expect(k.t.deputyUndo).toEqual([]);
    expect(spent).toBeGreaterThan(0);
    for (const id of mine) expect(applyUndo(k.t, id, kid(k.c)).ok).toBe(true); // every one of the mayor’s still works
  });

  it('keeps at most DEPUTY_UNDO_MAX Deputy builds, and still guards a mayor’s plan that fell off a full list', () => {
    const k = kitTown({ tier: 1 });
    const env = { ...kid(k.c), deputy: true };
    road(k.t, 4, 30, 60, 30, 'street');
    postWhole(k.t, 'other', 1e6);
    for (let n = 0; n < DEPUTY_UNDO_MAX + 2; n++) applyBuild(k.t, `d${n}`, [{ op: 'road', kind: 'lane', path: [4 + 2 * n, 31, 4 + 2 * n, 31] }], env);
    expect(k.t.deputyUndo!.map((e) => e.planId)).toEqual(Array.from({ length: DEPUTY_UNDO_MAX }, (_, n) => `d${n + 2}`));
    expect(k.t.undo).toEqual([]);
    for (let n = 0; n <= P.build.undoMax; n++) applyBuild(k.t, `m${n}`, [{ op: 'zone', zone: 'homes', rect: [4 + n, 29, 1, 1] }], kid(k.c));
    expect(k.t.undo.some((e) => e.planId === 'm0')).toBe(false); // fell off the mayor’s list…
    expect(mayorTilesToday(k.t, k.c.dayIndex)![tileIndex(4, 29)]).toBe(1); // …but is still the mayor’s today
    refused(() => applyBuild(k.t, 'dx', [{ op: 'dezone', rect: [4, 29, 1, 1] }], env), 409, /mayor built there today/);
    expect(mayorTilesToday(k.t, k.c.dayIndex + 1)).toBeNull();
  });
});

describe('Pay back the Town Loan early', () => {
  it('repays what keeps three months of spending in hand, with the 1% fee', () => {
    const { c, i, t } = town();
    t.orders = only('repayLoan');
    t.money.loan = { principal: 2_000_000, rate: 0.05, monthsLeft: 120, payment: 21_213 };
    postWhole(t, 'other', 3e6);
    const [d] = runMonths(c, i, 1, civicSteps({ housing: { rent: [300, 450, 800], occ: [1000, 2000, 500] }, firms: { turnover: 10_000_000 } }));
    const repaid = -d.ledger!.lines[lineIndex('repayment')];
    expect(repaid).toBeGreaterThan(0);
    expect(t.money.reserves).toBeGreaterThanOrEqual(Math.floor(3 * civicMemo(t).spending) - 1);
    expect(-d.ledger!.lines[lineIndex('interest')]).toBe(Math.round(repaid * 0.01));
    expect(t.inbox.some((x) => x.kind === 'deputy.repayLoan')).toBe(true);
  });
});

describe('orders run deterministically', () => {
  it('gives the same town, inbox and all, every time', () => {
    const run = () => {
      const { c, i, t } = town();
      t.orders = only('budgetHealthy', 'buyUtilities', 'repayLoan', 'awayZoning');
      t.away.lastHelloAt = 0;
      postWhole(t, 'other', -t.money.reserves + 700_000);
      runMonths(c, i, 30, civicSteps((tt) => ({ ...shortBy(tt, ((tt.tick * 7919) % 50_000) - 20_000), utilities: { importCost: 1000, powerImported: 250 } })));
      return { hash: stateHash(t), inbox: JSON.stringify(t.inbox) };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.inbox).toContain('deputy.buyUtilities');
  });
});

describe('the other orders', () => {
  it('reports the month’s repair bill (WP2e repairs under "Fix damaged buildings")', () => {
    const { c, i, t } = town();
    t.orders = only('fixDamaged');
    postWhole(t, 'repairs', -12_500);
    runMonths(c, i, 1, civicSteps({ firms: { turnover: 10_000_000 } }));
    expect(t.inbox.find((x) => x.kind === 'deputy.fixDamaged')!.data.cost).toBe(12_500);
  });

  it('tells WP3 whether to renew contracts', () => {
    const { t } = town();
    t.orders = only('renewContracts');
    expect(renewsContracts(t)).toBe(true);
    t.orders = only('renewContracts', 'hold');
    expect(renewsContracts(t)).toBe(false);
  });
});

describe('the orders move', () => {
  it('lets an adult reorder, drop and retune orders within bounds', () => {
    const { c, t, now } = town();
    const next: StandingOrder[] = [
      { kind: 'repayLoan', on: true, args: [6] },
      { kind: 'budgetHealthy', on: true, args: [3, 100] },
    ];
    applyCommand(c, { seat: t.seat, profile: 'adult' }, { type: 'orders', moveId: 'o1', orders: next }, now);
    expect(t.orders).toEqual(next);
    let k = 0;
    const bad = (orders: unknown, text: RegExp) => refused(() => applyCommand(c, { seat: t.seat, profile: 'adult' }, { type: 'orders', moveId: `bad${k++}`, orders: orders as StandingOrder[] }, now), 400, text);
    bad([{ kind: 'conquer', on: true, args: [] }], /knows/);
    bad([{ kind: 'hold', on: true, args: [] }, { kind: 'hold', on: false, args: [] }], /once/);
    bad([{ kind: 'budgetHealthy', on: true, args: [3] }], /settings/);
    bad([{ kind: 'budgetHealthy', on: true, args: [3, 9000] }], /range/);
    bad(new Array(13).fill({ kind: 'hold', on: true, args: [] }), /up to 12/);
    bad(new Array(9).fill({ kind: 'hold', on: true, args: [] }), /once/); // 9 is within the cap now (decision 12)
  });

  it('lets a child switch orders on and off, but not change how they work', () => {
    const { c, t, now } = town();
    const flipped = t.orders.map((o) => ({ ...o, on: !o.on, args: [...o.args] }));
    applyCommand(c, { seat: t.seat, profile: 'kid' }, { type: 'orders', moveId: 'k1', orders: flipped }, now);
    expect(t.orders).toEqual(flipped);
    const retuned = t.orders.map((o) => (o.kind === 'budgetHealthy' ? { ...o, args: [4, 200] } : o));
    refused(() => applyCommand(c, { seat: t.seat, profile: 'kid' }, { type: 'orders', moveId: 'k2', orders: retuned }, now), 403, /grown-up/);
    refused(() => applyCommand(c, { seat: t.seat, profile: 'kid' }, { type: 'orders', moveId: 'k3', orders: [...t.orders].reverse() }, now), 403);
  });

  it('holds up to 12 orders (decision 12)', () => {
    expect(MAX_ORDERS).toBe(12);
  });

  it('gives a child’s town the default orders it lacks, in place, once; never an adult’s (decision 12)', () => {
    const { c, t } = town();
    c.settings.perSeat[t.seat] = { ...c.settings.perSeat[t.seat], profile: 'kid' };
    const full = t.orders.map((o) => ({ ...o, args: [...o.args] }));
    const missing = t.orders.filter((o) => o.kind !== 'growthHelp' && o.kind !== 'hold');
    t.orders = missing.map((o) => ({ ...o, on: !o.on, args: [...o.args] })); // the child’s switches are kept
    expect(backfillOrders(c)).toBe(2);
    expect(t.orders.map((o) => o.kind)).toEqual(full.map((o) => o.kind));
    expect(t.orders.find((o) => o.kind === 'growthHelp')).toEqual({ kind: 'growthHelp', on: true, args: [24, 3, 5] });
    expect(t.orders.find((o) => o.kind === 'hold')!.on).toBe(false);
    expect(t.orders.find((o) => o.kind === 'budgetHealthy')!.on).toBe(!full[0].on);
    const h = stateHash(t);
    expect(backfillOrders(c)).toBe(0);
    expect(stateHash(t)).toBe(h);
    c.settings.perSeat[t.seat] = { ...c.settings.perSeat[t.seat], profile: 'adult' };
    t.orders = t.orders.filter((o) => o.kind !== 'growthHelp');
    expect(backfillOrders(c)).toBe(0); // an adult may have dropped it on purpose
  });

  it('starts every town with the §5.18 defaults for its seat', () => {
    expect(ORDER_DEFAULTS.map((o) => [o.kind, o.kid, o.adult])).toEqual([
      ['budgetHealthy', true, true],
      ['buyUtilities', true, true],
      ['fixDamaged', true, true],
      ['renewContracts', true, false],
      ['awayZoning', true, false],
      ['growthHelp', true, false],
      ['repayLoan', false, false],
      ['hold', false, false],
    ]);
  });
});
