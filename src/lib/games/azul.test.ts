// Azul rules: the deal, a turn, the lines and the floor, the wall's scoring,
// the end and its bonuses, the clock, leaving, and the wire.

import { describe, expect, it } from 'vitest';
import {
  BONUS,
  COLOURS,
  COUNTDOWN_MS,
  FIRST_MARKER_ID,
  SCORING_MS,
  TURN_MS,
  advance,
  again,
  autoMove,
  bonusFor,
  createRoom,
  deadline,
  factoryCount,
  floorPenalty,
  join,
  leave,
  legalLines,
  placementPoints,
  resume,
  start,
  take,
  toScreen,
  toWire,
  wallColour,
  wallColumn,
  waitingOn,
  type Colour,
  type Room,
  type Tile,
} from './azul';

const T0 = 1_800_000_000_000;
const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };

function playing(invite = [sam], options: Record<string, unknown> = {}): Room {
  const room = createRoom({ id: 'g_azul', host: john, invite, difficulty: 'medium', options: { seed: 7, ...options }, now: T0 });
  for (const p of invite) join(room, p.id, T0);
  start(room, john.id, T0);
  advance(room, T0 + COUNTDOWN_MS);
  return room;
}

const mover = (room: Room) => room.players.find((p) => p.id === room.turnId)!;

/** Every tile in the game, wherever it is: the count must always be 100. */
function census(room: Room): number[] {
  const ids = [
    ...room.bag,
    ...room.lid,
    ...room.factories.flat(),
    ...room.centre,
    ...room.players.flatMap((p) => [...p.lines.flat(), ...p.floor.filter((f) => f.c !== 'first')]),
  ].map((t) => t.id);
  const wall = room.players.flatMap((p) => p.wall.flat().filter((x): x is number => x !== null));
  return [...ids, ...wall].sort((a, b) => a - b);
}

describe('the wall pattern', () => {
  it('puts every colour once in each row and each column', () => {
    for (let r = 0; r < 5; r++) {
      const row = [0, 1, 2, 3, 4].map((c) => wallColour(r, c));
      expect(new Set(row).size).toBe(5);
      for (const c of COLOURS) expect(wallColour(r, wallColumn(r, c))).toBe(c);
    }
    expect([0, 1, 2, 3, 4].map((c) => wallColour(0, c))).toEqual(['blue', 'yellow', 'red', 'black', 'white']);
    expect([0, 1, 2, 3, 4].map((c) => wallColour(1, c))).toEqual(['white', 'blue', 'yellow', 'red', 'black']);
  });
});

describe('the deal', () => {
  it('fills 5, 7 or 9 factories with four tiles each, and the marker sits in the centre', () => {
    expect([2, 3, 4].map(factoryCount)).toEqual([5, 7, 9]);
    const two = playing();
    expect(two.phase).toBe('playing');
    expect(two.factories).toHaveLength(5);
    expect(two.factories.every((f) => f.length === 4)).toBe(true);
    expect(two.firstInCentre).toBe(true);
    expect(two.bag).toHaveLength(80);
    expect(census(two)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    const four = playing([sam, kim, { id: 'p_ann', name: 'Ann' }]);
    expect(four.factories).toHaveLength(9);
    expect(four.bag).toHaveLength(64);
  });

  it('is the same deal for the same seed', () => {
    expect(playing().factories).toEqual(playing().factories);
  });

  it('refuses a fifth player', () => {
    expect(() =>
      createRoom({ id: 'g', host: john, invite: [sam, kim, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }], difficulty: 'easy', now: T0 }),
    ).toThrow(/two to 4/);
  });
});

describe('a turn', () => {
  it('takes every tile of the colour from a factory and slides the rest to the centre', () => {
    const room = playing();
    const p = mover(room);
    const f = room.factories[0];
    const colour = f[0].c;
    const n = f.filter((t) => t.c === colour).length;
    take(room, p.id, { source: 0, colour, line: 4 }, T0 + 10_000);
    expect(p.lines[4]).toHaveLength(n);
    expect(room.factories[0]).toEqual([]);
    expect(room.centre).toHaveLength(4 - n);
    expect(room.turnId).not.toBe(p.id);
    expect(room.last).toMatchObject({ by: p.id, source: 0, colour, line: 4, overflow: 0, tookFirst: false });
    expect(census(room)).toHaveLength(100);
  });

  it('gives the first to take from the centre the marker, onto their floor', () => {
    const room = playing();
    const a = mover(room);
    take(room, a.id, { source: 0, colour: room.factories[0][0].c, line: 'floor' }, T0);
    const b = mover(room);
    const c = room.centre.length ? room.centre[0].c : null;
    if (!c) return; // a factory of one colour leaves nothing in the centre
    take(room, b.id, { source: 'centre', colour: c, line: 'floor' }, T0);
    expect(b.floor[0]).toEqual({ id: FIRST_MARKER_ID, c: 'first' });
    expect(room.firstInCentre).toBe(false);
    expect(room.nextStarterId).toBe(b.id);
  });

  it('spills what a line cannot hold onto the floor, and refuses a line of another colour or a colour already on the wall', () => {
    const room = playing();
    const p = mover(room);
    p.lines[1] = [{ id: 0, c: 'blue' }];
    expect(legalLines(p, 'red')).not.toContain(1);
    expect(legalLines(p, 'blue')).toContain(1);
    p.wall[2][wallColumn(2, 'red')] = 99;
    expect(legalLines(p, 'red')).not.toContain(2);
    room.factories[0] = [
      { id: 40, c: 'red' },
      { id: 41, c: 'red' },
      { id: 42, c: 'red' },
      { id: 43, c: 'red' },
    ];
    expect(() => take(room, p.id, { source: 0, colour: 'red', line: 1 }, T0)).toThrow(/collecting blue/);
    expect(() => take(room, p.id, { source: 0, colour: 'red', line: 2 }, T0)).toThrow(/already has red/);
    take(room, p.id, { source: 0, colour: 'red', line: 0 }, T0);
    expect(p.lines[0].map((t) => t.id)).toEqual([40]);
    expect(p.floor.map((t) => t.id)).toEqual([41, 42, 43]);
    expect(room.last?.overflow).toBe(3);
  });

  it('refuses off-turn, an empty factory, a missing colour and a bad line', () => {
    const room = playing();
    const p = mover(room);
    const other = room.players.find((x) => x.id !== p.id)!;
    const colour = room.factories[0][0].c;
    expect(() => take(room, other.id, { source: 0, colour, line: 0 }, T0)).toThrow(/not your turn/);
    expect(() => take(room, p.id, { source: 9, colour, line: 0 }, T0)).toThrow(/factory or the centre/);
    expect(() => take(room, p.id, { source: 'centre', colour, line: 0 }, T0)).toThrow(/no .* in the centre/);
    expect(() => take(room, p.id, { source: 0, colour, line: 5 }, T0)).toThrow(/pattern line/);
    expect(() => take(room, p.id, { source: 0, colour: 'green', line: 0 }, T0)).toThrow(/Pick a colour/);
  });
});

describe('scoring', () => {
  const wall = () => Array.from({ length: 5 }, () => [null, null, null, null, null] as (number | null)[]);

  it('scores a lone tile 1, a row run its length, and both runs when it joins a row and a column', () => {
    const w = wall();
    expect(placementPoints(w, 2, 2)).toBe(1);
    w[2][1] = 1;
    w[2][3] = 2;
    expect(placementPoints(w, 2, 2)).toBe(3);
    w[1][2] = 3;
    expect(placementPoints(w, 2, 2)).toBe(5);
  });

  it('costs the floor 1, 1, 2, 2, 2, 3, 3', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => floorPenalty(Array(n)))).toEqual([0, 1, 2, 4, 6, 8, 11, 14]);
  });

  it('pays the bonuses: 2 a row, 7 a column, 10 a colour', () => {
    const w = wall();
    for (let c = 0; c < 5; c++) w[0][c] = c;
    for (let r = 0; r < 5; r++) w[r][0] = 10 + r;
    for (let r = 0; r < 5; r++) w[r][wallColumn(r, 'red')] = 20 + r;
    const b = bonusFor(w);
    expect(b).toEqual({ rows: 1, columns: 1, colours: 1, points: BONUS.row + BONUS.column + BONUS.colour });
  });

  it('tiles full lines at the round end, sends the rest to the lid, and never goes below zero', () => {
    const room = playing();
    const [a, b] = room.players;
    const tiles = (c: Colour, n: number, from: number): Tile[] => Array.from({ length: n }, (_, i) => ({ id: from + i, c }));
    // Empty the table bar one tile, so the next take ends the round.
    room.bag.push(...room.factories.flat(), ...room.centre);
    room.factories = room.factories.map(() => []);
    room.centre = [];
    a.lines[2] = tiles('red', 3, 0);
    a.lines[1] = tiles('blue', 1, 3);
    b.score = 1;
    b.floor = tiles('black', 4, 10);
    room.bag = room.bag.filter((t) => ![0, 1, 2, 3, 10, 11, 12, 13, 60].includes(t.id));
    room.factories[0] = [{ id: 60, c: 'yellow' }];
    room.turnId = a.id;
    take(room, a.id, { source: 0, colour: 'yellow', line: 0 }, T0 + 1_000);
    expect(room.phase).toBe('scoring');
    expect(a.wall[2][wallColumn(2, 'red')]).toBe(0);
    expect(a.wall[0][wallColumn(0, 'yellow')]).toBe(60);
    expect(a.lines[1]).toHaveLength(1); // not full: stays for next round
    expect(a.score).toBe(2);
    expect(b.score).toBe(0);
    expect(room.lid.map((t) => t.id).sort((x, y) => x - y)).toEqual([1, 2, 10, 11, 12, 13]);
    expect(room.roundScores?.find((s) => s.id === b.id)).toMatchObject({ floor: 6, before: 1, after: 0 });
    expect(deadline(room)).toBe(T0 + 1_000 + SCORING_MS);
    advance(room, T0 + 1_000 + SCORING_MS);
    expect(room.phase).toBe('playing');
    expect(room.round).toBe(2);
    expect(census(room)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

describe('a whole game on the clock', () => {
  it('auto-plays to a finish, every tile accounted for, with bonuses and a winner', () => {
    for (const invite of [[sam], [sam, kim]]) {
      const room = playing(invite);
      let now = T0 + COUNTDOWN_MS;
      for (let i = 0; i < 2_000 && room.phase !== 'finished'; i++) {
        now = Math.max(now + 1, deadline(room) ?? now + 1);
        advance(room, now);
        expect(census(room)).toHaveLength(100);
      }
      expect(room.phase).toBe('finished');
      expect(room.result?.reason).toBe('wall');
      expect(room.players.some((p) => p.wall.some((r) => r.every((x) => x !== null)))).toBe(true);
      const wire = toWire(room, john.id, now);
      expect(wire.standings?.length).toBe(invite.length + 1);
      expect(wire.winnerIds.length).toBeGreaterThanOrEqual(1);
      expect(wire.standings?.[0].bonus).not.toBeNull();
      expect(wire.standings?.[0].score).toBeGreaterThan(0);
    }
  });

  it('gives a timed-out player a short clock until they move', () => {
    const room = playing();
    const p = mover(room);
    advance(room, T0 + COUNTDOWN_MS + TURN_MS.medium);
    expect(p.away).toBe(1);
    expect(room.last?.auto).toBe(true);
    const q = mover(room);
    take(room, q.id, { source: 'centre', colour: room.centre[0]?.c ?? room.factories.find((f) => f.length)![0].c, line: 'floor' }, T0 + 200_000);
    expect(mover(room).id).toBe(p.id);
    expect(deadline(room)).toBe(T0 + 200_000 + 20_000);
  });

  it('picks a move that fits rather than one that floods the floor', () => {
    const room = playing();
    const p = mover(room);
    room.factories = [[{ id: 1, c: 'red' }, { id: 2, c: 'red' }, { id: 3, c: 'red' }, { id: 4, c: 'blue' }], [], [], [], []];
    room.centre = [];
    room.firstInCentre = false;
    expect(autoMove(room, p)).toEqual({ source: 0, colour: 'red', line: 2 });
  });
});

describe('leaving, again, resume', () => {
  it('plays on without a leaver and ends with one left', () => {
    const room = playing([sam, kim]);
    const p = mover(room);
    leave(room, p.id, T0 + 5_000);
    expect(room.phase).toBe('playing');
    expect(room.turnId).not.toBe(p.id);
    leave(room, mover(room).id, T0 + 6_000);
    expect(room.phase).toBe('finished');
    expect(room.result?.reason).toBe('left');
    expect(room.result?.winnerIds).toHaveLength(1);
  });

  it('starts again in a fresh lobby', () => {
    const room = playing();
    leave(room, sam.id, T0);
    again(room, john.id, T0 + 1);
    expect(room.phase).toBe('lobby');
    expect(room.players.find((p) => p.id === sam.id)?.status).toBe('invited');
    expect(room.players.every((p) => p.score === 0 && p.seat === null)).toBe(true);
  });

  it('gives the running turn its full time after a restart', () => {
    const room = playing();
    resume(room, T0 + 999_999, 50_000);
    expect(deadline(room)).toBe(T0 + 999_999 + TURN_MS.medium);
  });

  it('waits on whoever is to move, with a key that changes each turn', () => {
    const room = playing();
    const first = waitingOn(room)!;
    expect(first.ids).toEqual([room.turnId]);
    take(room, mover(room).id, { source: 0, colour: room.factories[0][0].c, line: 'floor' }, T0);
    const second = waitingOn(room)!;
    expect(second.key).not.toBe(first.key);
    expect(second.line).toMatch(/took .* Your turn/);
  });

  it('runs async turns on the deadline the host picked', () => {
    const room = playing([sam], { pace: 'async', deadlineHours: 12 });
    expect(deadline(room)).toBe(T0 + COUNTDOWN_MS + 12 * 3_600_000);
  });
});

describe('the wire', () => {
  it('tells only the mover where each colour may go, and never the bag or the generator', () => {
    const room = playing();
    const p = mover(room);
    const other = room.players.find((x) => x.id !== p.id)!;
    const mine = toWire(room, p.id, T0);
    expect(Object.keys(mine.canPlace).length).toBeGreaterThan(0);
    expect(toWire(room, other.id, T0).canPlace).toEqual({});
    expect(toScreen(room, T0).canPlace).toEqual({});
    const text = JSON.stringify(toScreen(room, T0));
    expect(text).not.toContain('"rng"');
    expect(typeof toScreen(room, T0).bag).toBe('number');
  });

  it('defaults to phones, and remembers a TV table', () => {
    expect(playing().table).toBe('phones');
    expect(toWire(playing([sam], { table: 'tv' }), john.id, T0).table).toBe('tv');
  });
});
