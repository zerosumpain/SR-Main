import { describe, expect, it } from 'vitest';
import {
  advance,
  again,
  answer,
  createRoom,
  dealProblems,
  decline,
  deadline,
  join,
  leave,
  makeProblem,
  recap,
  start,
  toWire,
  COUNTDOWN_MS,
  FINISHED_MS,
  GRACE_MS,
  LOBBY_MS,
  PROBLEM_COUNT,
  RAMP,
  TIME_LIMIT_MS,
  type Difficulty,
  type Problem,
  type Room,
} from './maths-sprint';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

/** A small seeded PRNG (mulberry32), so a "random" deal is repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function room(invite = [{ id: 'p_sam', name: 'Sam' }], difficulty: Difficulty = 'easy'): Room {
  return createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty, now: T0 });
}

/** Start and run the countdown down; returns when play began. */
function playing(r: Room, rng: () => number = seeded(7)): number {
  start(r, 'p_john', T0);
  advance(r, T0 + COUNTDOWN_MS, rng);
  return T0 + COUNTDOWN_MS;
}

function right(r: Room, id: string, now: number): void {
  const p = r.players.find((x) => x.id === id)!;
  answer(r, id, { index: p.index, value: r.problems![p.index].answer }, now);
}

function wrong(r: Room, id: string, now: number): void {
  const p = r.players.find((x) => x.id === id)!;
  answer(r, id, { index: p.index, value: r.problems![p.index].answer + 1 }, now);
}

/** Recompute a problem from its text, checking the text says what the answer says. */
function parse(text: string): { nums: number[]; ops: string[]; value: number } {
  const tokens = text.split(' ');
  const nums = tokens.filter((_, i) => i % 2 === 0).map(Number);
  const ops = tokens.filter((_, i) => i % 2 === 1);
  // × and ÷ bind first; at most one of them leads a two-step.
  const apply = (a: number, op: string, b: number) =>
    op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b;
  let value = apply(nums[0], ops[0], nums[1]);
  if (ops.length === 2) value = apply(value, ops[1], nums[2]);
  return { nums, ops, value };
}

describe('problem bands', () => {
  const seeds = [1, 2, 3, 42, 99, 1234];
  const deal = (d: Difficulty) => seeds.flatMap((s) => dealProblems(d, seeded(s)));

  it('every problem text computes to its answer, a whole number', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (const p of deal(d)) {
        expect(Number.isInteger(p.answer)).toBe(true);
        expect(parse(p.text).value).toBe(p.answer);
      }
    }
  });

  it('easy: + and − within 20, never negative', () => {
    for (const p of deal('easy')) {
      const { nums, ops } = parse(p.text);
      expect(ops.length).toBe(1);
      expect(['+', '−']).toContain(ops[0]);
      expect(p.answer).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums, p.answer)).toBeLessThanOrEqual(20);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(deal('easy').map((p) => p.kind))).toEqual(new Set(['add', 'sub']));
  });

  it('medium: + − within 100, × tables to 10', () => {
    const all = deal('medium');
    for (const p of all) {
      const { nums, ops } = parse(p.text);
      expect(ops.length).toBe(1);
      expect(p.answer).toBeGreaterThanOrEqual(0);
      if (ops[0] === '×') {
        for (const n of nums) {
          expect(n).toBeGreaterThanOrEqual(2);
          expect(n).toBeLessThanOrEqual(10);
        }
      } else {
        expect(['+', '−']).toContain(ops[0]);
        expect(Math.max(...nums, p.answer)).toBeLessThanOrEqual(100);
      }
    }
    expect(new Set(all.map((p) => p.kind))).toEqual(new Set(['add', 'sub', 'mul']));
  });

  it('hard: + − within 1000, × to 12, exact ÷, and some two-steps', () => {
    const all = deal('hard');
    for (const p of all) {
      const { nums, ops } = parse(p.text);
      expect(p.answer).toBeGreaterThanOrEqual(0);
      if (p.kind === 'add' || p.kind === 'sub') {
        expect(Math.max(...nums, p.answer)).toBeLessThanOrEqual(1000);
      } else if (p.kind === 'mul') {
        for (const n of nums) expect(n).toBeLessThanOrEqual(12);
      } else if (p.kind === 'div') {
        expect(ops).toEqual(['÷']);
        expect(nums[0] % nums[1]).toBe(0);
        expect(nums[1]).toBeGreaterThanOrEqual(2);
        expect(nums[1]).toBeLessThanOrEqual(12);
        expect(p.answer).toBeLessThanOrEqual(12);
      } else {
        expect(ops.length).toBe(2);
        expect(ops[0]).toBe('×');
        expect(['+', '−']).toContain(ops[1]);
        expect(nums[0]).toBeLessThanOrEqual(12);
        expect(nums[1]).toBeLessThanOrEqual(12);
      }
    }
    expect(new Set(all.map((p) => p.kind))).toEqual(new Set(['add', 'sub', 'mul', 'div', 'two-step']));
  });

  it('extreme rng values stay inside the band', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (const x of [0, 0.999999999]) {
        for (const i of [0, RAMP, PROBLEM_COUNT - 1]) {
          const p = makeProblem(d, i, () => x);
          expect(parse(p.text).value).toBe(p.answer);
          expect(p.answer).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('gets harder through the sequence', () => {
    const mean = (xs: Problem[]) => xs.reduce((s, p) => s + p.answer, 0) / xs.length;
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const all = seeds.map((s) => dealProblems(d, seeded(s)));
      const early = all.flatMap((ps) => ps.slice(0, 15).filter((p) => p.kind === 'add'));
      const late = all.flatMap((ps) => ps.slice(RAMP, RAMP + 60).filter((p) => p.kind === 'add'));
      expect(mean(late)).toBeGreaterThan(mean(early));
    }
    // Two-steps turn up more once the ramp is climbed.
    const hard = seeds.map((s) => dealProblems('hard', seeded(s)));
    const share = (from: number, to: number) => {
      const xs = hard.flatMap((ps) => ps.slice(from, to));
      return xs.filter((p) => p.kind === 'two-step').length / xs.length;
    };
    expect(share(RAMP, PROBLEM_COUNT)).toBeGreaterThan(share(0, 20));
  });

  it('never repeats a problem twice running', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const ps = dealProblems(d, seeded(5));
      for (let i = 1; i < ps.length; i++) expect(ps[i].text).not.toBe(ps[i - 1].text);
    }
  });
});

describe('dealing', () => {
  it('the same rng deals the same sequence; a different one does not', () => {
    expect(dealProblems('hard', seeded(11))).toEqual(dealProblems('hard', seeded(11)));
    expect(dealProblems('hard', seeded(11))).not.toEqual(dealProblems('hard', seeded(12)));
  });

  it('deals ONE sequence for the room when the countdown ends', () => {
    const r = room();
    playing(r, seeded(3));
    expect(r.phase).toBe('playing');
    expect(r.problems).toEqual(dealProblems('easy', seeded(3)));
    expect(r.problems).toHaveLength(PROBLEM_COUNT);
    expect(r.startedAt).toBe(T0 + COUNTDOWN_MS);
    expect(r.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + TIME_LIMIT_MS);
  });

  it('nothing is dealt before play', () => {
    const r = room();
    start(r, 'p_john', T0);
    expect(r.problems).toBeNull();
    expect(toWire(r, 'p_john', T0).me!.problem).toBeNull();
  });
});

describe('answering', () => {
  it('a right answer scores and moves on; a wrong one keeps the same problem', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    const first = r.problems![0];
    wrong(r, 'p_john', t + 100);
    const john = r.players[0];
    expect(john).toMatchObject({ index: 0, score: 0, misses: 1, streak: 0 });
    expect(toWire(r, 'p_john', t + 100).me!.problem).toEqual({ index: 0, text: first.text });
    right(r, 'p_john', t + 200);
    expect(john).toMatchObject({ index: 1, score: 1, misses: 1, streak: 1 });
    // Sam is on his own pace, still at the first problem.
    expect(toWire(r, 'p_sam', t + 200).me!.problem).toEqual({ index: 0, text: first.text });
  });

  it('a stale index is a 409 and changes nothing', () => {
    const r = room();
    const t = playing(r);
    right(r, 'p_john', t + 100);
    const before = structuredClone(r.players[0]);
    // The double-submit of problem 0, with its (right) answer.
    expect(() => answer(r, 'p_john', { index: 0, value: r.problems![0].answer }, t + 110)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => answer(r, 'p_john', { index: 5, value: 1 }, t + 110)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => answer(r, 'p_john', { index: '1', value: 1 }, t + 110)).toThrow(expect.objectContaining({ status: 409 }));
    expect(r.players[0]).toEqual(before);
  });

  it('a value that is not a whole number is a 400 and costs nothing', () => {
    const r = room();
    const t = playing(r);
    for (const value of [1.5, '7', null, undefined, NaN, Infinity]) {
      expect(() => answer(r, 'p_john', { index: 0, value }, t + 100)).toThrow(expect.objectContaining({ status: 400 }));
    }
    expect(r.players[0]).toMatchObject({ index: 0, score: 0, misses: 0 });
    // A negative whole number is an answer — just a wrong one.
    answer(r, 'p_john', { index: 0, value: -1 }, t + 100);
    expect(r.players[0].misses).toBe(1);
  });

  it('every 5 right in a row is a bonus point; a miss resets the streak', () => {
    const r = room();
    const t = playing(r);
    for (let i = 0; i < 4; i++) right(r, 'p_john', t + i);
    expect(r.players[0].score).toBe(4);
    right(r, 'p_john', t + 10);
    expect(r.players[0]).toMatchObject({ score: 6, streak: 5 });
    for (let i = 0; i < 5; i++) right(r, 'p_john', t + 20 + i);
    expect(r.players[0]).toMatchObject({ score: 12, streak: 10, bestStreak: 10 });
    wrong(r, 'p_john', t + 30);
    expect(r.players[0]).toMatchObject({ score: 12, streak: 0, bestStreak: 10, misses: 1 });
    for (let i = 0; i < 4; i++) right(r, 'p_john', t + 40 + i);
    expect(r.players[0].score).toBe(16);
    right(r, 'p_john', t + 50);
    expect(r.players[0]).toMatchObject({ score: 18, index: 15, bestStreak: 10 });
  });

  it('refuses outsiders, the wrong phase, and someone who left', () => {
    const r = room();
    expect(() => answer(r, 'p_john', { index: 0, value: 1 }, T0)).toThrow(expect.objectContaining({ status: 409 }));
    const t = playing(r);
    expect(() => answer(r, 'p_zed', { index: 0, value: 1 }, t)).toThrow(expect.objectContaining({ status: 403 }));
    const three = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_amy', name: 'Amy' },
    ]);
    join(three, 'p_sam', T0);
    join(three, 'p_amy', T0);
    const t3 = playing(three);
    leave(three, 'p_sam', t3);
    expect(() => answer(three, 'p_sam', { index: 0, value: 1 }, t3)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('working through the whole sequence ends that player; all done ends the game', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    for (let i = 0; i < PROBLEM_COUNT; i++) right(r, 'p_john', t + 1);
    expect(r.phase).toBe('playing');
    expect(toWire(r, 'p_john', t + 1).me!.problem).toBeNull();
    expect(() => answer(r, 'p_john', { index: PROBLEM_COUNT, value: 1 }, t + 1)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    for (let i = 0; i < PROBLEM_COUNT; i++) right(r, 'p_sam', t + 2);
    expect(r.phase).toBe('finished');
    expect(r.phaseEndsAt).toBe(t + 2 + FINISHED_MS);
  });
});

describe('timing', () => {
  it('the limit plus grace ends play; an answer in the grace still lands', () => {
    const r = room();
    const t = playing(r);
    const limit = t + TIME_LIMIT_MS;
    expect(deadline(r)).toBe(limit + GRACE_MS);
    expect(advance(r, limit + GRACE_MS - 1, half)).toBe(false);
    right(r, 'p_john', limit + GRACE_MS - 1);
    expect(r.players[0].score).toBe(1);
    expect(advance(r, limit + GRACE_MS, half)).toBe(true);
    expect(r.phase).toBe('finished');
    expect(r.phaseEndsAt).toBe(limit + GRACE_MS + FINISHED_MS);
  });

  it('an answer after the grace is refused even before the registry ticks', () => {
    const r = room();
    const t = playing(r);
    expect(() => right(r, 'p_john', t + TIME_LIMIT_MS + GRACE_MS + 1)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('a registry that slept runs every deadline in order', () => {
    const r = room();
    start(r, 'p_john', T0);
    advance(r, T0 + COUNTDOWN_MS + TIME_LIMIT_MS + GRACE_MS + FINISHED_MS, half);
    expect(r.phase).toBe('closed');
  });

  it('a clock that is not a number moves nothing', () => {
    const r = room();
    start(r, 'p_john', T0);
    expect(advance(r, NaN, half)).toBe(false);
    expect(advance(r, Infinity, half)).toBe(false);
    expect(r.phase).toBe('countdown');
  });
});

describe('lobby (as Wordle Race)', () => {
  it('join, decline, and the lobby expiring', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_amy', name: 'Amy' },
    ]);
    join(r, 'p_sam', T0);
    decline(r, 'p_amy', T0);
    expect(r.players.map((p) => p.status)).toEqual(['joined', 'joined', 'declined']);
    expect(deadline(r)).toBe(T0 + LOBBY_MS);
    advance(r, T0 + LOBBY_MS, half);
    expect(r.phase).toBe('closed');
  });

  it('only the host starts; unanswered invites are declined; late joins refused', () => {
    const r = room();
    expect(() => start(r, 'p_sam', T0)).toThrow(expect.objectContaining({ status: 403 }));
    start(r, 'p_john', T0);
    expect(r.players[1].status).toBe('declined');
    expect(() => join(r, 'p_sam', T0)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => start(r, 'p_john', T0)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('the host leaving the lobby cancels; leaving later hands on the host', () => {
    const a = room();
    leave(a, 'p_john', T0);
    expect(a.phase).toBe('closed');
    const b = room();
    join(b, 'p_sam', T0);
    const t = playing(b);
    leave(b, 'p_john', t);
    expect(b.hostId).toBe('p_sam');
    expect(b.phase).toBe('playing');
    leave(b, 'p_sam', t);
    expect(b.phase).toBe('closed');
  });

  it('a leaver who was holding everyone up lets the game finish', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    for (let i = 0; i < PROBLEM_COUNT; i++) right(r, 'p_john', t);
    leave(r, 'p_sam', t + 5);
    expect(r.phase).toBe('finished');
  });

  it('again: host only, finished only, resets everyone', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    expect(() => again(r, 'p_john', t)).toThrow(expect.objectContaining({ status: 409 }));
    right(r, 'p_john', t);
    wrong(r, 'p_sam', t);
    advance(r, t + TIME_LIMIT_MS + GRACE_MS, half);
    expect(() => again(r, 'p_sam', t)).toThrow(expect.objectContaining({ status: 403 }));
    again(r, 'p_john', t + TIME_LIMIT_MS + 5_000);
    expect(r.phase).toBe('lobby');
    expect(r.problems).toBeNull();
    expect(r.startedAt).toBeNull();
    for (const p of r.players) expect(p).toMatchObject({ index: 0, score: 0, misses: 0, streak: 0, bestStreak: 0, wrong: {} });
  });
});

describe('the wire', () => {
  /** Every number that appears anywhere in the wire JSON. */
  function numbersIn(x: unknown, out: number[] = []): number[] {
    if (typeof x === 'number') out.push(x);
    else if (Array.isArray(x)) x.forEach((y) => numbersIn(y, out));
    else if (x && typeof x === 'object') Object.values(x).forEach((y) => numbersIn(y, out));
    return out;
  }

  it('while playing: my problem as text, never an answer, never anyone’s problem list', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    for (let i = 0; i < 7; i++) right(r, 'p_sam', t + i);
    wrong(r, 'p_john', t + 10);
    const w = toWire(r, 'p_john', t + 20);
    const json = JSON.stringify(w);
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"problems"');
    expect(w.me).toEqual({
      problem: { index: 0, text: r.problems![0].text },
      score: 0,
      correct: 0,
      misses: 1,
      streak: 0,
      bestStreak: 0,
    });
    expect(w.players.find((p) => p.id === 'p_sam')).toEqual({
      id: 'p_sam',
      name: 'Sam',
      status: 'joined',
      isHost: false,
      score: 8,
      answered: 7,
    });
    // Others' rows carry no misses or streak.
    expect(Object.keys(w.players[1]).sort()).toEqual(['answered', 'id', 'isHost', 'name', 'score', 'status']);
    expect(w.phaseEndsAt).toBe(t + TIME_LIMIT_MS);
    expect(w.standings).toBeNull();
    expect(w.recaps).toBeNull();
    // Sam's current problem's text is not on John's wire (his is identical, but only his own index is sent).
    expect(w.me!.problem!.index).toBe(0);
  });

  it('no answer value leaks through the wire while playing, for anyone', () => {
    const r = room([{ id: 'p_sam', name: 'Sam' }], 'hard');
    join(r, 'p_sam', T0);
    const t = playing(r, seeded(1));
    // Mark every answer with a number nothing else on the wire could be.
    r.problems = r.problems!.map((p, i) => ({ ...p, answer: 987_654_000 + i }));
    for (let i = 0; i < 3; i++) right(r, 'p_john', t + i);
    wrong(r, 'p_sam', t + 5);
    for (const me of ['p_john', 'p_sam', 'p_zed']) {
      const w = toWire(r, me, t + 10);
      expect(numbersIn(w).filter((n) => n >= 987_654_000 && n < 987_655_000)).toEqual([]);
      expect(JSON.stringify(w)).not.toContain('987654');
    }
    expect(toWire(r, 'p_john', t + 10).me!.problem).toEqual({ index: 3, text: r.problems[3].text });
  });

  it('at the finish: standings, shared wins, and recaps with answers', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_amy', name: 'Amy' },
    ]);
    join(r, 'p_sam', T0);
    join(r, 'p_amy', T0);
    const t = playing(r);
    for (let i = 0; i < 6; i++) right(r, 'p_john', t + i);
    wrong(r, 'p_john', t + 10);
    for (let i = 0; i < 6; i++) right(r, 'p_sam', t + i);
    wrong(r, 'p_sam', t + 11);
    right(r, 'p_amy', t);
    advance(r, t + TIME_LIMIT_MS + GRACE_MS, half);
    const w = toWire(r, 'p_amy', t + TIME_LIMIT_MS + GRACE_MS);
    expect(w.phase).toBe('finished');
    expect(w.me!.problem).toBeNull();
    expect(w.standings).toEqual([
      { id: 'p_john', name: 'John', score: 7, correct: 6, misses: 1, bestStreak: 6 },
      { id: 'p_sam', name: 'Sam', score: 7, correct: 6, misses: 1, bestStreak: 6 },
      { id: 'p_amy', name: 'Amy', score: 1, correct: 1, misses: 0, bestStreak: 1 },
    ]);
    expect(w.winnerIds).toEqual(['p_john', 'p_sam']);
    const john = w.recaps!.find((x) => x.playerId === 'p_john')!.problems;
    expect(john.map((x) => x.index)).toEqual([2, 3, 4, 5, 6]);
    expect(john[4]).toEqual({ index: 6, text: r.problems![6].text, answer: r.problems![6].answer, solved: false, wrongTries: 1 });
    expect(john[0]).toMatchObject({ solved: true, wrongTries: 0, answer: r.problems![2].answer });
    // Amy never touched her second problem, so her recap is the one she solved.
    expect(w.recaps!.find((x) => x.playerId === 'p_amy')!.problems.map((x) => x.index)).toEqual([0]);
  });

  it('a tie on points goes to fewer misses; nobody wins alone or with nothing', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    right(r, 'p_john', t);
    wrong(r, 'p_sam', t);
    right(r, 'p_sam', t);
    advance(r, t + TIME_LIMIT_MS + GRACE_MS, half);
    expect(toWire(r, 'p_john', t).winnerIds).toEqual(['p_john']);

    const solo = room([]);
    const ts = playing(solo);
    right(solo, 'p_john', ts);
    advance(solo, ts + TIME_LIMIT_MS + GRACE_MS, half);
    expect(toWire(solo, 'p_john', ts).winnerIds).toEqual([]);

    const zero = room();
    join(zero, 'p_sam', T0);
    const tz = playing(zero);
    advance(zero, tz + TIME_LIMIT_MS + GRACE_MS, half);
    expect(toWire(zero, 'p_john', tz).winnerIds).toEqual([]);
  });

  it('recap of nothing is empty', () => {
    const r = room();
    playing(r);
    expect(recap(r, r.players[0])).toEqual([]);
  });

  it('carries the base fields the registry reads', () => {
    const r = room();
    const w = toWire(r, 'p_john', T0);
    expect(w).toMatchObject({ id: 'g_1', game: 'maths-sprint', phase: 'lobby', serverNow: T0, timeLimitMs: TIME_LIMIT_MS });
  });
});
