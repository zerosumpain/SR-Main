import { describe, expect, it, vi } from 'vitest';

// The quiz writer calls the model; here it hands back a fixed set.
vi.mock('./quiz-night.server', () => ({
  writeQuiz: async (room: import('./quiz-night').Room) => {
    const { ready } = await import('./quiz-night');
    ready(
      room,
      {
        title: 'Test',
        questions: Array.from({ length: 6 }, (_, i) => ({
          prompt: `Question ${i}?`,
          options: ['a', 'b', 'c', 'd'],
          answerIndex: 1,
          explain: null,
        })),
      },
      room.createdAt,
    );
  },
}));

import { GAME_IDS, GAMES, type GameId, type RoomBase } from './catalogue';
import { buildLeaderboard, newRecords, roundRows, windowStart, type RoundRow } from './results';

const T0 = Date.parse('2026-09-29T10:00:00Z');
const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };

/** A room of `game` with John and Sam, played to its finish by the clock alone. */
async function finished(game: GameId, options: Record<string, unknown> = {}): Promise<{ room: RoomBase; now: number }> {
  const rules = GAMES[game];
  let now = T0;
  const room = rules.createRoom({ id: `g_${game}`, host: john, invite: [sam], difficulty: 'easy', options, now });
  if (rules.prepare) await rules.prepare(room);
  rules.join(room, 'p_sam', now);
  rules.start(room, 'p_john', now);
  // Nobody moves: every game ends on its own clock. Step to each deadline.
  for (let i = 0; i < 5_000 && room.phase !== 'finished'; i++) {
    const due = rules.deadline(room);
    now = due === null ? now + 1_000 : Math.max(now + 1, due);
    rules.advance(room, now, () => 0.42);
  }
  return { room, now };
}

describe('recording a finished round, in every game in the catalogue', () => {
  it.each(GAME_IDS.map((g) => [g]))('%s records both contenders from its own standings', async (game) => {
    const rules = GAMES[game];
    const { room, now } = await finished(game);
    expect(room.phase).toBe('finished');
    const rows = roundRows(room, rules, 1, now, []);
    expect(rows.map((r) => r.playerId).sort()).toEqual(['p_john', 'p_sam']);

    const wire = rules.toWire(room, 'p_john', now) as unknown as {
      standings: Array<{ id: string; score?: unknown }>;
      winnerIds: string[];
    };
    for (const r of rows) {
      expect(r).toMatchObject({ game, roomId: room.id, round: 1, players: 2, difficulty: 'easy' });
      expect(r.won).toBe(wire.winnerIds.includes(r.playerId));
      expect(r.score === null || Number.isInteger(r.score)).toBe(true);
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.rank).toBeLessThanOrEqual(2);
      const standing = wire.standings.find((s) => s.id === r.playerId)!;
      // The default is the standing's own numeric score; an override says otherwise.
      if (!rules.resultScore && typeof standing.score === 'number') expect(r.score).toBe(standing.score);
      if (!rules.resultScore && typeof standing.score !== 'number') expect(r.score).toBeNull();
    }
  });

  it('records nothing until the room is finished', () => {
    const rules = GAMES['tap-duel'];
    const room = rules.createRoom({ id: 'g_x', host: john, invite: [], difficulty: 'easy', now: T0 });
    expect(roundRows(room, rules, 1, T0)).toEqual([]);
  });

  it('records a solo game, which nobody wins', async () => {
    const rules = GAMES.boggle;
    let now = T0;
    const room = rules.createRoom({ id: 'g_solo', host: john, invite: [], difficulty: 'easy', options: { size: 4, seconds: 30 }, now });
    rules.start(room, 'p_john', now);
    for (let i = 0; i < 100 && room.phase !== 'finished'; i++) {
      now = Math.max(now + 1, rules.deadline(room) ?? now + 1000);
      rules.advance(room, now, Math.random);
    }
    const rows = roundRows(room, rules, 1, now, ['size', 'seconds', 'scoring', 'topic']);
    expect(rows).toEqual([expect.objectContaining({ playerId: 'p_john', won: false, rank: 1, players: 1, score: 0 })]);
    // The options the room used, read back off it, with the game's own line.
    expect(rows[0].options).toEqual({ size: 4, seconds: 30, scoring: 'classic', label: '4×4 · 30 seconds' });
  });

  it('takes Sequence Memory’s best length as its score', async () => {
    const { room, now } = await finished('sequence-memory');
    const rows = roundRows(room, GAMES['sequence-memory'], 1, now);
    for (const r of rows) expect(typeof r.score).toBe('number');
  });

  it('ranks winners first and ties together', () => {
    const rules = {
      toWire: () => ({
        id: 'g',
        phase: 'finished',
        serverNow: 0,
        standings: [
          { id: 'a', name: 'A', score: 9 },
          { id: 'b', name: 'B', score: 9 },
          { id: 'c', name: 'C', score: 4 },
          { id: 'd', name: 'D', score: 4 },
        ],
        winnerIds: ['a', 'b'],
      }),
    };
    const room = { id: 'g', game: 'boggle', difficulty: 'hard', hostId: 'a', phase: 'finished', players: [], phaseEndsAt: null } as RoomBase;
    expect(roundRows(room, rules, 3, T0).map((r) => [r.playerId, r.rank, r.won, r.round])).toEqual([
      ['a', 1, true, 3],
      ['b', 1, true, 3],
      ['c', 3, false, 3],
      ['d', 3, false, 3],
    ]);
  });
});

describe('the family clock (Europe/London, on a UTC server)', () => {
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('starts today at London midnight in summer time and the week on Monday', () => {
    // Tuesday 29 September 2026, 00:30 BST = 23:30 UTC on Monday.
    const now = Date.parse('2026-09-28T23:30:00Z');
    expect(iso(windowStart('day', now))).toBe('2026-09-28T23:00:00.000Z');
    expect(iso(windowStart('week', now))).toBe('2026-09-27T23:00:00.000Z');
    expect(windowStart('all', now)).toBeNull();
  });

  it('holds across the autumn clock change (Sunday 25 October 2026)', () => {
    // Sunday noon: midnight was still BST, the Monday before was BST.
    const sunday = Date.parse('2026-10-25T12:00:00Z');
    expect(iso(windowStart('day', sunday))).toBe('2026-10-24T23:00:00.000Z');
    expect(iso(windowStart('week', sunday))).toBe('2026-10-18T23:00:00.000Z');
    // The Monday after: GMT now, and a new week.
    const monday = Date.parse('2026-10-26T00:30:00Z');
    expect(iso(windowStart('day', monday))).toBe('2026-10-26T00:00:00.000Z');
    expect(iso(windowStart('week', monday))).toBe('2026-10-26T00:00:00.000Z');
    // 23:59 GMT Sunday is still in the old week.
    expect(iso(windowStart('week', Date.parse('2026-10-25T23:59:00Z')))).toBe('2026-10-18T23:00:00.000Z');
  });

  it('holds across the spring clock change (Sunday 28 March 2027)', () => {
    const sunday = Date.parse('2027-03-28T12:00:00Z');
    expect(iso(windowStart('day', sunday))).toBe('2027-03-28T00:00:00.000Z');
    expect(iso(windowStart('week', sunday))).toBe('2027-03-22T00:00:00.000Z');
    // Monday 00:30 BST is 23:30 UTC on the Sunday.
    const monday = Date.parse('2027-03-28T23:30:00Z');
    expect(iso(windowStart('day', monday))).toBe('2027-03-28T23:00:00.000Z');
    expect(iso(windowStart('week', monday))).toBe('2027-03-28T23:00:00.000Z');
  });
});

describe('new high scores', () => {
  const none = { day: null, week: null, all: null };

  it('needs something to beat, and names the widest window beaten', () => {
    const rows = [
      { playerId: 'a', score: 30 },
      { playerId: 'b', score: 20 },
    ];
    expect(newRecords(rows, none)).toEqual({});
    expect(newRecords(rows, { day: 10, week: 25, all: 40 })).toEqual({ a: 'week' });
    expect(newRecords(rows, { day: 10, week: 10, all: 10 })).toEqual({ a: 'all' });
    expect(newRecords(rows, { day: 12, week: 40, all: 40 })).toEqual({ a: 'day' });
    expect(newRecords(rows, { day: 30, week: 30, all: 30 })).toEqual({});
  });

  it('shares a record tied at the top of the round, and ignores unscored games', () => {
    expect(newRecords([{ playerId: 'a', score: 5 }, { playerId: 'b', score: 5 }], { day: 4, week: 9, all: 9 })).toEqual({
      a: 'day',
      b: 'day',
    });
    expect(newRecords([{ playerId: 'a', score: null }], { day: 1, week: 1, all: 1 })).toEqual({});
  });
});

describe('the boards', () => {
  const at = (h: number) => new Date(T0 + h * 3_600_000);
  const row = (over: Partial<RoundRow>): RoundRow => ({
    game: 'boggle',
    roomId: 'g',
    round: 1,
    playerId: 'p_john',
    playerName: 'John',
    score: 0,
    rank: 1,
    won: false,
    players: 2,
    difficulty: 'easy',
    options: {},
    finishedAt: at(0),
    ...over,
  });

  it('shows the best score per person with what it was set on, and wins and games', () => {
    const board = buildLeaderboard(
      [
        row({ playerId: 'p_john', score: 12, won: true, options: { label: '4×4 · 90 seconds' } }),
        row({ playerId: 'p_sam', playerName: 'Sam', score: 8, finishedAt: at(0) }),
        row({ playerId: 'p_john', score: 30, finishedAt: at(1), difficulty: 'hard', options: { label: '6×6 · 3 minutes' } }),
        row({ playerId: 'p_sam', playerName: 'Samuel', score: 31, won: true, finishedAt: at(1) }),
      ],
      'week',
      new Date(T0),
      ['tap-duel', 'boggle'],
      { boggle: 'Boggle' },
    );
    expect(board.games).toHaveLength(1);
    expect(board.games[0]).toMatchObject({ game: 'boggle', title: 'Boggle', scored: true });
    expect(board.games[0].rows).toEqual([
      { rank: 1, playerId: 'p_sam', name: 'Samuel', best: 31, bestLabel: 'easy', wins: 1, played: 2 },
      { rank: 2, playerId: 'p_john', name: 'John', best: 30, bestLabel: '6×6 · 3 minutes · hard', wins: 1, played: 2 },
    ]);
    expect(board.overall).toEqual([
      { rank: 1, playerId: 'p_john', name: 'John', wins: 1, played: 2 },
      { rank: 1, playerId: 'p_sam', name: 'Samuel', wins: 1, played: 2 },
    ]);
    expect(board.from).toBe(new Date(T0).toISOString());
  });

  it('ranks a game with no numeric score by wins, with no best', () => {
    const board = buildLeaderboard(
      [
        row({ game: 'wordle-race', playerId: 'p_john', score: null, won: false }),
        row({ game: 'wordle-race', playerId: 'p_sam', playerName: 'Sam', score: null, won: true }),
        row({ game: 'wordle-race', playerId: 'p_sam', playerName: 'Sam', score: null, won: true, roomId: 'h' }),
        row({ game: 'wordle-race', playerId: 'p_kim', playerName: 'Kim', score: null, won: true, roomId: 'h' }),
      ],
      'all',
      null,
      GAME_IDS,
      {},
    );
    const [wordle] = board.games;
    expect(wordle.scored).toBe(false);
    expect(wordle.rows.map((r) => [r.rank, r.name, r.best, r.wins, r.played])).toEqual([
      [1, 'Sam', null, 2, 2],
      [2, 'Kim', null, 1, 1],
      [3, 'John', null, 0, 1],
    ]);
    expect(board.overall.map((o) => [o.rank, o.name, o.wins, o.played])).toEqual([
      [1, 'Sam', 2, 2],
      [2, 'Kim', 1, 1],
      [3, 'John', 0, 1],
    ]);
  });

  it('is empty for a window nobody played in', () => {
    expect(buildLeaderboard([], 'day', new Date(T0), GAME_IDS, {})).toEqual({
      window: 'day',
      from: new Date(T0).toISOString(),
      overall: [],
      games: [],
    });
  });
});
