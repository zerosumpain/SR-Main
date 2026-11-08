import { describe, expect, it } from 'vitest';
import {
  advance,
  again,
  back,
  chooseCourse,
  createRoom,
  deadline,
  finish,
  join,
  leave,
  start,
  standings,
  toWire,
  winners,
  DEFAULT_COURSE,
  PICK_MS,
  RACE_SLACK,
  START_LEAD_MS,
  type Room,
} from './marble-race';

const T0 = 1_790_000_000_000;
const course = { id: 'c9006', name: 'Rusted Foundry', marbles: 4, seconds: 107 };

function room(invite = [{ id: 'p_sam', name: 'Sam' }]): Room {
  const r = createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty: 'easy', options: { course }, now: T0 });
  for (const p of invite) join(r, p.id, T0);
  return r;
}

/** Start, both back a marble, and deal the race (as the registry's advance would right after the last pick). */
function racing(r: Room, picks: Record<string, number> = { p_john: 1, p_sam: 2 }): number {
  start(r, 'p_john', T0);
  for (const [id, m] of Object.entries(picks)) back(r, id, m, T0 + 1_000);
  advance(r, T0 + 1_000, () => 0.25);
  return T0 + 1_000;
}

describe('setting up a race', () => {
  it('takes the course from the create request, and refuses one that cannot be', () => {
    expect(room().course).toEqual(course);
    expect(createRoom({ id: 'g', host: { id: 'a', name: 'A' }, invite: [], difficulty: 'easy', now: T0 }).course).toEqual(DEFAULT_COURSE);
    for (const bad of [{ ...course, id: '../x' }, { ...course, marbles: 1 }, { ...course, marbles: 31 }, { ...course, name: '' }, 'c9006']) {
      expect(() => createRoom({ id: 'g', host: { id: 'a', name: 'A' }, invite: [], difficulty: 'easy', options: { course: bad }, now: T0 })).toThrow(
        'not one Marbler knows',
      );
    }
  });

  it('lets only the host change the course, and only in the lobby', () => {
    const r = room();
    expect(() => chooseCourse(r, 'p_sam', course, T0)).toThrow('Only the host');
    chooseCourse(r, 'p_john', { ...course, id: 'c9010', name: 'Copper Cascade', marbles: 12 }, T0);
    expect(r.course.marbles).toBe(12);
    start(r, 'p_john', T0);
    expect(() => chooseCourse(r, 'p_john', course, T0)).toThrow('set once the race starts');
  });
});

describe('backing marbles', () => {
  it('gives each marble one backer, and deals the race once everyone has picked', () => {
    const r = room();
    start(r, 'p_john', T0);
    expect(r.phase).toBe('picking');
    back(r, 'p_john', 1, T0 + 500);
    expect(() => back(r, 'p_sam', 1, T0 + 600)).toThrow('already backs');
    expect(() => back(r, 'p_sam', 4, T0 + 600)).toThrow('no such marble');
    back(r, 'p_john', 0, T0 + 700); // changing your mind frees the old one
    back(r, 'p_sam', 1, T0 + 800);
    // The last pick closes picking now; the registry's advance deals.
    expect(deadline(r)).toBe(T0 + 800);
    advance(r, T0 + 800, () => 0.5);
    expect(r.phase).toBe('racing');
    expect(r.seed).toBe(0x8000_0000);
    expect(r.startAt).toBe(T0 + 800 + START_LEAD_MS);
    expect(r.phaseEndsAt).toBe(r.startAt! + course.seconds * 1000 * RACE_SLACK);
  });

  it('gives a free marble to anybody who has not picked when picking closes', () => {
    const r = room();
    start(r, 'p_john', T0);
    back(r, 'p_john', 0, T0 + 1_000);
    advance(r, T0 + PICK_MS, () => 0);
    expect(r.phase).toBe('racing');
    const sam = r.players.find((p) => p.id === 'p_sam')!;
    expect(sam.marble).toBe(1); // the first free marble, with rng 0
  });
});

describe('the result', () => {
  it('settles when every phone has reported, and the best-placed backer wins', () => {
    const r = room();
    const now = racing(r);
    finish(r, 'p_john', [2, 0, 1, 3], now + 120_000);
    expect(r.phase).toBe('racing');
    finish(r, 'p_sam', [2, 0, 1, 3], now + 120_100);
    expect(r.phase).toBe('finished');
    expect(r.disputed).toBe(false);
    const table = standings(r);
    // Sam backs marble 2 (1st of 4: 4 points), John marble 1 (3rd: 2 points).
    expect(table.map((s) => [s.id, s.place, s.score])).toEqual([['p_sam', 1, 4], ['p_john', 3, 2]]);
    expect(winners(table)).toEqual(['p_sam']);
  });

  it('refuses an order that is not every marble once', () => {
    const r = room();
    const now = racing(r);
    for (const bad of [[0, 1, 2], [0, 1, 2, 2], [0, 1, 2, 4], 'x', [0.5, 1, 2, 3]]) {
      expect(() => finish(r, 'p_john', bad, now)).toThrow('every marble once');
    }
  });

  it('lets the majority stand when phones disagree, and says so', () => {
    const r = room([{ id: 'p_sam', name: 'Sam' }, { id: 'p_kim', name: 'Kim' }]);
    const now = racing(r, { p_john: 0, p_sam: 1, p_kim: 2 });
    finish(r, 'p_john', [3, 2, 1, 0], now);
    finish(r, 'p_sam', [0, 1, 2, 3], now);
    finish(r, 'p_kim', [0, 1, 2, 3], now);
    expect(r.result).toEqual([0, 1, 2, 3]);
    expect(r.disputed).toBe(true);
  });

  it('settles on the clock with whatever was reported, and with nothing if nobody did', () => {
    const r = room();
    racing(r);
    finish(r, 'p_john', [1, 0, 2, 3], r.startAt! + 60_000);
    advance(r, r.phaseEndsAt!, () => 0.5);
    expect(r.phase).toBe('finished');
    expect(standings(r)[0]).toMatchObject({ id: 'p_john', place: 1 });

    const quiet = room();
    racing(quiet);
    advance(quiet, quiet.phaseEndsAt!, () => 0.5);
    expect(quiet.phase).toBe('finished');
    expect(winners(standings(quiet))).toEqual([]);
  });

  it('stops waiting for a phone that leaves mid-race', () => {
    const r = room();
    const now = racing(r);
    finish(r, 'p_john', [0, 1, 2, 3], now);
    leave(r, 'p_sam', now);
    expect(r.phase).toBe('finished');
  });
});

describe('the wire', () => {
  it('sends the race (seed and start) only once it is dealt, and the result only when finished', () => {
    const r = room();
    expect(toWire(r, 'p_john', T0).race).toBeNull();
    const now = racing(r);
    const w = toWire(r, 'p_sam', now);
    expect(w.race).toEqual({ seed: r.seed, startAt: r.startAt });
    expect(w.players.map((p) => [p.id, p.marble])).toEqual([['p_john', 1], ['p_sam', 2]]);
    expect(w.result).toBeNull();
    finish(r, 'p_john', [0, 1, 2, 3], now);
    finish(r, 'p_sam', [0, 1, 2, 3], now);
    expect(toWire(r, 'p_sam', now).result).toEqual({ order: [0, 1, 2, 3], disputed: false });
  });

  it('plays again on the same course with fresh picks', () => {
    const r = room();
    const now = racing(r);
    finish(r, 'p_john', [0, 1, 2, 3], now);
    finish(r, 'p_sam', [0, 1, 2, 3], now);
    again(r, 'p_john', now);
    expect(r.phase).toBe('lobby');
    expect(r.course).toEqual(course);
    expect(r.players.every((p) => p.marble === null && p.report === null)).toBe(true);
    expect(r.seed).toBeNull();
  });
});
