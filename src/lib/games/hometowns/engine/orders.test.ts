// The Deputy's standing orders (spec §5.18): deterministic, logged to the
// inbox, bounded by their thresholds, switched off by Hold, and editable
// only as far as the seat's profile allows.

import { describe, expect, it } from 'vitest';
import { civicSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { kitTown, road } from '../../../../../scripts/hometowns/space-kit';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { applyCommand } from './commands';
import { ORDER_DEFAULTS } from './content';
import { monthlySpending } from './finance';
import { lineIndex, postWhole } from './core';
import { civicMemo, upkeepOf } from './finance';
import { stateHash } from './index';
import { AWAY_GREENS, MARKET_LOTS, renewsContracts } from './orders';
import { paramsFor } from './params';
import { B_KIND, CAT_ROAD, CAT_ZONE, MAP, planesForWrite, planesOf, tileIndex, useCat, usePayload, zoneUse } from './tiles';
import { BUILDINGS } from './content';
import { EngineError, FUNDING_KEYS, METER_SHOPS, Z_HOMES, Z_SHOPS, type StandingOrder } from './types';

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
    expect(t.undo.at(-1)!.planId).toBe(`deputy.${c.dayIndex}.schoolHouse`); // the same build plan as a mayor's move
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
    runMonths(c, i, 1, civicSteps(hold(30)));
    const p = planesOf(t);
    let lots = 0;
    for (let k = 0; k < MAP * MAP; k++) if (p.use[k] === zoneUse(Z_SHOPS)) lots++;
    // The Shops meter (30) is under the zoning order's 60, so every lot is the market's.
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
    bad(new Array(9).fill({ kind: 'hold', on: true, args: [] }), /up to 8/);
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

  it('starts every town with the §5.18 defaults for its seat', () => {
    expect(ORDER_DEFAULTS.map((o) => [o.kind, o.kid, o.adult])).toEqual([
      ['budgetHealthy', true, true],
      ['buyUtilities', true, true],
      ['fixDamaged', true, true],
      ['renewContracts', true, false],
      ['awayZoning', true, false],
      ['repayLoan', false, false],
      ['hold', false, false],
    ]);
  });
});
