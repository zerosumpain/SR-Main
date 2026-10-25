// Erasing a family member's account keeps the county (catalogue
// `durable.erasePlayer`, spec §10.14, A33). A real county is built through the
// adapter — start, joins, foundings, Regional Days, a gift, the push window
// open, a visit — and the registry's own `keepSeat` runs on its row, exactly
// as `$lib/people/erase` would. Nothing here asserts a balance number.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAMES } from '../catalogue';
import { keepSeat, mentions, names } from '../erase-seat';
import type { StoredRoom } from '../room-store';
import { nextRegionalDayAt, paramsFor } from './engine/index';
import { advance, createRoom, erasePlayer, join, leave, moves, noteParent, start, type Room } from './hometowns';
import { FORMER_AVATAR, formerName, formerSeat } from './erase-mayor';
import { toWire } from './wire';

const MIN = 60_000;
/** Saturday 24 October 2026, 08:30 UTC (09:30 in London): push hours, no school. */
const T0 = Date.UTC(2026, 9, 24, 8, 30);
// Ids as `playerId` makes them ('p_' + a hash); names long enough for the registry's name check.
const host = { id: 'p_1a2b3c4d5e6f', name: 'Host Parent' };
const kid = { id: 'p_7a8b9c0d1e2f', name: 'Elder Child' };
const other = { id: 'p_3c4d5e6f7a8b', name: 'Other Parent' };
const small = { id: 'p_9e8d7c6b5a4f', name: 'Small Child' };
const rules = GAMES.hometowns;
const DEV = paramsFor('v1').clock.devRegionalTicks;

function play(room: Room, who: string, action: string, body: Record<string, unknown>, now: number): void {
  moves[action](room, who, { action, ...body }, now);
}

function foundAndSprint(room: Room, who: string, site: number, now: number): number {
  play(room, who, 'found', { site, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: site, moveId: `${who}-found` }, now);
  for (let k = 0; k < 12; k++) {
    now += 10_000;
    play(room, who, 'sprint', { moveId: `${who}-sprint-${k}` }, now);
  }
  return now;
}

function drain(room: Room, now: number): void {
  let n = 0;
  do advance(room, now);
  while (room.behind && ++n < 1_000);
}

const seatOf = (room: Room, id: string) => room.players.find((p) => p.id === id)!.seat!;

/** Four mayors (two parents, two children), each with a town, two Regional Days run, the day's push window open and visits in progress. */
function family(): { room: Room; now: number } {
  const room = createRoom({ id: 'g_erase000001', host, invite: [kid, other, small], difficulty: 'easy', options: { county: { name: 'Test County', devTickMs: 30_000, seed: 11 } }, now: T0 });
  join(room, kid.id, T0);
  join(room, other.id, T0);
  join(room, small.id, T0);
  noteParent(room, other.id);
  start(room, host.id, T0 + 1000);
  let now = T0 + 2000;
  for (const [k, p] of [host, kid, other, small].entries()) now = foundAndSprint(room, p.id, k, now);
  // Two Regional Days, then a gift and a third day so somebody has news when it runs.
  const c = room.county;
  drain(room, nextRegionalDayAt(c, DEV) + MIN);
  drain(room, nextRegionalDayAt(c, DEV) + MIN);
  now = nextRegionalDayAt(c, DEV) - 5 * MIN;
  drain(room, now);
  play(room, kid.id, 'gift', { moveId: 'g1', to: 0, item: 'tree' }, now);
  play(room, host.id, 'gift', { moveId: 'g2', to: 1, item: 'tree' }, now);
  now = nextRegionalDayAt(c, DEV) + MIN;
  drain(room, now);
  // Visits: the small child looks at the elder's town, the elder at the host's.
  play(room, small.id, 'visit', { moveId: 'v1', seat: seatOf(room, kid.id) }, now);
  play(room, kid.id, 'visit', { moveId: 'v2', seat: seatOf(room, host.id) }, now);
  // Every frame has been built once, so the in-memory caches hold every viewer.
  for (const p of room.players) toWire(room, p.id, now);
  return { room, now };
}

function row(room: Room, now: number): StoredRoom {
  const ids = room.players.map((p) => p.id);
  return {
    id: room.id,
    game: 'hometowns',
    stateSchema: rules.durable!.schema,
    pace: 'async',
    phase: room.phase,
    hostId: room.hostId,
    playerIds: ids,
    state: JSON.parse(JSON.stringify(room)),
    meta: { optionKeys: ['pace', 'county'], round: 0, recorded: false, sawInvite: ids, pushed: ids, turnPushed: { key: 'd2', ids }, finishPushed: false },
    version: 4,
    dueAt: null,
    updatedAt: new Date(now - MIN),
    finishedAt: null,
    closedAt: null,
  };
}

const roomOf = (r: StoredRoom) => r.state as unknown as Room;
const towns = (room: Room) => room.county.towns.map((t) => JSON.stringify(t));

beforeEach(() => {
  process.env.HOMETOWNS_DEV_CLOCK = '1';
});
afterEach(() => {
  delete process.env.HOMETOWNS_DEV_CLOCK;
});

describe('erasing a mayor keeps the county', () => {
  it('builds a county with something in every room-level place an id can sit', () => {
    const { room } = family();
    expect(room.phase).toBe('running');
    expect(room.county.dayIndex).toBeGreaterThanOrEqual(3);
    expect(room.push.open?.seats.length).toBeGreaterThan(0);
    expect(Object.keys(room.viewing)).toHaveLength(2);
    expect(room.county.towns).toHaveLength(4);
  });

  it('erases a child: the row is kept, their id and name are gone, the other towns are untouched, the county runs on', () => {
    const { room, now } = family();
    const seat = seatOf(room, kid.id);
    const index = room.county.towns.findIndex((t) => t.seat === seat);
    const before = towns(room);
    const kept = keepSeat(row(room, now), [kid.id], now + 1, rules);
    expect(kept).not.toBeNull();
    const after = roomOf(kept!);
    expect(mentions(kept!.state, kid.id) || mentions(kept!.meta, kid.id)).toBe(false);
    expect(names(kept!.state, kid.name)).toBe(false);
    expect(kept!.playerIds).toEqual([host.id, other.id, small.id]);
    expect(kept!.hostId).toBe(host.id);
    expect(kept!.phase).toBe('running');
    expect(kept!.version).toBe(5);
    // Their town rests under its placeholder; every other town is byte-for-byte as it was.
    const t = after.county.towns[index];
    expect(t).toMatchObject({ archived: true, seat: formerSeat(t.site), name: formerName(t.site), avatar: FORMER_AVATAR });
    after.county.towns.forEach((town, k) => {
      if (k !== index) expect(JSON.stringify(town)).toBe(before[k]);
    });
    // The room around the county: their visit gone, a visit to their town now to the placeholder, their seat out of the push window.
    expect(after.viewing[seat]).toBeUndefined();
    expect(after.viewing[seatOf(after, small.id)]).toBe(formerSeat(t.site));
    expect(after.push.open?.seats ?? []).not.toContain(seat);
    expect(after.county.settings.perSeat[seat]).toBeUndefined();
    expect(after.rev).toBeGreaterThan(room.rev);
    // Read back as the registry would, and played on: the county still advances, and a new mayor gets a fresh seat.
    const live = rules.durable!.revive!(structuredClone(kept!.state), kept!.stateSchema) as unknown as Room;
    const day = live.county.dayIndex;
    drain(live, nextRegionalDayAt(live.county, DEV) + MIN);
    expect(live.county.dayIndex).toBe(day + 1);
    play(live, small.id, 'hello', {}, nextRegionalDayAt(live.county, DEV) - MIN);
    expect(kept!.dueAt).not.toBeNull();
  });

  it('erases the parent hosting: the host passes to the other parent, and nothing of them is left', () => {
    const { room, now } = family();
    const hostSeat = seatOf(room, host.id);
    expect(room.push.open!.seats).toContain(hostSeat);
    const kept = keepSeat(row(room, now), [host.id], now + 1, rules);
    expect(kept).not.toBeNull();
    expect(kept!.hostId).toBe(other.id);
    expect(kept!.phase).toBe('running');
    expect(mentions(kept!.state, host.id) || mentions(kept!.meta, host.id)).toBe(false);
    expect(names(kept!.state, host.name)).toBe(false);
    const after = roomOf(kept!);
    expect(after.county.parents).toEqual([seatOf(after, other.id)]);
    expect(after.push.open?.seats ?? []).not.toContain(hostSeat);
    // The elder child was visiting the host's town: they now visit the placeholder.
    const t = after.county.towns[0];
    expect(after.viewing[seatOf(after, kid.id)]).toBe(formerSeat(t.site));
    const live = rules.durable!.revive!(structuredClone(kept!.state), kept!.stateSchema) as unknown as Room;
    const day = live.county.dayIndex;
    drain(live, nextRegionalDayAt(live.county, DEV) + MIN);
    expect(live.county.dayIndex).toBe(day + 1);
  });

  it('a later joiner after an erasure gets a seat nobody holds, and the erased town still counts towards six', () => {
    const { room, now } = family();
    // Erasing s2 of s1–s4: counting players alone would hand out "s4" twice.
    const kept = roomOf(keepSeat(row(room, now), [kid.id], now + 1, rules)!);
    const late = [
      { id: 'p_5f5f5f5f5f5f', name: 'Late Joiner' },
      { id: 'p_6e6e6e6e6e6e', name: 'Later Joiner' },
      { id: 'p_7d7d7d7d7d7d', name: 'Too Late' },
    ];
    for (const p of late) kept.players.push({ id: p.id, name: p.name, status: 'invited', seat: null });
    join(kept, late[0].id, now + 2);
    join(kept, late[1].id, now + 2);
    const seats = kept.players.map((p) => p.seat).filter(Boolean);
    expect(new Set(seats).size).toBe(seats.length);
    for (const s of seats) expect(kept.county.towns.filter((t) => t.seat === s).length).toBeLessThanOrEqual(1);
    // Five mayors and the erased mayor's town: the county is full.
    expect(() => join(kept, late[2].id, now + 3)).toThrow('is full');
  });

  it('deletes the county (null) when the parent hosting leaves only children', () => {
    const room = createRoom({ id: 'g_erase000002', host, invite: [kid], difficulty: 'easy', options: { county: { devTickMs: 30_000, seed: 3 } }, now: T0 });
    join(room, kid.id, T0);
    start(room, host.id, T0);
    let now = foundAndSprint(room, host.id, 0, T0 + 1000);
    now = foundAndSprint(room, kid.id, 1, now);
    expect(erasePlayer(structuredClone(room), host.id, now)).toBeNull();
    expect(keepSeat(row(room, now), [host.id], now, rules)).toBeNull();
  });

  it('closes the county when the last mayor is erased, with the host passed to a person still listed', () => {
    const room = createRoom({ id: 'g_erase000003', host, invite: [kid], difficulty: 'easy', options: { county: { devTickMs: 30_000, seed: 3 } }, now: T0 });
    join(room, kid.id, T0);
    start(room, host.id, T0);
    let now = foundAndSprint(room, host.id, 0, T0 + 1000);
    now = foundAndSprint(room, kid.id, 1, now);
    leave(room, kid.id, now);
    const kept = keepSeat(row(room, now), [host.id], now + 1, rules);
    expect(kept).not.toBeNull();
    expect(kept!.phase).toBe('closed');
    expect(kept!.closedAt).toEqual(new Date(now + 1));
    expect(kept!.hostId).toBe(kid.id);
    expect(mentions(kept!.state, host.id)).toBe(false);
    expect(names(kept!.state, host.name)).toBe(false);
  });

  it('a person who never joined (an invitee) is simply taken off the list', () => {
    const room = createRoom({ id: 'g_erase000004', host, invite: [kid, small], difficulty: 'easy', options: { county: { devTickMs: 30_000, seed: 3 } }, now: T0 });
    join(room, kid.id, T0);
    start(room, host.id, T0);
    const now = foundAndSprint(room, host.id, 0, T0 + 1000);
    const before = towns(room);
    const kept = keepSeat(row(room, now), [small.id], now + 1, rules);
    expect(kept!.playerIds).toEqual([host.id, kid.id]);
    expect(towns(roomOf(kept!))).toEqual(before);
  });
});
