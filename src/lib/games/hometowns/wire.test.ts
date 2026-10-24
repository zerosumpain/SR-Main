// What one phone sees of a county (WP4, spec §10.7, §10.8): redaction,
// deltas that merge to exactly the whole frame, the frame budgets and the
// room-size budget. Sizes are measured on the hand-built fixtures after real
// catch-up, so the records (Why, history, tile log) are filled as play fills
// them; no balance number is asserted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '../../../../scripts/hometowns/fixture';
import { createRoom, moves, start, join, type Room } from './hometowns';
import { DELTA_BUDGET, FIRST_FRAME_BUDGET, applyFrame, toWire } from './wire';
import { catchUp, countyMonth, gridTickAt, snapshotOf, stateHash, type CountyState, type TownState } from './engine/index';
import { COHORT_COUNT } from './engine/types';
import type { HometownsWire, PublicTown } from './engine/wire';

const T0 = 1_792_497_600_000;
const DAY = 86_400_000;
const host = { id: 'p_host', name: 'Host' };
const kid = { id: 'p_kid', name: 'Kid' };
const gran = { id: 'p_gran', name: 'Gran' };

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const bytes = (x: unknown): number => JSON.stringify(x).length;
const frame = (room: Room, who: string, now: number, since: number | null = null): HometownsWire => copy(toWire(room, who, now, since));

function play(room: Room, who: string, action: string, body: Record<string, unknown>, now: number): void {
  moves[action](room, who, { action, ...body }, now);
}

function foundAndSprint(room: Room, who: string, site: number, now: number): number {
  play(room, who, 'found', { site, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: site, moveId: `${who}-f` }, now);
  for (let k = 0; k < 12; k++) play(room, who, 'sprint', { moveId: `${who}-s${k}` }, (now += 10_000));
  return now;
}

/** Three mayors on the dev clock, each with a town on the grid. */
function threeTowns(): { room: Room; now: number } {
  const room = createRoom({ id: 'g_00000000000a', host, invite: [kid, gran], difficulty: 'easy', options: { county: { devTickMs: 30_000, seed: 11 } }, now: T0 });
  join(room, kid.id, T0);
  join(room, gran.id, T0);
  start(room, host.id, T0);
  let now = foundAndSprint(room, host.id, 0, T0 + 1000);
  now = foundAndSprint(room, kid.id, 1, now);
  now = foundAndSprint(room, gran.id, 2, now);
  return { room, now };
}

/**
 * A running room around a county built elsewhere (a fixture), its towns
 * seated s1… in order, the first one the host's.
 */
function roomAround(c: CountyState): Room {
  const room = createRoom({ id: 'g_00000000000b', host, invite: [], difficulty: 'easy', options: { county: { seed: c.seed } }, now: c.epoch });
  room.phase = 'running';
  room.county = c;
  room.daySeen = c.dayIndex;
  c.parents = [];
  c.settings.perSeat = {};
  c.towns.forEach((t, i) => {
    const id = i === 0 ? host.id : `p_${i}`;
    if (i > 0) room.players.push({ id, name: `Mayor ${i}`, status: 'joined', seat: null });
    room.players[i].seat = t.seat;
    c.settings.perSeat[t.seat] = { profile: 'adult', pushes: true, pranks: true, answerOnly: false, assist: 'none' };
    c.parents.push(t.seat);
  });
  return room;
}

/** The metropolis fixture after `days` of real catch-up, seated as s1. */
function playedMetropolis(days: number): { c: CountyState; now: number } {
  const f = fixture('metropolis');
  const c = f.county;
  const t = c.towns[f.town];
  for (const s of c.sites) if (s.owner === t.seat) s.owner = 's1';
  t.seat = 's1';
  t.ownerId = 's1';
  c.settings.youngestOrder = ['s1'];
  const now = f.now + days * DAY;
  catchUp(c, now, 1e9);
  return { c, now };
}

let six: string | null = null;

/** Six copies of a played metropolis in one county: the §10.8 worst case (built once, a fresh copy each call). */
function sixMetropolises(): { c: CountyState; now: number } {
  six ??= JSON.stringify(buildSix());
  return JSON.parse(six) as { c: CountyState; now: number };
}

function buildSix(): { c: CountyState; now: number } {
  const { c, now } = playedMetropolis(2);
  const base = c.towns[0];
  c.towns = [0, 1, 2, 3, 4, 5].map((i) => {
    const t = copy(base) as TownState;
    t.seat = `s${i + 1}`;
    t.ownerId = t.seat;
    t.site = i;
    t.name = `Town ${i + 1}`;
    return t;
  });
  c.sites.forEach((s, i) => (s.owner = `s${i + 1}`));
  const n = 6;
  c.ledger = new Array<number>(n * n * COHORT_COUNT).fill(0);
  c.flows.towns = c.towns.map(() => copy(c.flows.towns[0]));
  c.bulletin = c.towns.map(() => []);
  c.council.votes = c.towns.map(() => null);
  c.awards.dry = c.towns.map(() => 0);
  c.settings.youngestOrder = c.towns.map((t) => t.seat);
  c.snapshot = snapshotOf(c, c.lastRegionalDayAt, countyMonth(gridTickAt(c, now)));
  // A full command log: 150 twelve-op build plans with phone-made ids, the ring's size.
  const plan = Array.from({ length: 12 }, (_, k) => ({ op: 'road' as const, kind: 'street' as const, path: [10 + k, 20, 10 + k, 30, 20 + k, 30] }));
  c.log = Array.from({ length: 150 }, (_, k) => {
    const id = `3f6c1e2a-9b7d-4c1e-8f2a-${String(k).padStart(12, '0')}`;
    return {
      id,
      seat: `s${(k % 6) + 1}`,
      type: 'build' as const,
      at: now - k * 60_000,
      atTick: c.towns[0].tick,
      cmd: { type: 'build' as const, planId: id, plan },
      result: { ok: true as const, atTick: c.towns[0].tick, cost: 48_000 },
    };
  });
  return { c, now };
}

const PUBLIC_KEYS = new Set(['seat', 'name', 'avatar', 'flag', 'tier', 'pop', 'faces', 'stars', 'taxes', 'holiday', 'archived', 'inFortnight', 'skyline', 'mayor', 'linked']);
const PRIVATE = ['"reserves"', '"bonds"', '"loan"', '"orders"', '"books"', '"funding"', '"policies"', '"inbox"', '"undo"'];

beforeEach(() => {
  process.env.HOMETOWNS_DEV_CLOCK = '1';
});
afterEach(() => {
  delete process.env.HOMETOWNS_DEV_CLOCK;
});

describe('redaction', () => {
  it('gives a viewer their own town whole and every other town only its public card', () => {
    const { room, now } = threeTowns();
    const c = room.county;
    c.offers.push({ id: 'o1', kind: 'link', from: 1, to: 2, body: {}, madeDay: 0, expiresDay: 8 });
    c.offers.push({ id: 'o2', kind: 'link', from: 0, to: 1, body: {}, madeDay: 0, expiresDay: 8 });
    c.contracts.push({ id: 'k1', kind: 'water', seller: 1, buyer: 2, amount: 10, price: 2, startDay: 0, endDay: null, renew: true });
    play(room, host.id, 'visit', { seat: 's2' }, now + 1000);
    const w = frame(room, host.id, now + 1000);
    expect(w.me!.town!.seat).toBe('s1');
    expect(w.towns!.map((t) => t.seat)).toEqual(['s1', 's2', 's3']);
    for (const t of w.towns as PublicTown[]) for (const k of Object.keys(t)) expect(PUBLIC_KEYS.has(k)).toBe(true);
    const shared = JSON.stringify({ towns: w.towns, county: w.county, visiting: w.visiting, snapshot: w.me!.snapshot, players: w.players });
    for (const key of PRIVATE) expect(shared).not.toContain(key);
    // Only the offers and contracts the viewer is a party to.
    expect(w.county!.offers.map((o) => o.id)).toEqual(['o2']);
    expect(w.county!.contracts).toEqual([]);
    expect(frame(room, kid.id, now + 1000).county!.contracts.map((k) => k.id)).toEqual(['k1']);
    // A visit shows the planes and buildings, nothing about money.
    expect(Object.keys(w.visiting!).sort()).toEqual(['buildings', 'construction', 'lv', 'planes', 'seat', 'siteKind', 'terrainEdits', 'terrainSeed']);
    expect(w.visiting!.seat).toBe('s2');
    // Another mayor's frame holds their own town, never the host's.
    const k = frame(room, kid.id, now + 1000);
    expect(k.me!.town!.seat).toBe('s2');
    expect(k.me!.moves!.every((m) => m.id.startsWith('p_kid'))).toBe(true);
  });

  it('a phone that is not seated sees the county and no me', () => {
    const { room, now } = threeTowns();
    room.players.push({ id: 'p_new', name: 'New', status: 'invited', seat: null });
    const w = frame(room, 'p_new', now);
    expect(w.me).toBeNull();
    expect(w.towns).toHaveLength(3);
  });
});

describe('deltas', () => {
  it('merge to exactly the whole frame, move after move, with the canary agreeing', () => {
    const t = threeTowns();
    const room = t.room;
    let now = t.now + 1000;
    let held = frame(room, host.id, now);
    expect(held.base).toBeNull();
    const steps: [string, () => void][] = [
      ['budget', () => play(room, host.id, 'budget', { moveId: 'b1', taxes: { town: 900 } }, now)],
      ['build', () => play(room, host.id, 'build', { planId: 'p1', plan: [{ op: 'road', kind: 'lane', path: [30, 40, 26, 40] }] }, now)],
      ['hello', () => play(room, host.id, 'hello', {}, now)],
      ['time passes', () => void (now += 5 * 30_000)],
      ['seen', () => play(room, host.id, 'seen', { tick: 3 }, now)],
      ['settings', () => play(room, host.id, 'settings', { moveId: 's1', seat: { pranks: false } }, now)],
      ['someone else', () => play(room, kid.id, 'budget', { moveId: 'kb', taxes: { town: 700 } }, now)],
      ['nothing', () => {}],
    ];
    let deltas = 0;
    for (const [what, step] of steps) {
      step();
      const d = frame(room, host.id, now, held.rev);
      const whole = frame(room, host.id, now);
      if (d.base !== null) deltas++;
      const merged = copy(applyFrame(held, d));
      expect({ ...merged, base: null }, what).toEqual({ ...whole, base: null });
      expect(stateHash(merged.me!.town!), what).toBe(whole.me!.townHash);
      held = merged;
    }
    expect(deltas).toBe(steps.length);
  });

  it('sends a whole frame to a rev it never sent, or after the room was read back', () => {
    const { room, now } = threeTowns();
    const first = frame(room, host.id, now);
    expect(frame(room, host.id, now, first.rev + 1000).base).toBeNull();
    const back = JSON.parse(JSON.stringify(room)) as Room;
    expect(frame(back, host.id, now, first.rev).base).toBeNull();
    expect(() => applyFrame(first, { ...first, base: first.rev - 1 })).toThrow('fetch the room whole');
  });
});

describe('budgets (§10.7, §10.8)', () => {
  it('a metropolis first frame is under 80 KB and an ordinary delta under 4 KB', () => {
    const { c, now } = playedMetropolis(1);
    const room = roomAround(c);
    const first = frame(room, host.id, now);
    expect(bytes(first)).toBeLessThanOrEqual(FIRST_FRAME_BUDGET);
    let held = first;
    for (const [action, body] of [
      ['budget', { moveId: 'b1', taxes: { town: 900 } }],
      ['hello', {}],
      ['seen', { tick: c.towns[0].tick }],
    ] as const) {
      play(room, host.id, action, body, now + 1000);
      const d = frame(room, host.id, now + 1000, held.rev);
      expect(d.base, action).toBe(held.rev);
      expect(bytes(d), action).toBeLessThanOrEqual(DELTA_BUDGET);
      held = applyFrame(held, d);
    }
  });

  // Measured two days in, with a full command log. The Why ring is still filling then (it is full
  // after seven days), so the steady state is larger again; see the note below.
  it('six metropolises stay under the 400 KB settle-guard line, and their first frames under 80 KB', () => {
    const { c, now } = sixMetropolises();
    const room = roomAround(c);
    // Any move trims the log's older bodies (LOG_FULL).
    play(room, host.id, 'hello', {}, now);
    expect(bytes(room)).toBeLessThanOrEqual(400 * 1024);
    expect(bytes(frame(room, host.id, now))).toBeLessThanOrEqual(FIRST_FRAME_BUDGET);
  });

  // Was a known gap (it.fails) until M0's varint Why records and a command log that keeps full
  // bodies only for its newest moves. Measured two days in: the seven-day steady state, with the
  // Why ring full, is not measured here and is still open.
  it('six metropolises fit the 320 KB room budget (§10.8)', () => {
    const { c, now } = sixMetropolises();
    const room = roomAround(c);
    play(room, host.id, 'hello', {}, now);
    expect(bytes(room)).toBeLessThanOrEqual(320 * 1024);
  });
});
