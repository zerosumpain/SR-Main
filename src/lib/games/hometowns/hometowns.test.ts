// The Hometowns adapter as pure rules (WP4): setting up a county, the lobby
// verbs, moves through the engine, lazy catch-up in bounded chunks, the
// deadline, settings, pause and nap heartbeats, and the push window.
// Balance numbers are never asserted: only shapes, invariants and
// determinism, because the engine's parameters are still being tuned.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameError } from '../tap-duel';
import {
  CHUNK_UNITS,
  RETRY_MESSAGE,
  advance,
  createRoom,
  deadline,
  join,
  leave,
  noteParent,
  moves,
  readSetup,
  revive,
  start,
  waitingOn,
  type Room,
} from './hometowns';
import { catchUp, countyHash, gridTickAt, nextRegionalDayAt, paramsFor, population, type CountyState } from './engine/index';
import { londonParts, openPushWindow, emptyPush, prunePushWindow } from './push';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Tuesday 20 October 2026, 12:00 UTC. */
const T0 = 1_792_497_600_000;
const host = { id: 'p_host', name: 'Host' };
const kid = { id: 'p_kid', name: 'Kid' };
const gran = { id: 'p_gran', name: 'Gran' };

const devCounty = (extra: Record<string, unknown> = {}) => ({ county: { name: 'Test County', devTickMs: 30_000, seed: 7, ...extra } });

function newRoom(options: Record<string, unknown> = devCounty(), invite: { id: string; name: string }[] = []): Room {
  return createRoom({ id: 'g_000000000001', host, invite, difficulty: 'easy', options, now: T0 });
}

/** A move, as the act endpoint would post it. */
function play(room: Room, who: string, action: string, body: Record<string, unknown>, now: number): void {
  moves[action](room, who, { action, ...body }, now);
}

/** Found the host's town and tap the whole Founding Fortnight; returns the instant after. */
function foundAndSprint(room: Room, now: number, who = host.id, site = 0): number {
  play(room, who, 'found', { site, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: 1, moveId: `${who}-found` }, now);
  for (let k = 0; k < 12; k++) {
    now += 10_000;
    play(room, who, 'sprint', { moveId: `${who}-sprint-${k}` }, now);
  }
  return now;
}

/** advance until caught up; returns how many calls it took and which said "changed". */
function drain(room: Room, now: number): { calls: number; changed: boolean[] } {
  const changed: boolean[] = [];
  do changed.push(advance(room, now));
  while (room.behind && changed.length < 1_000);
  return { calls: changed.length, changed };
}

beforeEach(() => {
  process.env.HOMETOWNS_DEV_CLOCK = '1';
});
afterEach(() => {
  delete process.env.HOMETOWNS_DEV_CLOCK;
  vi.restoreAllMocks();
});

describe('setting up a county', () => {
  it('bounds every create option and honours the dev clock only when the server allows it', () => {
    expect(readSetup({ county: { name: '  Oak   Shire ', rivalry: 'spirited', regionalHour: 23, mishaps: 'off', devTickMs: 30_000, seed: 5 } }, 'g_x')).toEqual({
      name: 'Oak Shire',
      rivalry: 'spirited',
      regionalHour: paramsFor('v1').clock.regionalHour,
      mishaps: 'off',
      devTickMs: 30_000,
      seed: 5,
    });
    expect(readSetup({ county: { devTickMs: 1_000 } }, 'g_x').devTickMs).toBeNull();
    delete process.env.HOMETOWNS_DEV_CLOCK;
    expect(readSetup({ county: { devTickMs: 30_000 } }, 'g_x').devTickMs).toBeNull();
    // No seed asked for: one of the room's own, the same every time for the same room.
    expect(readSetup(undefined, 'g_a').seed).toBe(readSetup(undefined, 'g_a').seed);
    expect(readSetup(undefined, 'g_a').seed).not.toBe(readSetup(undefined, 'g_b').seed);
  });

  it('seats the host as a parent and invitees as children until a parent is noted', () => {
    const room = newRoom(devCounty(), [kid, gran]);
    expect(room.players.map((p) => [p.id, p.status, p.seat])).toEqual([
      ['p_host', 'joined', 's1'],
      ['p_kid', 'invited', null],
      ['p_gran', 'invited', null],
    ]);
    join(room, kid.id, T0);
    join(room, gran.id, T0);
    noteParent(room, gran.id);
    const c = room.county;
    expect(c.parents).toEqual(['s1', 's3']);
    expect(c.settings.perSeat.s2).toMatchObject({ profile: 'kid', pushes: false });
    expect(c.settings.perSeat.s3).toMatchObject({ profile: 'adult', pushes: true });
    expect(deadline(room)).toBeNull();
    expect(advance(room, T0 + DAY)).toBe(false);
  });

  it('lets a solo host start, and only a parent; the county counts from the start', () => {
    const room = newRoom(devCounty(), [kid]);
    join(room, kid.id, T0);
    expect(() => start(room, kid.id, T0 + MIN)).toThrow(GameError);
    expect(() => play(room, host.id, 'hello', {}, T0)).toThrow('The county starts when a parent taps Start.');
    start(room, host.id, T0 + 10 * MIN);
    expect(room.phase).toBe('running');
    expect(room.county.epoch).toBe(Math.floor((T0 + 10 * MIN) / 30_000) * 30_000);
    expect(() => start(room, host.id, T0 + 11 * MIN)).toThrow('already started');
    expect(() => moves.again).toBeDefined();

    const solo = newRoom();
    start(solo, host.id, T0);
    expect(solo.phase).toBe('running');
    const at = foundAndSprint(solo, T0 + 1000);
    const t = solo.county.towns[0];
    expect(t.seat).toBe('s1');
    expect(t.ownerId).toBe('s1');
    expect(t.gridBase).not.toBeNull();
    expect(population(t)).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(T0);
  });

  it('refuses moves from anyone without a seat, and never lets the phone say who owns a town', () => {
    const room = newRoom(devCounty(), [kid]);
    start(room, host.id, T0);
    expect(() => play(room, kid.id, 'hello', {}, T0)).toThrow('You are not a mayor in this county.');
    join(room, kid.id, T0);
    // A child's typed name is refused, and ownerId from the body is ignored.
    expect(() => play(room, kid.id, 'found', { site: 1, name: 'Kidtown', avatar: 'fox', flag: 0, ownerId: 'p_host', moveId: 'k1' }, T0 + 1000)).toThrow(GameError);
    play(room, kid.id, 'found', { site: 1, nameParts: ['Fox', 'ford'], avatar: 'fox', flag: 0, ownerId: 'p_host', moveId: 'k2' }, T0 + 1000);
    expect(room.county.towns[0]).toMatchObject({ seat: 's2', ownerId: 's2', name: 'Foxford' });
  });
});

describe('moves through the engine', () => {
  it('applies a repeated planId once (A28) and turns engine refusals into GameErrors', () => {
    const room = newRoom();
    start(room, host.id, T0);
    let now = foundAndSprint(room, T0 + 1000);
    const t = room.county.towns[0];
    now += 30_000;
    const plan = [{ op: 'road', kind: 'lane', path: [30, 40, 26, 40] }];
    const before = t.money.reserves;
    play(room, host.id, 'build', { planId: 'plan-1', plan }, now);
    const after = t.money.reserves;
    expect(after).toBeLessThan(before);
    const rev = room.rev;
    play(room, host.id, 'build', { planId: 'plan-1', plan }, now + 1000);
    expect(t.money.reserves).toBe(after);
    expect(room.rev).toBeGreaterThan(rev);
    expect(() => play(room, host.id, 'build', { plan }, now)).toThrow(GameError);
    try {
      play(room, host.id, 'build', { planId: 'plan-2', plan: [{ op: 'place', id: 'nothing', x: 0, y: 0, rot: 0 }] }, now);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GameError);
      expect((e as GameError).status).toBe(400);
    }
    expect(() => play(room, host.id, 'build', { planId: 'big', plan: [{ op: 'road', kind: 'lane', path: new Array(10_000).fill(1) }] }, now)).toThrow('too big');
  });

  it('a visit names a town in this county, and `stats` changes nothing', () => {
    const room = newRoom();
    start(room, host.id, T0);
    foundAndSprint(room, T0 + 1000);
    expect(() => play(room, host.id, 'visit', { seat: 's9' }, T0 + 200_000)).toThrow('That town isn’t in this county.');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hash = countyHash(room.county);
    play(room, host.id, 'stats', { canary: { tick: 3, ok: false } }, T0 + 200_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[hometowns] canary mismatch'));
    expect(countyHash(room.county)).toBe(hash);
  });
});

describe('lazy catch-up (§10.5)', () => {
  it('drains a 100-tick backlog in bounded chunks, writing only when it finishes, to the same county', () => {
    const room = newRoom();
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    const twin = JSON.parse(JSON.stringify(room.county));
    const later = now + 100 * 30_000;
    const { calls, changed } = drain(room, later);
    expect(calls).toBeGreaterThan(1);
    // A27: only the finishing chunk (or one that ran a Regional Day) says "write".
    expect(changed[changed.length - 1]).toBe(true);
    expect(changed.slice(0, -1).filter((x) => x).length).toBeLessThanOrEqual(3);
    expect(room.behind).toBe(false);
    // The same county as one unbounded catch-up.
    catchUp(twin, later, 1e9);
    expect(countyHash(room.county)).toBe(countyHash(twin));
    const p = paramsFor('v1');
    expect(room.county.gridTick).toBe(gridTickAt(room.county, Math.min(later, nextRegionalDayAt(room.county, p.clock.devRegionalTicks))));
  });

  it('says "now" while behind, else the next Regional Day or the next Play-it-all tick', () => {
    const room = newRoom();
    start(room, host.id, T0);
    play(room, host.id, 'found', { site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 0, moveId: 'f' }, T0 + 1000);
    play(room, host.id, 'sprint', { moveId: 's', auto: true }, T0 + 2000);
    expect(deadline(room)).toBe(T0 + 2000 + paramsFor('v1').clock.sprintAutoMs);
    const now = T0 + 10 * MIN;
    advance(room, now);
    const left = room.county.towns[0].sprintLeft;
    expect(left).toBeLessThan(12);
    room.behind = true;
    expect(deadline(room)).toBe(0);
    drain(room, now + 30 * MIN);
    expect(deadline(room)).toBe(nextRegionalDayAt(room.county, paramsFor('v1').clock.devRegionalTicks));
  });

  it('finishes a due Regional Day inside a move when it can, and asks a big county to retry', () => {
    const solo = newRoom();
    start(solo, host.id, T0);
    let now = foundAndSprint(solo, T0 + 1000);
    now = nextRegionalDayAt(solo.county, paramsFor('v1').clock.devRegionalTicks) + 1000;
    const day = solo.county.dayIndex;
    play(solo, host.id, 'hello', {}, now);
    play(solo, host.id, 'budget', { moveId: 'b1', taxes: { town: 900 } }, now);
    expect(solo.county.dayIndex).toBe(day + 1);

    // Three towns a whole day behind are more than the move's two extra chunks.
    const big = newRoom(devCounty(), [kid, gran]);
    join(big, kid.id, T0);
    join(big, gran.id, T0);
    start(big, host.id, T0);
    let at = foundAndSprint(big, T0 + 1000, host.id, 0);
    at = foundAndSprint(big, at, kid.id, 1);
    at = foundAndSprint(big, at, gran.id, 2);
    const due = nextRegionalDayAt(big.county, paramsFor('v1').clock.devRegionalTicks) + 1000;
    let refused: GameError | null = null;
    try {
      play(big, host.id, 'budget', { moveId: 'b2', taxes: { town: 900 } }, due);
    } catch (e) {
      refused = e as GameError;
    }
    expect(refused).toBeInstanceOf(GameError);
    expect(refused).toMatchObject({ status: 409, message: RETRY_MESSAGE });
    drain(big, due);
    play(big, host.id, 'budget', { moveId: 'b2', taxes: { town: 900 } }, due + 1000);
  });
});

describe('settings, pause and nap', () => {
  it('keeps county settings and children’s seats for parents, and lands rule changes between days', () => {
    const room = newRoom(devCounty(), [kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    expect(() => play(room, kid.id, 'settings', { moveId: 'x', county: { mishaps: 'off' } }, T0)).toThrow('Only a parent');
    expect(() => play(room, kid.id, 'settings', { moveId: 'y', seat: { pushes: true } }, T0)).toThrow('Only a parent');
    expect(() => play(room, host.id, 'settings', { moveId: 'z', county: { regionalHour: 22 } }, T0)).toThrow('between 08:00 and 19:00');
    play(room, host.id, 'settings', { moveId: 's1', county: { mishaps: 'off', name: 'Brook County' }, seat: { seat: 's2', pushes: true } }, T0);
    expect(room.county.name).toBe('Brook County');
    expect(room.county.settings.perSeat.s2.pushes).toBe(true);
    expect(room.county.settings.mishaps).toBe('mild');
    expect(room.queued).toEqual({ mishaps: 'off' });
    foundAndSprint(room, T0 + 1000);
    drain(room, nextRegionalDayAt(room.county, paramsFor('v1').clock.devRegionalTicks) + 1000);
    expect(room.county.settings.mishaps).toBe('off');
    expect(room.queued).toBeNull();
  });

  it('refuses a seat named after an Object.prototype key, and never touches the prototype', () => {
    const room = newRoom(devCounty(), [kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    for (const [i, seat] of ['__proto__', 'constructor', 'toString'].entries()) {
      expect(() => play(room, host.id, 'settings', { moveId: `p${i}`, seat: { seat, profile: 'adult', pushes: true } }, T0)).toThrow('isn’t in this county');
    }
    expect(({} as Record<string, unknown>).profile).toBeUndefined();
    expect(({} as Record<string, unknown>).pushes).toBeUndefined();
  });

  it('a paused county writes a weekly heartbeat, and the pause ends by itself after 21 days', () => {
    const room = newRoom({ county: { seed: 7 } });
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    play(room, host.id, 'pause', { moveId: 'p', on: true }, now);
    drain(room, now + MIN);
    const beat = deadline(room)!;
    expect(beat).toBe(room.heartbeatAt + paramsFor('v1').clock.heartbeatMs);
    expect(advance(room, beat - 1000)).toBe(false);
    expect(advance(room, beat)).toBe(true);
    expect(room.heartbeatAt).toBe(beat);
    advance(room, now + 22 * DAY);
    expect(room.county.pause).toBeNull();
  });

  it('a county nobody greets naps at lastHello + 72 h, beats weekly, and stops beating after 90 days', () => {
    const room = newRoom({ county: { seed: 7 } });
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    const p = paramsFor('v1');
    drain(room, now + 4 * DAY);
    expect(room.county.nap).not.toBeNull();
    expect(deadline(room)).toBe(room.heartbeatAt + p.clock.heartbeatMs);
    let beats = 0;
    for (let d = 5; d < 120; d++) if (advance(room, now + d * DAY)) beats++;
    expect(beats).toBeGreaterThan(5);
    expect(beats).toBeLessThanOrEqual(Math.ceil(p.social.napHeartbeatMaxDays / 7) + 1);
    expect(deadline(room)).toBeNull();
    // A hello wakes it, with no backlog.
    play(room, host.id, 'hello', {}, now + 120 * DAY);
    expect(room.county.nap).toBeNull();
  });

  it('the last mayor leaving closes the county; a mayor leaving rests their town', () => {
    const room = newRoom(devCounty(), [kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    const at = foundAndSprint(room, T0 + 1000, kid.id, 1);
    leave(room, kid.id, at + MIN);
    expect(room.county.towns[0].archived).toBe(true);
    expect(room.phase).toBe('running');
    leave(room, host.id, at + 2 * MIN);
    expect(room.phase).toBe('closed');
  });
});

describe('the daily push (§10.11, A29)', () => {
  /** A county on the production clock whose next Regional Day is Sunday 25 October 2026, 18:00 London (GMT that evening). */
  function sundayCounty(): { room: Room; at: number } {
    const sat = Date.UTC(2026, 9, 24, 12, 0);
    const room = createRoom({ id: 'g_000000000002', host, invite: [], difficulty: 'easy', options: { county: { seed: 3 } }, now: sat });
    start(room, host.id, sat);
    foundAndSprint(room, sat + 1000);
    const c = room.county;
    // Saturday's day has run: the next one is Sunday's.
    c.lastRegionalDayAt = nextRegionalDayAt(c);
    c.dayIndex = 1;
    room.daySeen = 1;
    const at = nextRegionalDayAt(c);
    expect(londonParts(at)).toMatchObject({ minutes: 18 * 60, weekday: 0 });
    return { room, at };
  }

  it('rings once, keyed by the day, for the Sunday Gazette, and shuts the window after two hours', () => {
    const { room, at } = sundayCounty();
    drain(room, at + MIN);
    const w = waitingOn(room)!;
    expect(w).toEqual({ ids: [host.id], key: `d${room.county.dayIndex - 1}g`, line: expect.stringContaining('waiting for you') });
    advance(room, at + 30 * MIN);
    expect(waitingOn(room)?.key).toBe(w.key);
    advance(room, at + 2 * HOUR);
    expect(waitingOn(room)).toBeNull();
  });

  it('stays quiet for a Regional Day run late after an outage, and for a seat whose pushes are off', () => {
    const late = sundayCounty();
    drain(late.room, late.at + 3 * HOUR);
    expect(waitingOn(late.room)).toBeNull();
    const off = sundayCounty();
    off.room.county.settings.perSeat.s1.pushes = false;
    drain(off.room, off.at + MIN);
    expect(waitingOn(off.room)).toBeNull();
  });

  it("drops a child's seat from an open window once school starts, and shuts it when nobody is left", () => {
    const { room } = sundayCounty();
    const c = room.county;
    c.settings.perSeat.s1.profile = 'kid';
    // A Regional Day at 08:00 on Monday 26 October 2026 (GMT): the window would run to 10:00.
    const eight = Date.UTC(2026, 9, 26, 8, 0);
    room.push.open = { key: 'd5', seats: ['s1'], line: 'News', until: eight + 2 * HOUR };
    expect(prunePushWindow(room.push, c, eight + 10 * MIN)).toBe(false);
    expect(prunePushWindow(room.push, c, eight + 40 * MIN)).toBe(true);
    expect(room.push.open).toBeNull();
  });

  it('opens at most one window a London day, whatever the clock', () => {
    const { room, at } = sundayCounty();
    const c = room.county;
    const push = emptyPush();
    const seated = () => true;
    // Two Regional Days the same evening (the dev clock): the second stays shut.
    c.lastRegionalDayAt = at;
    c.dayIndex = 2;
    expect(openPushWindow(push, c, at + MIN, seated)).not.toBeNull();
    c.dayIndex = 3;
    c.lastRegionalDayAt = at + 30 * MIN;
    expect(openPushWindow(push, c, at + 31 * MIN, seated)).toBeNull();
    // Out of hours, never.
    const quiet = emptyPush();
    c.lastRegionalDayAt = Date.UTC(2026, 9, 25, 21, 0);
    expect(openPushWindow(quiet, c, c.lastRegionalDayAt + MIN, seated)).toBeNull();
  });
});

describe('durable shape', () => {
  it('is JSON-safe and revives with its defaults filled in', () => {
    const room = newRoom();
    start(room, host.id, T0);
    foundAndSprint(room, T0 + 1000);
    const stored = JSON.parse(JSON.stringify(room)) as Record<string, unknown>;
    expect(stored).toEqual(JSON.parse(JSON.stringify(room)));
    delete stored.push;
    delete stored.viewing;
    const back = revive(stored, 1);
    expect(back.push).toEqual(emptyPush());
    expect(back.viewing).toEqual({});
    expect(CHUNK_UNITS).toBeGreaterThan(0);
  });

  it('gives a child’s town made before growth help that order on load (decision 12)', () => {
    const room = newRoom();
    start(room, host.id, T0);
    foundAndSprint(room, T0 + 1000);
    const stored = JSON.parse(JSON.stringify(room)) as { county: CountyState };
    const t = stored.county.towns[0];
    stored.county.settings.perSeat[t.seat].profile = 'kid';
    t.orders = t.orders.filter((o) => o.kind !== 'growthHelp');
    const back = revive(stored as unknown as Record<string, unknown>, 1);
    const orders = back.county!.towns[0].orders;
    expect(orders.map((o) => o.kind)).toEqual(['budgetHealthy', 'buyUtilities', 'fixDamaged', 'renewContracts', 'awayZoning', 'growthHelp', 'repayLoan', 'hold']);
    expect(orders.find((o) => o.kind === 'growthHelp')).toEqual({ kind: 'growthHelp', on: true, args: [24, 3, 5] });
  });
});
