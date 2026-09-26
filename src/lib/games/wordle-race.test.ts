import { describe, expect, it } from 'vitest';
import {
  advance,
  again,
  createRoom,
  dealSecret,
  decline,
  deadline,
  guess,
  hardModeViolation,
  isWord,
  join,
  keyboard,
  leave,
  mark,
  start,
  toWire,
  COUNTDOWN_MS,
  GRACE_MS,
  LOBBY_MS,
  MAX_GUESSES,
  TUNING,
  type Difficulty,
  type Room,
} from './wordle-race';
import { ALLOWED } from './words/allowed';
import { ANSWERS } from './words/answers';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

function room(invite = [{ id: 'p_sam', name: 'Sam' }], difficulty: Difficulty = 'easy'): Room {
  return createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty, now: T0 });
}

/** Start, run the countdown down, and fix the secret so the test knows it. */
function playing(r: Room, secret = 'crane'): number {
  start(r, 'p_john', T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  r.secret = secret;
  return T0 + COUNTDOWN_MS;
}

const G = 'correct';
const Y = 'present';
const X = 'absent';

describe('marking', () => {
  it('greens, yellows and greys the plain case', () => {
    expect(mark('crane', 'trace')).toEqual([X, G, G, Y, G]);
    expect(mark('crane', 'crane')).toEqual([G, G, G, G, G]);
    expect(mark('crane', 'fluid')).toEqual([X, X, X, X, X]);
  });

  it('secret ABBEY, guess BABBY: two Bs to find, the third B is grey', () => {
    // b(0) yellow, a(1) yellow, b(2) green, b(3) grey — both Bs already accounted for — y(4) green.
    expect(mark('abbey', 'babby')).toEqual([Y, Y, G, X, G]);
  });

  it('secret SPEED, guess EERIE: two Es in the secret, so only the first two light', () => {
    expect(mark('speed', 'eerie')).toEqual([Y, Y, X, X, X]);
  });

  it('a green takes its letter before an earlier yellow can', () => {
    // One E in the secret, at the end: the green wins it and the earlier Es stay grey.
    expect(mark('crane', 'eerie')).toEqual([X, X, Y, X, G]);
    // Spare copies go yellow left to right: SPELL has two Ls, one green at 4, one left for the first L.
    expect(mark('spell', 'lolly')).toEqual([Y, X, X, G, X]);
    expect(mark('abbey', 'keeps')).toEqual([X, Y, X, X, X]);
    expect(mark('rebus', 'bobby')).toEqual([X, X, G, X, X]);
  });

  it('a doubled guess letter against one copy lights once', () => {
    expect(mark('crane', 'error')).toEqual([Y, G, X, X, X]);
    expect(mark('those', 'geese')).toEqual([X, X, X, G, G]);
  });
});

describe('word lists', () => {
  it('are five lowercase letters, without repeats, and every answer is guessable', () => {
    for (const list of [ANSWERS, ALLOWED]) {
      expect(list.every((w) => /^[a-z]{5}$/.test(w))).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
    expect(ANSWERS.length).toBeGreaterThanOrEqual(1_000);
    expect(ALLOWED.length).toBeGreaterThan(ANSWERS.length);
    expect(ANSWERS.every(isWord)).toBe(true);
  });

  it('draws easy from the commonest words and hard from the whole list', () => {
    expect(dealSecret('easy', () => 0.999_999)).toBe(ANSWERS[TUNING.easy.pool - 1]);
    expect(dealSecret('hard', () => 0.999_999)).toBe(ANSWERS[ANSWERS.length - 1]);
    expect(dealSecret('medium', () => 0)).toBe(ANSWERS[0]);
  });
});

describe('lobby', () => {
  it('seats the host and invites the rest, once each', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_john', name: 'John' },
    ]);
    expect(r.players.map((p) => [p.id, p.status])).toEqual([
      ['p_john', 'joined'],
      ['p_sam', 'invited'],
    ]);
    expect(r.phaseEndsAt).toBe(T0 + LOBBY_MS);
    expect(r.game).toBe('wordle-race');
  });

  it('refuses a sixth player', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, name: x }));
    expect(() => room(five)).toThrow(/Up to 5/);
  });

  it('only the host starts, unanswered invites lapse, and the secret is dealt at the go', () => {
    const r = room();
    expect(() => start(r, 'p_sam', T0)).toThrow(/Only the host/);
    start(r, 'p_john', T0);
    expect(r.phase).toBe('countdown');
    expect(r.secret).toBeNull();
    expect(r.players[1].status).toBe('declined');
    expect(() => join(r, 'p_sam', T0)).toThrow(/already started/);
    advance(r, T0 + COUNTDOWN_MS, half);
    expect(r.phase).toBe('playing');
    expect(r.secret).toBe(ANSWERS[Math.floor(0.5 * TUNING.easy.pool)]);
    expect(r.startedAt).toBe(T0 + COUNTDOWN_MS);
    expect(r.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + TUNING.easy.timeLimitMs);
  });

  it('closes when nobody starts it', () => {
    const r = room();
    expect(advance(r, T0 + LOBBY_MS, half)).toBe(true);
    expect(r.phase).toBe('closed');
  });

  it('a host leaving the lobby cancels it', () => {
    const r = room();
    join(r, 'p_sam', T0);
    leave(r, 'p_john', T0);
    expect(r.phase).toBe('closed');
  });

  it('decline only touches an open invite', () => {
    const r = room();
    decline(r, 'p_sam', T0);
    expect(r.players[1].status).toBe('declined');
    expect(() => decline(r, 'p_stranger', T0)).toThrow(/not in this game/);
  });
});

describe('guessing', () => {
  it('refuses a non-word with a sentence, and it costs no guess', () => {
    const r = room([]);
    const t = playing(r);
    expect(() => guess(r, 'p_john', { word: 'zzzzz' }, t)).toThrow('Not in the word list.');
    expect(() => guess(r, 'p_john', { word: 'cran' }, t)).toThrow('Guesses are 5 letters.');
    expect(() => guess(r, 'p_john', { word: 42 }, t)).toThrow(/5 letters/);
    try {
      guess(r, 'p_john', { word: 'zzzzz' }, t);
    } catch (e) {
      expect((e as { status: number }).status).toBe(400);
    }
    expect(r.players[0].guesses).toEqual([]);
  });

  it('takes any case and spacing, and marks against the secret', () => {
    const r = room([]);
    const t = playing(r);
    guess(r, 'p_john', { word: ' TRACE ' }, t + 1_000);
    expect(r.players[0].guesses).toEqual([{ word: 'trace', marks: [X, G, G, Y, G], at: t + 1_000 }]);
  });

  it('refuses a guess after solving, and after six, with 409', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'crane' }, t + 20_000);
    expect(r.players[0].solveMs).toBe(20_000);
    expect(r.phase).toBe('playing');
    expect(() => guess(r, 'p_john', { word: 'trace' }, t)).toThrow(/already solved/);
    for (let i = 0; i < MAX_GUESSES; i++) guess(r, 'p_sam', { word: 'fluid' }, t + i);
    expect(r.phase).toBe('finished');
    expect(() => guess(r, 'p_sam', { word: 'crane' }, t + 10)).toThrow(/over/);
  });

  it('says so when one player is out but the game goes on', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    for (let i = 0; i < MAX_GUESSES; i++) guess(r, 'p_sam', { word: 'fluid' }, t + i);
    expect(r.phase).toBe('playing');
    let status = 0;
    try {
      guess(r, 'p_sam', { word: 'crane' }, t + 10);
    } catch (e) {
      status = (e as { status: number }).status;
      expect((e as Error).message).toBe('You are out of guesses.');
    }
    expect(status).toBe(409);
  });

  it('refuses a stranger, someone who left, and a guess before play', () => {
    const r = room();
    join(r, 'p_sam', T0);
    expect(() => guess(r, 'p_john', { word: 'crane' }, T0)).toThrow(/not started/);
    const t = playing(r);
    expect(() => guess(r, 'p_kit', { word: 'crane' }, t)).toThrow(/not in this game/);
    leave(r, 'p_sam', t);
    expect(() => guess(r, 'p_sam', { word: 'crane' }, t)).toThrow(/not playing/);
  });

  it('ends at the time limit, with a moment of grace for a guess in flight', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    const limit = r.phaseEndsAt!;
    expect(limit - t).toBe(TUNING.easy.timeLimitMs);
    expect(deadline(r)).toBe(limit + GRACE_MS);
    guess(r, 'p_john', { word: 'crane' }, limit + 500);
    expect(advance(r, limit + GRACE_MS - 1, half)).toBe(false);
    advance(r, limit + GRACE_MS, half);
    expect(r.phase).toBe('finished');
    expect(toWire(r, 'p_sam', limit + GRACE_MS).winnerIds).toEqual(['p_john']);
  });

  it('finishes when the last player still guessing walks out', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'crane' }, t + 1);
    leave(r, 'p_sam', t + 2);
    expect(r.phase).toBe('finished');
  });

  it('hands the host on when the host walks out mid-game', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    leave(r, 'p_john', t + 1);
    expect(r.hostId).toBe('p_sam');
    expect(r.phase).toBe('playing');
  });
});

describe('hard mode', () => {
  it('keeps greens in place and found letters in', () => {
    const rows = [{ word: 'trace', marks: mark('crane', 'trace'), at: 0 }];
    expect(hardModeViolation(rows, 'fluid')).toBe('2nd letter must be R.');
    expect(hardModeViolation(rows, 'grate')).toBe('Guess must contain C.');
    expect(hardModeViolation(rows, 'crane')).toBeNull();
  });

  it('counts a letter found twice', () => {
    const rows = [{ word: 'eerie', marks: mark('speed', 'eerie'), at: 0 }];
    expect(hardModeViolation(rows, 'ended')).toBeNull();
    expect(hardModeViolation(rows, 'extra')).toBe('Guess must contain 2 Es.');
  });

  it('applies on hard only, refusing with 400', () => {
    const r = room([], 'hard');
    const t = playing(r);
    expect(r.phaseEndsAt! - t).toBe(3 * 60_000);
    guess(r, 'p_john', { word: 'trace' }, t);
    let status = 0;
    try {
      guess(r, 'p_john', { word: 'fluid' }, t);
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(400);
    expect(r.players[0].guesses).toHaveLength(1);

    const easy = room([]);
    const t2 = playing(easy);
    guess(easy, 'p_john', { word: 'trace' }, t2);
    guess(easy, 'p_john', { word: 'fluid' }, t2);
    expect(easy.players[0].guesses).toHaveLength(2);
  });
});

describe('scoring', () => {
  it('fewest guesses wins; a tie on guesses goes to the faster solve', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_kit', name: 'Kit' },
      { id: 'p_amy', name: 'Amy' },
    ]);
    for (const id of ['p_sam', 'p_kit', 'p_amy']) join(r, id, T0);
    const t = playing(r);
    // Sam: 2 guesses at 40 s. Kit: 2 guesses at 30 s. John: 1 guess at 90 s. Amy: out.
    guess(r, 'p_sam', { word: 'trace' }, t + 10_000);
    guess(r, 'p_sam', { word: 'crane' }, t + 40_000);
    guess(r, 'p_kit', { word: 'fluid' }, t + 5_000);
    guess(r, 'p_kit', { word: 'crane' }, t + 30_000);
    for (let i = 0; i < MAX_GUESSES; i++) guess(r, 'p_amy', { word: 'fluid' }, t + i);
    guess(r, 'p_john', { word: 'crane' }, t + 90_000);
    expect(r.phase).toBe('finished');
    const w = toWire(r, 'p_sam', t + 90_000);
    expect(w.standings!.map((s) => [s.id, s.guesses, s.solveMs])).toEqual([
      ['p_john', 1, 90_000],
      ['p_kit', 2, 30_000],
      ['p_sam', 2, 40_000],
      ['p_amy', 6, null],
    ]);
    expect(w.winnerIds).toEqual(['p_john']);
    expect(w.secret).toBe('crane');
  });

  it('exact ties share, and nobody wins without solving', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'crane' }, t + 1_000);
    guess(r, 'p_sam', { word: 'crane' }, t + 1_000);
    expect(toWire(r, 'p_john', t).winnerIds).toEqual(['p_john', 'p_sam']);

    const r2 = room();
    join(r2, 'p_sam', T0);
    const t2 = playing(r2);
    advance(r2, t2 + TUNING.easy.timeLimitMs + GRACE_MS, half);
    expect(r2.phase).toBe('finished');
    expect(toWire(r2, 'p_john', t2).winnerIds).toEqual([]);
  });

  it('solo: the result is your guesses and time, and nobody wins alone', () => {
    const r = room([]);
    const t = playing(r);
    guess(r, 'p_john', { word: 'trace' }, t + 10_000);
    guess(r, 'p_john', { word: 'crane' }, t + 25_000);
    expect(r.phase).toBe('finished');
    const w = toWire(r, 'p_john', t + 25_000);
    expect(w.standings).toEqual([{ id: 'p_john', name: 'John', solved: true, guesses: 2, solveMs: 25_000 }]);
    expect(w.winnerIds).toEqual([]);
  });
});

describe('again', () => {
  it('re-invites everyone who is not still here and clears the boards', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_kit', name: 'Kit' },
    ]);
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'crane' }, t);
    expect(() => again(r, 'p_john', t)).toThrow(/still going/);
    guess(r, 'p_sam', { word: 'crane' }, t);
    expect(() => again(r, 'p_sam', t)).toThrow(/Only the host/);
    again(r, 'p_john', t);
    expect(r.phase).toBe('lobby');
    expect(r.secret).toBeNull();
    expect(r.players.map((p) => [p.id, p.status, p.guesses.length, p.solveMs])).toEqual([
      ['p_john', 'joined', 0, null],
      ['p_sam', 'joined', 0, null],
      ['p_kit', 'invited', 0, null],
    ]);
  });
});

describe('the wire', () => {
  it('shows my letters, only colours for everyone else, and no secret while playing', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'trace' }, t);
    guess(r, 'p_sam', { word: 'crank' }, t);
    const w = toWire(r, 'p_john', t);
    expect(w.secret).toBeNull();
    expect(w.players[0].rows).toEqual([{ word: 'trace', marks: [X, G, G, Y, G] }]);
    expect(w.players[1].rows).toEqual([{ word: null, marks: [G, G, G, G, X] }]);
    expect(w.players[1].guessCount).toBe(1);
    expect(w.keyboard).toEqual({ t: X, r: G, a: G, c: Y, e: G });
    expect(w.standings).toBeNull();
    expect(JSON.stringify(w)).not.toContain('crank');
    expect(JSON.stringify(w)).not.toContain('crane');
    expect(JSON.stringify(toWire(r, 'p_sam', t))).not.toContain('trace');
  });

  it('reveals every row and the secret once the game is finished', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = playing(r);
    guess(r, 'p_john', { word: 'crane' }, t);
    guess(r, 'p_sam', { word: 'crank' }, t);
    advance(r, deadline(r)!, half);
    const w = toWire(r, 'p_john', t);
    expect(w.phase).toBe('finished');
    expect(w.secret).toBe('crane');
    expect(w.players[1].rows[0].word).toBe('crank');
  });

  it('upgrades a key only to a better mark', () => {
    expect(
      keyboard([
        { word: 'eerie', marks: mark('speed', 'eerie'), at: 0 },
        { word: 'speed', marks: mark('speed', 'speed'), at: 0 },
      ]).e,
    ).toBe(G);
  });
});
