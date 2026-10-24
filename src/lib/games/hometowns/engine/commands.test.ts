// Moves (spec §10.6): founding, the sprint, the atomic build plan, undo, the
// budget dials, idempotency (A28) and exact-tick application (A19).

import { describe, expect, it } from 'vitest';
import { foundAndSprint, newCounty } from '../../../../../scripts/hometowns/fixture';
import { nextRegionalDayAt } from './clock';
import { applyCommand } from './commands';
import { catchUp } from './county';
import { buildingIndex } from './content';
import { stateHash } from './index';
import { checkTown } from './invariants';
import { TOWN_HALL_AT } from './terrain';
import { CAT_BUILDING, CAT_ROAD, CAT_ZONE, planesOf, tileIndex, useCat } from './tiles';
import { EngineError, type Command, type CountyState } from './types';

function setup(site = 3) {
  const c = newCounty(5);
  const r = foundAndSprint(c, 'ann', site, c.epoch + 60_000);
  return { c, t: c.towns[r.index], now: r.now + 1000 };
}

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

const build = (c: CountyState, planId: string, plan: Extract<Command, { type: 'build' }>['plan'], now: number) => applyCommand(c, 'ann', { type: 'build', planId, plan }, now);

describe('found', () => {
  it('founds a town with its County Road, Town Hall and the A11 starting values', () => {
    const c = newCounty(2);
    applyCommand(c, 'ann', { type: 'found', site: 1, nameParts: ['Oak', 'ridge'], avatar: 'fox', flag: 2 }, c.epoch + 1);
    const t = c.towns[0];
    expect(t.name).toBe('Oakridge');
    expect(c.sites[1].owner).toBe('ann');
    const p = planesOf(t);
    expect(useCat(p.use[tileIndex(32, 63)])).toBe(CAT_ROAD);
    expect(useCat(p.use[tileIndex(...TOWN_HALL_AT)])).toBe(CAT_BUILDING);
    expect(t.buildings[0][0]).toBe(buildingIndex('townHall'));
    expect(t.money.reserves).toBe(100_000);
    expect(t.meters).toEqual([60, 0, 0, 40, 0, 20, 0, 40]);
    expect(t.sprintLeft).toBe(12);
    expect(checkTown(t)).toEqual([]);
  });

  it('refuses a taken site, a second town, a made-up name and an unknown site', () => {
    const c = newCounty(2);
    applyCommand(c, 'ann', { type: 'found', site: 1, nameParts: ['Oak', 'ridge'], avatar: 'fox', flag: 2 }, c.epoch + 1);
    refused(() => applyCommand(c, 'ben', { type: 'found', site: 1, nameParts: ['Elm', 'ford'], avatar: 'owl', flag: 1 }, c.epoch + 2), 409, /already built/);
    refused(() => applyCommand(c, 'ann', { type: 'found', site: 2, nameParts: ['Elm', 'ford'], avatar: 'owl', flag: 1 }, c.epoch + 3), 409, /already have/);
    refused(() => applyCommand(c, 'ben', { type: 'found', site: 2, nameParts: ['Zzz', 'ford'], avatar: 'owl', flag: 1 }, c.epoch + 4), 400);
    refused(() => applyCommand(c, 'ben', { type: 'found', site: 9, nameParts: ['Elm', 'ford'], avatar: 'owl', flag: 1 }, c.epoch + 5), 400);
    refused(() => applyCommand(c, 'ben', { type: 'found', site: 2, name: 'Typed', avatar: 'owl', flag: 1 }, c.epoch + 6), 400);
    applyCommand(c, 'ben', { type: 'found', site: 2, name: 'Little  Typing', nameAllowed: true, avatar: 'owl', flag: 1 }, c.epoch + 7);
    expect(c.towns[1].name).toBe('Little Typing');
  });
});

describe('sprint (§2.3)', () => {
  it('runs twelve tapped ticks at least 10 s apart, then joins the grid', () => {
    const c = newCounty(3);
    applyCommand(c, 'ann', { type: 'found', site: 0, nameParts: ['Fox', 'by'], avatar: 'fox', flag: 0 }, c.epoch + 1000);
    applyCommand(c, 'ann', { type: 'sprint', moveId: 's0' }, c.epoch + 2000);
    refused(() => applyCommand(c, 'ann', { type: 'sprint', moveId: 's1' }, c.epoch + 5000), 409, /few seconds/);
    let now = c.epoch + 2000;
    for (let i = 1; i < 12; i++) applyCommand(c, 'ann', { type: 'sprint', moveId: `s${i}` }, (now += 10_000));
    const t = c.towns[0];
    expect(t.tick).toBe(12);
    expect(t.sprintLeft).toBe(0);
    expect(t.gridBase).toBe(1 - 12);
    refused(() => applyCommand(c, 'ann', { type: 'sprint', moveId: 's12' }, now + 20_000), 409, /over/);
  });

  it('"Play it all" ticks every 15 s through catch-up, and unfinished sprints run at the Regional Day (A23)', () => {
    const c = newCounty(3);
    applyCommand(c, 'ann', { type: 'found', site: 0, nameParts: ['Fox', 'by'], avatar: 'fox', flag: 0 }, c.epoch + 1000);
    applyCommand(c, 'ann', { type: 'sprint', moveId: 'auto', auto: true }, c.epoch + 2000);
    catchUp(c, c.epoch + 2000 + 15_000 * 5, 1e9);
    expect(c.towns[0].tick).toBe(5);
    applyCommand(c, 'ben', { type: 'found', site: 1, nameParts: ['Elm', 'ford'], avatar: 'owl', flag: 1 }, c.epoch + 3000);
    catchUp(c, nextRegionalDayAt(c) + 1, 1e9);
    expect(c.towns[1].sprintLeft).toBe(0);
    expect(c.towns[1].gridBase).not.toBeNull();
  });
});

describe('build (§9.3, atomic)', () => {
  it('builds roads, zones and a building, charging each and recording one undo entry', () => {
    const { c, t, now } = setup(3); // site 3: not Hills, Forest or River in this county? cost checked per tile below
    const before = t.money.reserves;
    const r = build(c, 'p1', [
      { op: 'road', kind: 'lane', path: [32, 43, 32, 38, 28, 38] },
      { op: 'zone', zone: 'homes', rect: [28, 39, 4, 3] },
      { op: 'place', id: 'well', x: 30, y: 36, rot: 0 },
    ], now);
    expect(r.cost).toBeGreaterThan(0);
    expect(t.money.reserves).toBe(before - r.cost);
    const p = planesOf(t);
    expect(useCat(p.use[tileIndex(28, 38)])).toBe(CAT_ROAD);
    expect(useCat(p.use[tileIndex(29, 40)])).toBe(CAT_ZONE);
    expect(useCat(p.use[tileIndex(30, 36)])).toBe(CAT_BUILDING);
    expect(t.undo.map((u) => u.planId)).toEqual(['p1']);
    expect(t.construction.length).toBe(2); // the well is under construction
    expect(checkTown(t)).toEqual([]);
  });

  it('is atomic: one bad step leaves the town exactly as it was', () => {
    const { c, t, now } = setup();
    const h = stateHash(t);
    refused(() => build(c, 'bad', [
      { op: 'road', kind: 'lane', path: [32, 43, 32, 38] },
      { op: 'place', id: 'policeStation', x: 20, y: 20, rot: 0 }, // unlocks at Town
    ], now), 409, /unlocks at Town/);
    expect(stateHash(t)).toBe(h);
    refused(() => build(c, 'far', [{ op: 'road', kind: 'lane', path: [5, 5, 10, 5] }], now), 409, /locked land/);
    refused(() => build(c, 'bent', [{ op: 'road', kind: 'lane', path: [30, 30, 33, 33] }], now), 400, /straight/);
    refused(() => build(c, 'st', [{ op: 'road', kind: 'street', path: [30, 30, 30, 33] }], now), 409, /Village/);
    expect(stateHash(t)).toBe(h);
  });

  it('refuses a plan it cannot afford, and changes nothing', () => {
    const { c, t, now } = setup();
    const h = stateHash(t);
    const plan = Array.from({ length: 30 }, (_, i) => ({ op: 'place' as const, id: 'windmill', x: 16 + (i % 15), y: 16 + Math.floor(i / 15) * 2, rot: 0 as const }));
    refused(() => build(c, 'rich', plan, now), 409, /costs £[\d,]+ and you have £[\d,]+/);
    expect(stateHash(t)).toBe(h);
  });

  it('is idempotent by planId (A28): a repeat returns the first result and charges once', () => {
    const { c, t, now } = setup();
    const plan = [{ op: 'road' as const, kind: 'lane' as const, path: [32, 43, 32, 40] }];
    const a = build(c, 'same', plan, now);
    const reserves = t.money.reserves;
    const b = build(c, 'same', plan, now + 5);
    expect(b).toEqual({ ...a, replayed: true });
    expect(t.money.reserves).toBe(reserves);
  });

  it('bulldozes: a same-day road refunds half, the Town Hall and County Road stay', () => {
    const { c, t, now } = setup();
    build(c, 'r', [{ op: 'road', kind: 'lane', path: [32, 43, 32, 42] }], now);
    const reserves = t.money.reserves;
    build(c, 'd', [{ op: 'bulldoze', rect: [31, 42, 4, 4] }], now + 1);
    expect(t.money.reserves).toBe(reserves + 1500); // half of £1,500 for each of the two lane tiles built today
    const p = planesOf(t);
    expect(useCat(p.use[tileIndex(32, 42)])).toBe(0);
    expect(useCat(p.use[tileIndex(32, 44)])).toBe(CAT_ROAD); // County Road
    expect(useCat(p.use[tileIndex(...TOWN_HALL_AT)])).toBe(CAT_BUILDING);
  });

  it('opens a parcel only with a right, next to open land, for the survey fee', () => {
    const { c, t, now } = setup();
    refused(() => build(c, 'p', [{ op: 'parcel', p: 1 }], now), 409, /next promotion/);
    t.parcelRights = 1;
    refused(() => build(c, 'p2', [{ op: 'parcel', p: 0 }], now), 409, /next to/);
    const r = build(c, 'p3', [{ op: 'parcel', p: 1 }], now);
    expect(r.cost).toBe(5000);
    expect((t.parcels >> 1) & 1).toBe(1);
    expect(t.parcelRights).toBe(0);
  });
});

describe('undo', () => {
  it('refunds in full and restores the tiles while unchanged, only on the same day', () => {
    const { c, t, now } = setup();
    const h = stateHash({ ...t, money: { ...t.money, reserves: 0 }, books: { ...t.books, lines: [], dayLines: [] }, undo: [], tileLog: '', carry: {}, planesRev: 0 });
    const reserves = t.money.reserves;
    build(c, 'u', [{ op: 'road', kind: 'lane', path: [32, 43, 32, 39] }, { op: 'place', id: 'villageGreen', x: 31, y: 40, rot: 0 }, { op: 'zone', zone: 'homes', rect: [28, 39, 3, 3] }], now);
    applyCommand(c, 'ann', { type: 'undo', planId: 'u', moveId: 'undo-u' }, now + 10);
    expect(t.money.reserves).toBe(reserves);
    expect(stateHash({ ...t, money: { ...t.money, reserves: 0 }, books: { ...t.books, lines: [], dayLines: [] }, undo: [], tileLog: '', carry: {}, planesRev: 0 })).toBe(h);
    build(c, 'v', [{ op: 'road', kind: 'lane', path: [32, 43, 32, 41] }], now + 20);
    catchUp(c, nextRegionalDayAt(c) + 1, 1e9);
    refused(() => applyCommand(c, 'ann', { type: 'undo', planId: 'v', moveId: 'undo-v' }, nextRegionalDayAt(c) - 3_600_000 * 20), 409, /same day|day they were built/);
  });

  it('refuses when something has changed since', () => {
    const { c, now } = setup();
    build(c, 'a', [{ op: 'zone', zone: 'homes', rect: [28, 39, 2, 2] }], now);
    build(c, 'b', [{ op: 'dezone', rect: [28, 39, 1, 1] }], now + 1);
    refused(() => applyCommand(c, 'ann', { type: 'undo', planId: 'a', moveId: 'ua' }, now + 2), 409, /changed/);
  });
});

describe('budget (§5.13, tier-gated)', () => {
  it('a Hamlet has the one Town Tax dial; a kid steps in 0.5%, an adult in 0.1%', () => {
    const { c, t, now } = setup();
    applyCommand(c, 'ann', { type: 'budget', moveId: 'b1', taxes: { town: 1000 } }, now);
    expect(t.taxes.homes).toEqual([1000, 1000, 1000]);
    expect(t.taxes.business).toBe(500);
    refused(() => applyCommand(c, 'ann', { type: 'budget', moveId: 'b2', taxes: { homes: 900 } }, now), 409, /Village/);
    refused(() => applyCommand(c, 'ann', { type: 'budget', moveId: 'b3', taxes: { town: 2500 } }, now), 400, /between/);
    refused(() => applyCommand(c, { seat: 'ann', profile: 'kid' }, { type: 'budget', moveId: 'b4', taxes: { town: 830 } }, now), 400, /steps of 0.5%/);
    applyCommand(c, 'ann', { type: 'budget', moveId: 'b5', taxes: { town: 830 } }, now);
    applyCommand(c, 'ann', { type: 'budget', moveId: 'b6', funding: { fun: 2 } }, now);
    expect(t.funding.slice(4, 6)).toEqual([2, 2]);
    refused(() => applyCommand(c, 'ann', { type: 'budget', moveId: 'b7', funding: { police: 0 } }, now), 409, /Village/);
    t.tier = 2;
    applyCommand(c, 'ann', { type: 'budget', moveId: 'b8', taxes: { homes: [700, 800, 900], sales: 300 } }, now);
    expect(t.taxes.homes).toEqual([700, 800, 900]);
    refused(() => applyCommand(c, 'ann', { type: 'budget', moveId: 'b9', taxes: { hotel: 600 } }, now), 409, /City/);
  });
});

describe('exact ticks and the Regional Day guard (A19)', () => {
  it('catches the acting town up before applying, and stamps atTick', () => {
    const { c, t, now } = setup();
    const later = now + 5 * 1_800_000;
    const r = build(c, 'late', [{ op: 'zone', zone: 'farms', rect: [33, 40, 2, 2] }], later);
    expect(r.atTick).toBe(t.tick);
    expect(t.tick).toBe(16); // tick 12 is the first grid tick after the sprint, so 5 grid ticks reach 16
    expect(c.log.at(-1)!.atTick).toBe(r.atTick);
  });

  it('refuses a move with a retry flag while a Regional Day is due', () => {
    const { c } = setup();
    const R = nextRegionalDayAt(c);
    try {
      build(c, 'rd', [{ op: 'zone', zone: 'farms', rect: [33, 40, 2, 2] }], R + 1);
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as EngineError).status).toBe(409);
      expect((e as EngineError).retry).toBe(true);
    }
    catchUp(c, R + 1, 1e9);
    expect(build(c, 'rd', [{ op: 'zone', zone: 'farms', rect: [33, 40, 2, 2] }], R + 2).ok).toBe(true);
  });

  it('moves owned by packages that have not landed are refused politely', () => {
    const { c, now } = setup();
    // WP2d's moves (policy, orders, loan, bond) have landed; a WP3 move still waits.
    refused(() => applyCommand(c, 'ann', { type: 'vote', moveId: 'x', question: 'q', choice: 0 }, now), 400, /isn’t ready/);
    refused(() => applyCommand(c, 'zed', { type: 'build', planId: 'q', plan: [{ op: 'parcel', p: 1 }] }, now), 404);
  });
});
