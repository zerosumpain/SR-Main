import { describe, expect, it } from 'vitest';
import {
  advance,
  again,
  attempt,
  createRoom,
  decline,
  deadline,
  join,
  leave,
  start,
  toWire,
  winners,
  COUNTDOWN_MS,
  FINISHED_MS,
  GAP_MS,
  GRACE_MS,
  LOBBY_MS,
  MAX_LENGTH,
  RESULT_MS,
  SHOW_LEAD_MS,
  START_LENGTH,
  TUNING,
  type Difficulty,
  type Room,
} from './sequence-memory';

const T0 = 1_790_000_000_000;

/** A repeatable rng cycling through the given values. */
function cycle(...xs: number[]) {
  let i = 0;
  return () => xs[i++ % xs.length];
}

const SAM = { id: 'p_sam', name: 'Sam' };
const AMY = { id: 'p_amy', name: 'Amy' };

function room(invite = [SAM], difficulty: Difficulty = 'easy'): Room {
  const r = createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty, now: T0 });
  for (const p of invite) join(r, p.id, T0);
  return r;
}

/** Start and run the countdown down to round 1's show. Returns now. */
function begin(r: Room, rng = cycle(0.1, 0.3, 0.6, 0.9)): number {
  start(r, 'p_john', T0);
  advance(r, T0 + COUNTDOWN_MS, rng);
  return T0 + COUNTDOWN_MS;
}

const seq = (r: Room) => r.round!.steps.map((s) => s.tile);

/** Move from show into input. */
function toInput(r: Room): number {
  const t = r.round!.inputAt;
  advance(r, t, Math.random);
  return t;
}

/** Everyone listed answers right, the rest miss; then the result runs out into the next round. */
function survive(r: Room, ids: string[], rng = cycle(0.5)): void {
  const t = toInput(r);
  for (const id of ids) attempt(r, id, { round: r.round!.number, taps: seq(r) }, t + 10);
  if (r.phase === 'input') advance(r, deadline(r)!, rng);
  advance(r, deadline(r)!, rng);
}

describe('lobby', () => {
  it('seats the host and invites the rest once each; lobby verbs match Tap Duel', () => {
    const r = createRoom({
      id: 'g_1',
      host: { id: 'p_john', name: 'John' },
      invite: [SAM, SAM, { id: 'p_john', name: 'John' }, AMY],
      difficulty: 'medium',
      now: T0,
    });
    expect(r.players.map((p) => [p.id, p.status])).toEqual([
      ['p_john', 'joined'],
      ['p_sam', 'invited'],
      ['p_amy', 'invited'],
    ]);
    expect(r.tiles).toBe(6);
    expect(r.phaseEndsAt).toBe(T0 + LOBBY_MS);
    decline(r, 'p_amy', T0);
    expect(r.players[2].status).toBe('declined');
    expect(() => start(r, 'p_sam', T0)).toThrow(/Only the host/);
    start(r, 'p_john', T0);
    expect(r.players[1].status).toBe('declined');
    expect(() => join(r, 'p_sam', T0)).toThrow(/already started/);
  });

  it('refuses a sixth player', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, name: x }));
    expect(() => room(five)).toThrow(/Up to 5/);
  });

  it('the host leaving the lobby cancels; an idle lobby closes', () => {
    const r = room();
    leave(r, 'p_john', T0);
    expect(r.phase).toBe('closed');
    const idle = room();
    advance(idle, T0 + LOBBY_MS, Math.random);
    expect(idle.phase).toBe('closed');
  });

  it('refuses a clock that is not a number', () => {
    const r = room();
    expect(advance(r, NaN, Math.random)).toBe(false);
    expect(r.phase).toBe('lobby');
  });

  it('tile counts by difficulty', () => {
    expect([TUNING.easy.tiles, TUNING.medium.tiles, TUNING.hard.tiles]).toEqual([4, 6, 9]);
  });
});

describe('the sequence', () => {
  it('starts at three and the SAME sequence grows by one each round', () => {
    const r = room([]);
    begin(r, cycle(0.1, 0.3, 0.6));
    expect(r.phase).toBe('show');
    expect(r.round!.number).toBe(1);
    const first = seq(r);
    expect(first).toEqual([0, 1, 2]);
    survive(r, ['p_john'], cycle(0.9));
    expect(r.round!.number).toBe(2);
    expect(seq(r)).toEqual([...first, 3]);
    const second = seq(r);
    survive(r, ['p_john'], cycle(0.0));
    expect(seq(r)).toEqual([...second, 0]);
    expect(r.round!.length).toBe(START_LENGTH + 2);
  });

  it('never deals a tile off the grid, even when the rng returns 1', () => {
    const r = room([], 'hard');
    begin(r, cycle(1, 0.999, 0));
    expect(seq(r)).toEqual([8, 8, 0]);
  });
});

describe('sync timing', () => {
  it('fixes every flash ahead, by difficulty, and opens input when the last ends', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const r = room([], d);
      const now = begin(r);
      const { stepMs } = TUNING[d];
      const rd = r.round!;
      expect(rd.showAt).toBe(now + SHOW_LEAD_MS);
      expect(rd.stepMs).toBe(stepMs);
      expect(rd.gapMs).toBe(GAP_MS);
      expect(rd.steps.map((s) => s.at)).toEqual([0, 1, 2].map((i) => rd.showAt + i * (stepMs + GAP_MS)));
      expect(rd.steps.every((s) => s.ms === stepMs)).toBe(true);
      expect(rd.inputAt).toBe(rd.showAt + 3 * stepMs + 2 * GAP_MS);
      expect(rd.windowMs).toBe(2_000 + 800 * 3);
      expect(rd.inputEndsAt).toBe(rd.inputAt + rd.windowMs);
      expect(rd.closesAt).toBe(rd.inputEndsAt + GRACE_MS);
      expect(r.phaseEndsAt).toBe(rd.inputAt);
      expect(deadline(r)).toBe(rd.inputAt);
    }
  });

  it('show → input at inputAt; the phone counts to the window end, the room waits out grace', () => {
    const r = room([]);
    begin(r);
    toInput(r);
    expect(r.phase).toBe('input');
    expect(r.phaseEndsAt).toBe(r.round!.inputEndsAt);
    expect(deadline(r)).toBe(r.round!.closesAt);
    advance(r, r.round!.inputEndsAt, Math.random);
    expect(r.phase).toBe('input');
  });

  it('the window grows with the length', () => {
    const r = room([]);
    begin(r);
    survive(r, ['p_john']);
    expect(r.round!.windowMs).toBe(2_000 + 800 * 4);
  });
});

describe('attempts', () => {
  it('a right attempt survives; a wrong one is out; a missing one is out at the close', () => {
    const r = room([SAM, AMY]);
    begin(r);
    const t = toInput(r);
    const s = seq(r);
    attempt(r, 'p_john', { round: 1, taps: s }, t + 100);
    attempt(r, 'p_sam', { round: 1, taps: [s[0], s[1], (s[2] + 1) % 4] }, t + 200);
    expect(r.phase).toBe('input');
    advance(r, r.round!.closesAt, Math.random);
    expect(r.phase).toBe('result');
    expect(r.phaseEndsAt).toBe(r.round!.closesAt + RESULT_MS);
    const by = Object.fromEntries(r.players.map((p) => [p.id, p]));
    expect(by.p_john).toMatchObject({ alive: true, best: 3, roundsSurvived: 1, outRound: null });
    expect(by.p_sam).toMatchObject({ alive: false, best: 0, outRound: 1 });
    expect(by.p_amy).toMatchObject({ alive: false, best: 0, outRound: 1 });
    expect(r.round!.attempts.find((a) => a.playerId === 'p_amy')).toEqual({ playerId: 'p_amy', taps: null, correct: false });
  });

  it('a short attempt is wrong; a long one or an off-grid tile is refused', () => {
    const r = room([]);
    begin(r);
    const t = toInput(r);
    expect(() => attempt(r, 'p_john', { round: 1, taps: [0, 0, 0, 0] }, t)).toThrow(/up to 3/);
    expect(() => attempt(r, 'p_john', { round: 1, taps: [0, 4] }, t)).toThrow(/Tiles are 0 to 3/);
    expect(() => attempt(r, 'p_john', { round: 1, taps: 'abc' }, t)).toThrow(/up to 3/);
    attempt(r, 'p_john', { round: 1, taps: seq(r).slice(0, 2) }, t);
    expect(r.players[0]).toMatchObject({ alive: false, outRound: 1 });
  });

  it('refuses the wrong round, after the close, strangers, and players already out; ignores a repeat', () => {
    const r = room([SAM]);
    begin(r);
    const t = toInput(r);
    expect(() => attempt(r, 'p_john', { round: 2, taps: [] }, t)).toThrow(/round is over/);
    expect(() => attempt(r, 'p_x', { round: 1, taps: [] }, t)).toThrow(/not in this game/);
    expect(() => attempt(r, 'p_john', { round: 1, taps: seq(r) }, r.round!.closesAt + 1)).toThrow(/round is over/);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, t);
    attempt(r, 'p_john', { round: 1, taps: [] }, t);
    expect(r.round!.attempts).toHaveLength(1);
    attempt(r, 'p_sam', { round: 1, taps: [] }, t);
    advance(r, r.phaseEndsAt!, cycle(0.5));
    expect(r.phase).toBe('show');
    expect(() => attempt(r, 'p_sam', { round: 2, taps: [] }, r.round!.inputAt)).toThrow(/out of this game/);
  });

  it('closes early once every alive player has answered', () => {
    const r = room([SAM]);
    begin(r);
    const t = toInput(r);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, t + 50);
    expect(r.phase).toBe('input');
    attempt(r, 'p_sam', { round: 1, taps: seq(r) }, t + 90);
    expect(r.phase).toBe('result');
    expect(r.phaseEndsAt).toBe(t + 90 + RESULT_MS);
  });

  it('players already out are not waited for', () => {
    const r = room([SAM]);
    begin(r);
    let t = toInput(r);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, t);
    attempt(r, 'p_sam', { round: 1, taps: [] }, t);
    advance(r, r.phaseEndsAt!, cycle(0.5));
    t = toInput(r);
    attempt(r, 'p_john', { round: 2, taps: seq(r) }, t);
    expect(r.phase).toBe('result');
  });

  it('an attempt may land during the show (it can only hold what was seen)', () => {
    const r = room([]);
    begin(r);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, r.round!.inputAt - 1);
    expect(r.phase).toBe('result');
  });
});

describe('the end', () => {
  it('last standing wins, and plays on alone until they go out', () => {
    const r = room([SAM]);
    begin(r);
    survive(r, ['p_john', 'p_sam']); // round 1: both
    survive(r, ['p_john']); // round 2: Sam misses
    expect(r.phase).toBe('show');
    expect(r.round!.number).toBe(3);
    survive(r, ['p_john']); // round 3
    const t = toInput(r);
    attempt(r, 'p_john', { round: 4, taps: [] }, t); // round 4: John goes out
    advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('finished');
    expect(r.phaseEndsAt).toBe(t + RESULT_MS + FINISHED_MS);
    expect(winners(r)).toEqual(['p_john']);
    const w = toWire(r, 'p_sam', t);
    expect(w.winnerIds).toEqual(['p_john']);
    expect(w.standings).toEqual([
      { id: 'p_john', name: 'John', best: 5, roundsSurvived: 3, outRound: 4 },
      { id: 'p_sam', name: 'Sam', best: 3, roundsSurvived: 1, outRound: 2 },
    ]);
    advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('closed');
  });

  it('everyone out in the same round shares the win', () => {
    const r = room([SAM, AMY]);
    begin(r);
    survive(r, ['p_john', 'p_sam']); // Amy out in round 1
    const t = toInput(r);
    attempt(r, 'p_john', { round: 2, taps: [] }, t);
    attempt(r, 'p_sam', { round: 2, taps: [0] }, t);
    advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('finished');
    expect(winners(r).sort()).toEqual(['p_john', 'p_sam']);
  });

  it('everyone out in round 1 wins nothing', () => {
    const r = room([SAM]);
    begin(r);
    advance(r, r.round!.closesAt, Math.random);
    advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('finished');
    expect(winners(r)).toEqual([]);
  });

  it('solo: the result is the best length, nobody "wins"', () => {
    const r = room([]);
    begin(r);
    survive(r, ['p_john']);
    survive(r, ['p_john']);
    advance(r, r.round!.closesAt, Math.random);
    advance(r, r.phaseEndsAt!, Math.random);
    const w = toWire(r, 'p_john', T0);
    expect(w.phase).toBe('finished');
    expect(w.winnerIds).toEqual([]);
    expect(w.standings).toEqual([{ id: 'p_john', name: 'John', best: 4, roundsSurvived: 2, outRound: 3 }]);
  });

  it(`stops at length ${MAX_LENGTH}; everyone still alive shares the win`, () => {
    const r = room([SAM, AMY]);
    begin(r);
    survive(r, ['p_john', 'p_sam']); // Amy out
    while (r.phase === 'show') survive(r, ['p_john', 'p_sam']);
    expect(r.phase).toBe('finished');
    expect(r.round!.length).toBe(MAX_LENGTH);
    expect(r.round!.number).toBe(MAX_LENGTH - START_LENGTH + 1);
    expect(r.sequence).toHaveLength(MAX_LENGTH);
    expect(winners(r).sort()).toEqual(['p_john', 'p_sam']);
    expect(r.players.find((p) => p.id === 'p_john')!.best).toBe(MAX_LENGTH);
  });

  it('a player who leaves mid-round goes out, the round may close on it, and they cannot win', () => {
    const r = room([SAM]);
    begin(r);
    const t = toInput(r);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, t);
    leave(r, 'p_sam', t + 5);
    expect(r.phase).toBe('result');
    expect(r.players[1]).toMatchObject({ status: 'left', alive: false, outRound: 1 });
    advance(r, r.phaseEndsAt!, cycle(0.5));
    advance(r, r.round!.closesAt, Math.random);
    advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('finished');
    expect(winners(r)).toEqual(['p_john']);
  });

  it('the host leaving mid-game hands over; the last one out closes', () => {
    const r = room([SAM]);
    begin(r);
    leave(r, 'p_john', T0 + COUNTDOWN_MS + 1);
    expect(r.hostId).toBe('p_sam');
    leave(r, 'p_sam', T0 + COUNTDOWN_MS + 2);
    expect(r.phase).toBe('closed');
  });

  it('again resets to a lobby with a fresh sequence', () => {
    const r = room([SAM]);
    begin(r);
    advance(r, r.round!.closesAt, Math.random);
    advance(r, r.phaseEndsAt!, Math.random);
    expect(() => again(r, 'p_sam', T0)).toThrow(/Only the host/);
    again(r, 'p_john', T0 + 1);
    expect(r.phase).toBe('lobby');
    expect(r.sequence).toEqual([]);
    expect(r.round).toBeNull();
    expect(r.players.every((p) => !p.playing && p.best === 0 && p.outRound === null)).toBe(true);
    begin(r);
    expect(r.players.every((p) => p.alive)).toBe(true);
  });
});

describe('toWire', () => {
  it('sends the sequence during show, hides it during input, reveals it at the result', () => {
    const r = room([SAM]);
    begin(r);
    const show = toWire(r, 'p_sam', T0);
    expect(show.round!.steps).toEqual(r.round!.steps);
    expect(show.round!.length).toBe(3);

    const t = toInput(r);
    attempt(r, 'p_john', { round: 1, taps: seq(r) }, t);
    const input = toWire(r, 'p_sam', t);
    expect(input.phase).toBe('input');
    expect(input.round!.steps).toBeNull();
    expect(input.round!.length).toBe(3);
    expect(input.round!.answeredIds).toEqual(['p_john']);
    expect(input.round!.attempts).toBeNull();
    expect(input.round!.survivorIds).toBeNull();
    // Nothing anywhere on the wire carries the tiles during input.
    const json = JSON.stringify(input);
    expect(json).not.toMatch(/"tile"/);
    expect(json).not.toMatch(/"taps"/);
    expect(json).not.toMatch(/"sequence"/);

    attempt(r, 'p_sam', { round: 1, taps: [] }, t + 1);
    const result = toWire(r, 'p_sam', t + 1);
    expect(result.phase).toBe('result');
    expect(result.round!.steps).toEqual(r.round!.steps);
    expect(result.round!.survivorIds).toEqual(['p_john']);
    expect(result.round!.attempts).toEqual([
      { playerId: 'p_john', taps: seq(r), correct: true },
      { playerId: 'p_sam', taps: [], correct: false },
    ]);
    expect(result.standings).toBeNull();
    expect(result.winnerIds).toEqual([]);
  });

  it('carries the room frame', () => {
    const r = room([SAM], 'hard');
    const w = toWire(r, 'p_sam', T0 + 5);
    expect(w).toMatchObject({
      id: 'g_1',
      game: 'sequence-memory',
      difficulty: 'hard',
      phase: 'lobby',
      hostId: 'p_john',
      meId: 'p_sam',
      tiles: 9,
      startLength: 3,
      maxLength: 20,
      round: null,
      phaseEndsAt: T0 + LOBBY_MS,
      serverNow: T0 + 5,
    });
    expect(w.players[0]).toEqual({
      id: 'p_john',
      name: 'John',
      status: 'joined',
      isHost: true,
      playing: false,
      alive: false,
      best: 0,
      roundsSurvived: 0,
      outRound: null,
    });
  });
});
