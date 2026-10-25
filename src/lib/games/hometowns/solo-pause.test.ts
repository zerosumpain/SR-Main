// Decision 13 (2026-10-25): "Pause is solo only: the sole mayor of a county
// may pause it for as long as they like; a family county never pauses
// (holiday, Away and nap cover breaks)." The adapter's refusal, the uncapped
// solo pause and its heartbeat, the pause a second mayor's joining ends, and
// the wire's `me.canPause`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advance, createRoom, deadline, join, leave, moves, noteParent, start, PAUSE_MAX_MS, type Room } from './hometowns';
import { countyHash, paramsFor } from './engine/index';
import { SOLO_PAUSE_MESSAGE, canPause } from './solo';
import { toWire } from './wire';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Tuesday 20 October 2026, 12:00 UTC. */
const T0 = 1_792_497_600_000;
const host = { id: 'p_host', name: 'Host' };
const kid = { id: 'p_kid', name: 'Kid' };
const other = { id: 'p_other', name: 'Other' };

function newRoom(invite: { id: string; name: string }[] = [], county: Record<string, unknown> = { seed: 7 }): Room {
  return createRoom({ id: 'g_000000000009', host, invite, difficulty: 'easy', options: { county }, now: T0 });
}

function play(room: Room, who: string, action: string, body: Record<string, unknown>, now: number): void {
  moves[action](room, who, { action, ...body }, now);
}

function foundAndSprint(room: Room, now: number, who = host.id, site = 0): number {
  play(room, who, 'found', { site, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: 1, moveId: `${who}-found` }, now);
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

const refusal = (fn: () => void): { status?: number; message: string } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return { status: (e as { status?: number }).status, message: (e as Error).message };
  }
};

beforeEach(() => {
  process.env.HOMETOWNS_DEV_CLOCK = '1';
});
afterEach(() => {
  delete process.env.HOMETOWNS_DEV_CLOCK;
});

describe('pause is solo only', () => {
  it('refuses a pause in a county of two mayors, even a parent’s', () => {
    const room = newRoom([kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    expect(refusal(() => play(room, host.id, 'pause', { moveId: 'p', on: true }, now))).toEqual({ status: 409, message: SOLO_PAUSE_MESSAGE });
    expect(SOLO_PAUSE_MESSAGE).toBe('Pausing is only for a county you play on your own.');
    expect(room.county.pause).toBeNull();
    // A child is refused for the same reason first.
    expect(refusal(() => play(room, kid.id, 'pause', { moveId: 'q', on: true }, now))?.message).toBe(SOLO_PAUSE_MESSAGE);
  });

  it('lets the sole mayor pause; an invitee who has not joined does not count', () => {
    const room = newRoom([kid]);
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    play(room, host.id, 'pause', { moveId: 'p', on: true }, now);
    expect(room.county.pause).not.toBeNull();
    // The same move again is a replay, not a refusal.
    play(room, host.id, 'pause', { moveId: 'p', on: true }, now + 1000);
  });

  it('has no cap: far past 21 days it is still paused, and deadline() only heartbeats', () => {
    const room = newRoom();
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    play(room, host.id, 'pause', { moveId: 'p', on: true }, now);
    drain(room, now + MIN);
    const p = paramsFor('v1');
    for (let d = 1; d <= 60; d++) {
      // A hello now and then keeps the A40 heartbeat going (it stops after 90 days of silence).
      if (d % 20 === 0) play(room, host.id, 'hello', {}, now + d * DAY);
      advance(room, now + d * DAY);
      expect(room.county.pause).not.toBeNull();
      expect(deadline(room)).toBe(room.heartbeatAt + p.clock.heartbeatMs);
    }
    expect(60 * DAY).toBeGreaterThan(PAUSE_MAX_MS);
    // And resuming is the mayor's, whenever they like.
    play(room, host.id, 'pause', { moveId: 'r', on: false }, now + 61 * DAY);
    expect(room.county.pause).toBeNull();
  });

  it('always lets a pause end, even in a county that is no longer solo (a pause from before decision 13)', () => {
    const room = newRoom([kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    const now = foundAndSprint(room, T0 + 1000);
    // As a row from before the rule would hold it.
    room.county.pause = { since: now };
    play(room, host.id, 'pause', { moveId: 'r', on: false }, now + 10 * MIN);
    expect(room.county.pause).toBeNull();
  });

  it('a pause from before decision 13 left with a child as the sole mayor keeps its 21-day cap', () => {
    const room = newRoom([kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    let now = foundAndSprint(room, T0 + 1000);
    now = foundAndSprint(room, now, kid.id, 1);
    // As a row from before the rule would hold it.
    room.county.pause = { since: now };
    leave(room, host.id, now + MIN);
    expect(canPause(room, kid.id)).toBe(false);
    drain(room, now + 2 * MIN);
    expect(room.county.pause).not.toBeNull();
    const end = deadline(room)!;
    expect(end).toBeLessThanOrEqual(now + PAUSE_MAX_MS);
    drain(room, now + PAUSE_MAX_MS);
    expect(room.county.pause).toBeNull();
  });

  it('a second mayor joining ends the pause exactly as an explicit unpause at that instant does', () => {
    function paused(): { room: Room; now: number } {
      const room = newRoom([kid]);
      start(room, host.id, T0);
      const now = foundAndSprint(room, T0 + 1000);
      play(room, host.id, 'pause', { moveId: 'p', on: true }, now);
      drain(room, now + MIN);
      return { room, now };
    }
    const at = T0 + 3 * DAY + 17 * MIN;
    const a = paused();
    join(a.room, kid.id, at);
    expect(a.room.county.pause).toBeNull();

    const b = paused();
    play(b.room, host.id, 'pause', { moveId: 'r', on: false }, at);
    join(b.room, kid.id, at);
    // The unpause move is logged (and in the host town's move ring), and logging it trims an older
    // record's body (LOG_FULL); the move log is bookkeeping, and nothing else may differ.
    const strip = (r: Room) => {
      const c = structuredClone(r.county);
      c.log = [];
      for (const t of c.towns) t.moveIds = t.moveIds.filter((m) => m !== 'pause:r');
      return c;
    };
    expect(countyHash(strip(a.room))).toBe(countyHash(strip(b.room)));
    expect(JSON.stringify(strip(a.room))).toBe(JSON.stringify(strip(b.room)));
    // And they run on identically.
    const later = at + 2 * DAY;
    drain(a.room, later);
    drain(b.room, later);
    expect(countyHash(strip(a.room))).toBe(countyHash(strip(b.room)));
  });

  it('a county that becomes solo again (a mayor leaves) may pause', () => {
    const room = newRoom([kid]);
    join(room, kid.id, T0);
    start(room, host.id, T0);
    let now = foundAndSprint(room, T0 + 1000);
    now = foundAndSprint(room, now, kid.id, 1);
    expect(canPause(room, host.id)).toBe(false);
    leave(room, kid.id, now);
    expect(canPause(room, host.id)).toBe(true);
    play(room, host.id, 'pause', { moveId: 'p', on: true }, now + 1000);
    expect(room.county.pause).not.toBeNull();
  });
});

describe('me.canPause on the wire', () => {
  it('is true exactly for the sole mayor on a parent seat, while the county runs', () => {
    const room = newRoom([kid, other]);
    const me = (id: string, now: number) => toWire(room, id, now, null, { catchUp: false }).me;
    // The lobby: nobody may pause.
    expect(me(host.id, T0)!.canPause).toBe(false);
    start(room, host.id, T0);
    expect(me(host.id, T0)!.canPause).toBe(true);
    join(room, kid.id, T0 + 1000);
    expect(me(host.id, T0 + 1000)!.canPause).toBe(false);
    expect(me(kid.id, T0 + 1000)!.canPause).toBe(false);
    // An invitee has no seat and no `me`.
    expect(me(other.id, T0 + 1000)).toBeNull();
    leave(room, host.id, T0 + 2000);
    // The child is now the sole mayor, but not on a parent's seat: the engine's floor still holds.
    expect(me(kid.id, T0 + 2000)!.canPause).toBe(false);
    join(room, other.id, T0 + 3000);
    noteParent(room, other.id);
    expect(me(other.id, T0 + 3000)!.canPause).toBe(false);
    leave(room, kid.id, T0 + 4000);
    expect(me(other.id, T0 + 4000)!.canPause).toBe(true);
    expect(toWire(room, other.id, T0 + 4000, null, { catchUp: false }).clock.paused).toBe(false);
  });
});
