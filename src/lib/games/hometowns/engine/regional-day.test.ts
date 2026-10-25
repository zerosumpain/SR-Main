// WP3 Regional Day integration (spec §8.3, §8.5, §8.7, A17, A20, A30, A31,
// A33): the step order and idempotency, conservation of people and money
// across a busy day, the commuter rule, contract and goods shortfall caps,
// offers lasting 8 Regional Days for a weekly player, leavers, holidays both
// ways, gifts and pranks that never hurt anyone, and the same county however
// the towns were caught up. The town economy is stubbed (region-kit) except
// in the last test, so only the county layer moves people and money.

import { describe, expect, it } from 'vitest';
import { linkAll, multiCounty, nextContext, openLink, rebook, runDay, STUB_ECONOMY, totalPeople } from '../../../../../scripts/hometowns/region-kit';
import { applyCommand } from './commands';
import { regionalDay } from './county';
import { gridTickAt, nextRegionalDayAt } from './clock';
import { civicMemo } from './finance';
import { countyHash } from './index';
import { checkCounty } from './invariants';
import { countyMedian, countyMoney, regionOf } from './region-state';
import { inviteRibbon } from './offers';
import { stepCloseBooks, stepDeliver, stepMoveMoney } from './regional-day';
import { STICKERS } from './social';
import { STEPS } from './steps';
import { catchUpTown } from './tick';
import type { CountyState } from './types';

/** The instant moves are made at: the last Regional Day (towns are caught up to it, so no tick runs). */
const at = (c: CountyState, now0: number) => (c.lastRegionalDayAt > now0 ? c.lastRegionalDayAt : now0);

function act(c: CountyState, now0: number, seat: string, cmd: Parameters<typeof applyCommand>[2]) {
  return applyCommand(c, seat, cmd, at(c, now0));
}

/** The id an offer move was given (ids are the town's serial numbers, never the move's own id). */
const offered = (r: ReturnType<typeof act>): string => String(r.data?.offer);

function people(c: CountyState, i: number): number {
  return c.towns[i].people.reduce((a, b) => a + b, 0);
}

describe('the Regional Day', () => {
  it('runs the §8.3 steps in order and is idempotent by dayIndex', () => {
    const { c } = multiCounty(2);
    const d = c.dayIndex;
    const r = runDay(c);
    expect(r.ran).toBe(true);
    expect(r.steps).toEqual(STEPS.regional.map((s) => s.id));
    expect(c.alerts.filter((a) => a.kind === 'regional-day')).toEqual([]);
    expect(c.dayIndex).toBe(d + 1);
    const h = countyHash(c);
    expect(regionalDay(c, d, { steps: STUB_ECONOMY }).ran).toBe(false);
    expect(countyHash(c)).toBe(h);
  });

  it('conserves people and money across the county through a busy day', () => {
    const { c, now } = multiCounty(3, 'town');
    linkAll(c);
    for (const t of c.towns) {
      civicMemo(t).revenue = 200_000;
      t.initiatives = 3;
      t.goodsStock = [500, 100];
      t.peopleMemo = { displaced: [0, 0, 0], young: [0, 0, 0], vacHigh: 0, needs: new Array(10).fill(0.8), vacancies: [120, 40, 5], unemployed: [90, 20, 2], jobs: [800, 200, 40] };
      t.marketMemo = { surplus: [0, 0], lowMonths: [0, 0, 0, 0, 0], sat: 60, visitors: 0, bedDemand: 0, attrQ: 25, pull: 20, shopAppeal: 35 };
    }
    c.towns[0].marketMemo!.surplus = [400, 50];
    c.towns[1].marketMemo!.surplus = [-250, -60];
    const money0 = countyMoney(c);
    const people0 = totalPeople(c);
    // The day's moves: coins, aid, an advert, a bus service, a contract.
    act(c, now, 's0', { type: 'gift', moveId: 'g1', to: 1, item: 'coins' });
    act(c, now, 's1', { type: 'aid', moveId: 'a1', to: 2, kind: 'coins', amount: 5000 });
    act(c, now, 's2', { type: 'aid', moveId: 'a2', to: 0, kind: 'goods', amount: 40 });
    act(c, now, 's2', { type: 'advert', moveId: 'ad', target: 0, cohort: 4 });
    // Towns 0 and 2 meet via Kingsport, so no signpost road is needed and the bus opens at once.
    const bus = offered(act(c, now, 's0', { type: 'link', moveId: 'bus', propose: { to: 2, kind: 'bus', share: 0.5 } }));
    act(c, now, 's2', { type: 'link', moveId: 'busYes', answer: { id: bus, yes: true } });
    const k = offered(act(c, now, 's0', { type: 'contract', moveId: 'k', offer: { to: 2, item: 'water', role: 'sell', amount: 50, price: 1, weeks: 1 } }));
    act(c, now, 's2', { type: 'contract', moveId: 'kYes', answer: { id: k, yes: true } });
    // The money a move pays is held, so the county total does not change.
    expect(countyMoney(c)).toBe(money0);
    // What the towns realised today (WP2b/c would write these).
    const n = 3;
    for (let i = 0; i < n; i++) {
      const acc = new Array<number>(n * 10).fill(0);
      acc[((i + 1) % n) * 10 + 0] = 30 + 7 * i;
      acc[((i + 2) % n) * 10 + 4] = 12.5;
      c.towns[i].realised.intents = acc;
      c.towns[i].realised.commutersIn = [40, 5, 0];
    }
    regionOf(c).commute[(0 * 6 + 1) * 3] = 20;
    regionOf(c).commute[(2 * 6 + 1) * 3] = 20;
    const each0 = c.towns.map((_, i) => people(c, i));
    runDay(c);
    const moved = c.towns.some((_, i) => people(c, i) !== each0[i]);
    expect(totalPeople(c)).toBe(people0);
    expect(countyMoney(c)).toBe(money0);
    // A second day with the contract running and allocations fixed.
    runDay(c);
    expect(totalPeople(c)).toBe(people0);
    expect(countyMoney(c)).toBe(money0);
    expect(c.alerts.filter((a) => a.kind === 'regional-day')).toEqual([]);
    expect(checkCounty(c)).toEqual([]);
    // Something did happen: people moved between players, goods were allocated, the bus runs.
    expect(moved).toBe(true);
    expect(c.allocations.length).toBeGreaterThan(0);
    expect(c.links.some((l) => l.kind === 'bus' && l.state === 'open')).toBe(true);
  });

  it('pays the commuter rule from the work town to the home towns for commuters who worked', () => {
    const { c } = multiCounty(3);
    linkAll(c);
    const g = regionOf(c);
    // Yesterday's pairs: 30 from town 0 and 10 from town 2 to work in town 1 (£ tier).
    g.commute[(0 * 6 + 1) * 3] = 30;
    g.commute[(2 * 6 + 1) * 3] = 10;
    c.towns[1].realised.commutersIn = [400, 0, 0];
    const before = c.towns.map((t) => t.money.reserves);
    runDay(c);
    const d = c.towns.map((t, i) => t.money.reserves - before[i]);
    // Fair share: £15 per commuter-month, split 3:1.
    expect(d[1]).toBe(-15 * 400);
    expect(d[0]).toBe(15 * 300);
    expect(d[2]).toBe(15 * 100);
  });

  it('settles a contract: payment for what was delivered, and a shortfall penalty capped at a week of its value (A17)', () => {
    const { c, now } = multiCounty(2, 'town');
    openLink(c, 0, 1);
    const k = offered(act(c, now, 's0', { type: 'contract', moveId: 'k', offer: { to: 1, item: 'power', role: 'sell', amount: 10, price: 2, weeks: 2 } }));
    act(c, now, 's1', { type: 'contract', moveId: 'y', answer: { id: k, yes: true } });
    runDay(c);
    expect(c.contracts).toHaveLength(1);
    expect(c.snapshot.contracts).toHaveLength(1);
    // Today the seller delivered 300 units and fell 10,000 short.
    c.towns[0].realised.delivered = [300];
    c.towns[0].realised.shortfall = [10_000];
    const before = c.towns.map((t) => t.money.reserves);
    runDay(c);
    const cap = 10 * 2 * 7 * 12;
    const penalty = Math.min((4 - 2) * 10_000, cap);
    expect(c.towns[0].money.reserves - before[0]).toBe(600 - penalty);
    expect(c.towns[1].money.reserves - before[1]).toBe(-600 + penalty);
  });

  it('charges a goods seller that fell short at most 10% of the allocation’s value (A17)', () => {
    const { c } = multiCounty(2);
    openLink(c, 0, 1);
    c.snapshot.allocations = [{ good: 'goods', seller: 0, buyer: 1, units: 100, price: 950 }];
    c.towns[0].realised.shipped = [0];
    const before = c.towns[0].money.reserves;
    const k0 = c.kingsport.treasuryOut;
    runDay(c);
    const months = 12;
    const paid = before - c.towns[0].money.reserves;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(Math.round(0.1 * 100 * 950 * months) + 1);
    expect(c.kingsport.treasuryOut).toBe(k0 - paid);
  });
});

describe('offers last 8 Regional Days (A30)', () => {
  it('lets a weekly player answer a week later, and refunds an offer nobody answered', () => {
    const { c, now } = multiCounty(3, 'town');
    const r0 = c.towns.map((t) => t.money.reserves);
    const a = offered(act(c, now, 's0', { type: 'link', moveId: 'a', propose: { to: 2, kind: 'road', share: 0.5 } }));
    const b = offered(act(c, now, 's1', { type: 'link', moveId: 'b', propose: { to: 2, kind: 'road', share: 1 } }));
    expect(c.towns[0].money.reserves).toBe(r0[0] - 20_000);
    expect(c.towns[1].money.reserves).toBe(r0[1] - 40_000);
    for (let d = 0; d < 7; d++) {
      runDay(c);
      act(c, now, 's2', { type: 'hello' });
    }
    // Seven Regional Days later the weekly player opens the app and accepts one of them.
    expect(c.offers).toHaveLength(2);
    act(c, now, 's2', { type: 'link', moveId: 'yes', answer: { id: a, yes: true } });
    runDay(c);
    // Town 0 and town 2 are not ring neighbours, so the link opens at once via Kingsport.
    const l = c.links.find((x) => x.id === a)!;
    expect(l.state).toBe('open');
    // The other offer had its 8th Regional Day unanswered: it lapsed and the proposer got everything back.
    expect(c.offers).toHaveLength(0);
    expect(c.links.find((x) => x.id === b)).toBeUndefined();
    expect(c.towns[1].money.reserves).toBe(r0[1]);
    expect(c.towns[2].money.reserves).toBe(r0[2] - 20_000);
    // An answer after the 8th Regional Day is refused.
    const late = offered(act(c, now, 's0', { type: 'link', moveId: 'c', propose: { to: 1, kind: 'road', share: 0.5 } }));
    for (let d = 0; d < 8; d++) runDay(c);
    expect(() => act(c, now, 's1', { type: 'link', moveId: 'late', answer: { id: late, yes: true } })).toThrow(/no longer open|run out/);
  });
});

describe('A20: cross-town effects wait for the Regional Day, and never hurt', () => {
  it('a gift reaches nobody until the Regional Day', () => {
    const { c, now } = multiCounty(2, 'town');
    civicMemo(c.towns[0]).revenue = 300_000;
    const target = JSON.stringify(c.towns[1]);
    act(c, now, 's0', { type: 'gift', moveId: 'g', to: 1, item: 'coins' });
    expect(JSON.stringify(c.towns[1])).toBe(target);
    expect(() => act(c, now, 's0', { type: 'gift', moveId: 'g2', to: 1, item: 'tree' })).toThrow(/One gift a day/);
    const before = c.towns[1].money.reserves;
    runDay(c);
    expect(c.towns[1].money.reserves - before).toBe(3000);
    expect(c.towns[1].inbox.some((x) => x.kind === 'gift' && x.data.item === 'coins')).toBe(true);
  });

  it('a prank changes nothing but the inbox', () => {
    const a = multiCounty(2, 'town');
    const b = multiCounty(2, 'town');
    for (const x of [a, b]) linkAll(x.c);
    act(b.c, b.now, 's0', { type: 'prank', moveId: 'p', to: 1, kind: 'seagulls' });
    runDay(a.c);
    runDay(b.c);
    const strip = (c: CountyState) => JSON.stringify({ ...c.towns[1], inbox: [] });
    expect(strip(b.c)).toBe(strip(a.c));
    expect(JSON.stringify(b.c.flows)).toBe(JSON.stringify(a.c.flows));
    expect(b.c.towns[1].inbox.some((x) => x.kind === 'prank')).toBe(true);
    expect(() => act(b.c, b.now, 's0', { type: 'prank', moveId: 'p2', to: 1, kind: 'duck' })).toThrow(/One prank a week/);
  });

  it('an advert reaches its target’s movers the day after, for 3 days', () => {
    const { c, now } = multiCounty(2, 'town');
    linkAll(c);
    c.towns[0].initiatives = 2;
    act(c, now, 's0', { type: 'advert', moveId: 'ad', target: 1, cohort: 4 });
    expect(c.towns[1].inbox.some((x) => x.kind === 'billboard')).toBe(false);
    runDay(c);
    expect(c.towns[1].inbox.some((x) => x.kind === 'billboard')).toBe(true);
    expect(c.flows.towns[1].advert[4]).toBeGreaterThan(0);
    // Bit 0: town 0's advert.
    expect(c.flows.towns[1].advertBy?.[4]).toBe(1);
    runDay(c);
    runDay(c);
    expect(c.flows.towns[1].advert[4]).toBeGreaterThan(0);
    runDay(c);
    expect(c.flows.towns[1].advert[4]).toBe(0);
  });
});

describe('caps on friendly moves (§8.12)', () => {
  it('aid is at most a tenth of reserves; an advert needs an Initiative and runs once a week per pair (Friendly)', () => {
    const { c, now } = multiCounty(2, 'town');
    const most = Math.floor(0.1 * c.towns[0].money.reserves);
    expect(() => act(c, now, 's0', { type: 'aid', moveId: 'a', to: 1, kind: 'coins', amount: most + 1 })).toThrow(/up to/);
    act(c, now, 's0', { type: 'aid', moveId: 'b', to: 1, kind: 'coins', amount: most });
    c.towns[0].initiatives = 0;
    expect(() => act(c, now, 's0', { type: 'advert', moveId: 'c', target: 1, cohort: 0 })).toThrow(/Initiative/);
    c.towns[0].initiatives = 3;
    act(c, now, 's0', { type: 'advert', moveId: 'd', target: 1, cohort: 0 });
    expect(() => act(c, now, 's0', { type: 'advert', moveId: 'e', target: 1, cohort: 0 })).toThrow(/once/);
  });

  it('a parent can switch pranks off for a child', () => {
    const { c, now } = multiCounty(2);
    c.settings.perSeat.s1.pranks = false;
    expect(() => act(c, now, 's0', { type: 'prank', moveId: 'p', to: 1, kind: 'duck' })).toThrow(/switched off/);
  });

  it('guestbook stamps add Buzz the day after, capped', () => {
    const { c, now } = multiCounty(5);
    for (const s of ['s0', 's1', 's2', 's3']) act(c, now, s, { type: 'stamp', moveId: 'st', seat: 's4', sticker: 'star' });
    expect(() => act(c, now, 's0', { type: 'stamp', moveId: 'st2', seat: 's4', sticker: 'heart' })).toThrow(/today/);
    expect(c.flows.towns[4].buzz).toBe(0);
    runDay(c);
    expect(c.flows.towns[4].buzz).toBe(2);
    expect(c.towns[4].stamps).toHaveLength(4);
  });
});

describe('holiday freezes migration both ways (A31)', () => {
  function intents(c: CountyState, i: number, j: number, x: number) {
    const acc = c.towns[i].realised.intents ?? new Array<number>(c.towns.length * 10).fill(0);
    acc[j * 10] += x;
    c.towns[i].realised.intents = acc;
  }

  it('nobody leaves for, or arrives from, players while a town is on holiday; it ends on request or on a build', () => {
    const { c, now } = multiCounty(2, 'town');
    linkAll(c);
    act(c, now, 's0', { type: 'holiday', moveId: 'h', days: 3 });
    const p = [people(c, 0), people(c, 1)];
    intents(c, 0, 1, 25);
    runDay(c);
    intents(c, 1, 0, 25);
    runDay(c);
    expect([people(c, 0), people(c, 1)]).toEqual(p);
    act(c, now, 's0', { type: 'holiday', moveId: 'h2', end: true });
    intents(c, 1, 0, 25);
    runDay(c);
    expect(people(c, 0)).toBeGreaterThan(p[0]);
    // A build ends a holiday at the next Regional Day.
    act(c, now, 's1', { type: 'holiday', moveId: 'h3', days: 5 });
    expect(c.towns[1].holiday.until).not.toBeNull();
    c.log.push({ id: 'b', seat: 's1', type: 'build', at: at(c, now) + 1, atTick: c.towns[1].tick, cmd: { type: 'build', planId: 'b', plan: [] }, result: { ok: true, atTick: 0, cost: 0 } });
    runDay(c);
    expect(c.towns[1].holiday.until).toBeNull();
    // At most 21 days a season.
    expect(() => act(c, now, 's1', { type: 'holiday', moveId: 'h4', days: 17 })).toThrow(/days left/);
  });
});

describe('leaving (A33)', () => {
  it('settles an archived town at the next Regional Day: links, contracts, pacts, offers and intents go; everything else carries on', () => {
    const { c, now } = multiCounty(3, 'town');
    linkAll(c);
    const k = offered(act(c, now, 's0', { type: 'contract', moveId: 'k', offer: { to: 1, item: 'water', role: 'sell', amount: 10, price: 1, weeks: 4 } }));
    act(c, now, 's1', { type: 'contract', moveId: 'y', answer: { id: k, yes: true } });
    act(c, now, 's2', { type: 'link', moveId: 'bus', propose: { to: 1, kind: 'bus', share: 0.5 } });
    runDay(c);
    c.pacts.push({ id: 'p', kind: 'trail', a: 1, b: 2, sinceDay: 0 });
    const money0 = countyMoney(c);
    const people0 = totalPeople(c);
    // Mayor 1 leaves: the adapter freezes their town at once.
    c.towns[1].archived = true;
    const acc = new Array<number>(30).fill(0);
    acc[1 * 10] = 50;
    c.towns[0].realised.intents = acc;
    runDay(c);
    const t = c.towns[1];
    expect(t.name).toBe('Old Town1');
    expect(c.links.some((l) => l.a === 1 || l.b === 1)).toBe(false);
    expect(c.links.some((l) => l.a === 0 && l.b === 2)).toBe(true);
    expect(c.contracts).toEqual([]);
    expect(c.pacts).toEqual([]);
    expect(c.offers.some((o) => o.from === 1 || o.to === 1)).toBe(false);
    expect(t.inbox).toEqual([]);
    expect(t.initiatives).toBe(0);
    // Nobody moved to the archived town, the bus offer's escrow came home, and its site stays occupied.
    expect(totalPeople(c)).toBe(people0);
    expect(countyMoney(c)).toBe(money0);
    expect(regionOf(c).held).toBe(0);
    expect(c.sites[t.site].owner).toBe('s1');
    // It no longer counts toward the median or the Council.
    const pops = [0, 2].map((i) => people(c, i)).sort((a, b) => a - b);
    expect(countyMedian(c)).toBe((pops[0] + pops[1]) / 2);
    // Moves aimed at it are refused.
    expect(() => act(c, now, 's0', { type: 'gift', moveId: 'g', to: 1, item: 'tree' })).toThrow(/resting/);
  });
});

describe('order independence', () => {
  it('gives the same county however the towns were caught up before the Regional Day (real economy)', () => {
    const a = multiCounty(3);
    linkAll(a.c);
    const b = JSON.parse(JSON.stringify(a.c)) as CountyState;
    const R = nextRegionalDayAt(a.c);
    const g = gridTickAt(a.c, R);
    for (const i of [0, 1, 2]) catchUpTown(a.c, i, g);
    for (const i of [2, 0, 1]) catchUpTown(b, i, g);
    regionalDay(a.c, a.c.dayIndex);
    regionalDay(b, b.dayIndex);
    expect(countyHash(b)).toBe(countyHash(a.c));
    expect(a.c.alerts.filter((x) => x.kind === 'regional-day')).toEqual([]);
  });
});

describe('links between ring neighbours', () => {
  it('wait until each side’s road reaches its facing signpost', () => {
    const { c, now } = multiCounty(2, 'town');
    const r = offered(act(c, now, 's0', { type: 'link', moveId: 'r', propose: { to: 1, kind: 'road', share: 0.5 } }));
    act(c, now, 's1', { type: 'link', moveId: 'y', answer: { id: r, yes: true } });
    runDay(c);
    // Built and paid for, but the fixture towns have no road to their west and east signposts.
    expect(c.links[0].state).toBe('waiting');
    expect(c.links[0].paid).toEqual([20_000, 20_000]);
    expect(c.snapshot.towns[0].linkTimes[1]).toBe(-1);
  });
});

describe('late joiners (§8.12)', () => {
  it('top up a mayor joining a mature county with a quarter of the median reserves, from Kingsport, once', () => {
    const { c, now } = multiCounty(2, 'town');
    for (let d = 0; d < 7; d++) runDay(c);
    const t0 = c.lastRegionalDayAt > now ? c.lastRegionalDayAt : now;
    applyCommand(c, 'late', { type: 'found', site: 2, nameParts: ['Sunny', 'vale'], avatar: 'badger', flag: 1 }, t0);
    const i = c.towns.length - 1;
    const start = c.towns[i].money.reserves;
    const med = (c.towns[0].money.reserves + c.towns[1].money.reserves) / 2;
    const money0 = countyMoney(c);
    runDay(c);
    const grant = Math.round(Math.min(200_000, 0.25 * med));
    expect(c.towns[i].money.reserves - start).toBe(grant);
    expect(countyMoney(c)).toBe(money0);
    // The 21-day Fresh Town grace started at founding.
    expect(c.towns[i].grace).not.toBeNull();
    runDay(c);
    expect(c.towns[i].money.reserves - start).toBe(grant);
  });
});

describe('pacts and friendship (§8.7)', () => {
  it('a Tourist Trail starts when answered, dissolves a week after notice; Twin Towns need 4 friendship weeks', () => {
    const { c, now } = multiCounty(2, 'town');
    linkAll(c);
    expect(() => act(c, now, 's0', { type: 'pact', moveId: 't', propose: { to: 1, kind: 'twin' } })).toThrow(/friendship weeks/);
    const trail = offered(act(c, now, 's0', { type: 'pact', moveId: 'p', propose: { to: 1, kind: 'trail' } }));
    act(c, now, 's1', { type: 'pact', moveId: 'y', answer: { id: trail, yes: true } });
    expect(c.pacts).toEqual([]);
    runDay(c);
    expect(c.pacts).toHaveLength(1);
    act(c, now, 's1', { type: 'pact', moveId: 'end', end: { id: trail } });
    // It runs for 7 more full days after the notice, then dissolves.
    for (let d = 0; d < 7; d++) runDay(c);
    expect(c.pacts).toHaveLength(1);
    runDay(c);
    expect(c.pacts).toEqual([]);
  });

  it('counts a friendship week for each pair in contact during a County Week', () => {
    const { c, now } = multiCounty(3, 'town');
    act(c, now, 's0', { type: 'gift', moveId: 'g', to: 2, item: 'thankYou' });
    while (c.awards.week === 0) runDay(c);
    expect(c.friendship[0 * 6 + 2]).toBe(1);
    expect(c.friendship[2 * 6 + 0]).toBe(1);
    expect(c.friendship[0 * 6 + 1]).toBe(0);
  });
});

describe('what each town is owed, and only that', () => {
  /** The same county twice: one to change, one to compare against. */
  const twin = (c: CountyState) => JSON.parse(JSON.stringify(c)) as CountyState;

  it('counts kind acts as they land: gifts, aid and stamps sent, and a ribbon cutting attended', () => {
    const { c, now } = multiCounty(3, 'town');
    linkAll(c);
    const g = regionOf(c);
    const before = g.week.map((w) => w.kind);
    act(c, now, 's0', { type: 'gift', moveId: 'g', to: 1, item: 'tree' });
    act(c, now, 's0', { type: 'stamp', moveId: 's', seat: 's2', sticker: 'star' });
    inviteRibbon(c, 1, c.dayIndex, 'park');
    act(c, now, 's0', { type: 'attend', moveId: 'r', ribbonId: c.offers.find((o) => o.kind === 'ribbon' && o.to === 0)!.id });
    // Steps 1, 2 and 6 by hand, so no County Week can reset the counters before they are read.
    const r = nextContext(c);
    stepCloseBooks(c, r);
    stepMoveMoney(c, r);
    stepDeliver(c, r);
    expect(g.week.map((w, i) => w.kind - before[i])).toEqual([3, 0, 0]);
  });

  it('charges each shared-places agreement for its own places, and nothing before it starts', () => {
    const { c } = multiCounty(4, 'town');
    linkAll(c);
    runDay(c);
    const day = c.dayIndex;
    const share = (id: string, provider: number, startDay: number) => ({ id, service: 'health' as const, provider, user: 0, places: 10, price: 100, startDay, endDay: null, used: 10 });
    const withShares = twin(c);
    regionOf(withShares).shares = [share('a', 1, day - 1), share('b', 2, day - 1), share('c', 3, day + 1)];
    const without = twin(c);
    runDay(withShares);
    runDay(without);
    const gain = (i: number) => withShares.towns[i].money.reserves - without.towns[i].money.reserves;
    // Each provider is paid for its own 10 places a month, a whole number of months; the user pays exactly that.
    expect(gain(1)).toBeGreaterThan(0);
    expect(gain(1) % (100 * 10)).toBe(0);
    expect(gain(2)).toBe(gain(1));
    expect(gain(0)).toBe(-(gain(1) + gain(2)));
    // Not started yet: nothing paid.
    expect(gain(3)).toBe(0);
    // Step 4 fixed each agreement's places for tomorrow, adding up to what the user gets, within its cap.
    const g = regionOf(withShares);
    const started = g.shares.filter((s) => s.startDay <= withShares.dayIndex);
    const sum = started.reduce((a, s) => a + (s.used ?? 0), 0);
    expect(sum).toBeCloseTo(withShares.flows.towns[0].sharedHealth, 9);
  });

  it('gives every town advertising to the same cohort its bonus, whatever order the moves came in', () => {
    const run = (order: number[]) => {
      const { c, now } = multiCounty(3, 'town');
      linkAll(c);
      for (const t of c.towns) {
        t.initiatives = 3;
        t.money.reserves = 1_000_000;
      }
      rebook(c);
      const moves = [
        () => act(c, now, 's0', { type: 'gift', moveId: 'g0', to: 2, item: 'tree' }),
        () => act(c, now, 's1', { type: 'gift', moveId: 'g1', to: 2, item: 'bench' }),
        () => act(c, now, 's0', { type: 'advert', moveId: 'a0', target: 2, cohort: 1 }),
        () => act(c, now, 's1', { type: 'advert', moveId: 'a1', target: 2, cohort: 1 }),
      ];
      for (const k of order) moves[k]();
      runDay(c);
      return c;
    };
    const a = run([0, 1, 2, 3]);
    const b = run([1, 0, 3, 2]);
    expect(a.flows.towns[2].advertBy?.[1]).toBe(0b11);
    expect(regionOf(a).campaigns.map((x) => x.from)).toEqual([0, 1]);
    // The log keeps the order moves arrived in; nothing else does.
    expect(JSON.stringify({ towns: a.towns, flows: a.flows, region: a.region })).toBe(JSON.stringify({ towns: b.towns, flows: b.flows, region: b.region }));
  });

  it('ends a contract for good when a mayor ends it, even if both standing orders renew contracts', () => {
    const { c, now } = multiCounty(2, 'town');
    linkAll(c);
    for (const t of c.towns) t.orders = [...t.orders.filter((o) => o.kind !== 'renewContracts' && o.kind !== 'hold'), { kind: 'renewContracts', on: true, args: [] }];
    const k = offered(act(c, now, 's0', { type: 'contract', moveId: 'k', offer: { to: 1, item: 'water', role: 'sell', amount: 10, price: 1, weeks: 1 } }));
    act(c, now, 's1', { type: 'contract', moveId: 'y', answer: { id: k, yes: true } });
    runDay(c);
    expect(c.contracts.map((x) => x.id)).toEqual([k]);
    act(c, now, 's1', { type: 'contract', moveId: 'end', end: { id: k } });
    runDay(c);
    runDay(c);
    expect(c.contracts).toEqual([]);
  });

  it('charges no goods shortfall for a buyer who has left, and refunds an advert whose target left', () => {
    const { c, now } = multiCounty(3, 'town');
    linkAll(c);
    runDay(c);
    c.towns[0].initiatives = 2;
    act(c, now, 's0', { type: 'advert', moveId: 'ad', target: 1, cohort: 2 });
    const owed = twin(c);
    owed.snapshot.allocations = [{ good: 'goods', seller: 0, buyer: 2, units: 500, price: 1 }];
    const gone = twin(owed);
    gone.towns[2].archived = true;
    gone.towns[1].archived = true;
    const base = twin(c);
    const plain = twin(c);
    plain.towns[2].archived = true;
    plain.towns[1].archived = true;
    regionOf(plain).outbox = [];
    plain.towns[0].money.reserves = gone.towns[0].money.reserves + regionOf(gone).held;
    regionOf(plain).held = 0;
    for (const x of [owed, base, gone, plain]) runDay(x);
    // Shipping nothing to a buyer still playing is charged; to one who has left, it is not, and the advert's fee came home.
    expect(owed.kingsport.treasuryOut).toBeLessThan(base.kingsport.treasuryOut);
    expect(gone.kingsport.treasuryOut).toBe(plain.kingsport.treasuryOut);
    expect(gone.towns[0].money.reserves).toBe(plain.towns[0].money.reserves);
    expect(regionOf(gone).held).toBe(0);
  });

  it('gives every inbox item its own id, even once the inbox is full', () => {
    const { c, now } = multiCounty(3, 'town');
    const t = c.towns[1];
    for (let x = 0; x < 40; x++) t.inbox.push({ id: `old.${x}`, kind: 'old', day: 0, from: null, data: {} });
    act(c, now, 's0', { type: 'prank', moveId: 'p', to: 1, kind: 'duck' });
    act(c, now, 's2', { type: 'prank', moveId: 'p', to: 1, kind: 'seagulls' });
    runDay(c);
    const ids = t.inbox.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pranks = t.inbox.filter((x) => x.kind === 'prank');
    expect(pranks).toHaveLength(2);
    for (const p of pranks) act(c, now, 's1', { type: 'prankReply', moveId: `r${p.from}`, id: p.id, choice: 'keep' });
    expect(pranks.map((p) => p.data.reply)).toEqual(['keep', 'keep']);
  });

  it('carries no typed text to another town: stickers are preset, ids are the town’s own', () => {
    const { c, now } = multiCounty(2, 'town');
    expect(() => act(c, now, 's0', { type: 'stamp', moveId: 's', seat: 's1', sticker: 'you smell' })).toThrow(/sticker/);
    expect(() => act(c, now, 's0', { type: 'gift', moveId: 'hello you smell', to: 1, item: 'tree' })).toThrow(/id/);
    act(c, now, 's0', { type: 'stamp', moveId: 'YouSmell', seat: 's1', sticker: STICKERS[0] });
    act(c, now, 's0', { type: 'gift', moveId: 'YouSmell2', to: 1, item: 'tree' });
    expect(JSON.stringify(regionOf(c).outbox)).not.toContain('YouSmell');
    runDay(c);
    expect(JSON.stringify(c.towns[1])).not.toContain('YouSmell');
  });
});
