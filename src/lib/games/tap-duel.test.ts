import { describe, expect, it } from 'vitest';
import {
  advance,
  again,
  createRoom,
  dealRound,
  decline,
  deadline,
  join,
  leave,
  start,
  tap,
  toWire,
  COUNTDOWN_MS,
  LOBBY_MS,
  RESULT_MS,
  ROUNDS,
  TUNING,
  type Room,
} from './tap-duel';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

function room(invite = [{ id: 'p_sam', name: 'Sam' }]): Room {
  return createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty: 'easy', now: T0 });
}

/** Start, and run the countdown down to round 1 armed. */
function armed(r: Room): number {
  start(r, 'p_john', T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  return T0 + COUNTDOWN_MS;
}

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
  });

  it('refuses a sixth player', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, name: x }));
    expect(() => room(five)).toThrow(/Up to 5/);
  });

  it('only the host starts, and unanswered invites lapse', () => {
    const r = room();
    expect(() => start(r, 'p_sam', T0)).toThrow(/Only the host/);
    start(r, 'p_john', T0);
    expect(r.phase).toBe('countdown');
    expect(r.players[1].status).toBe('declined');
    expect(() => join(r, 'p_sam', T0)).toThrow(/already started/);
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

describe('rounds', () => {
  it('deals green inside the difficulty window, decoys clear of it', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 0; seed < 50; seed++) {
        let s = seed / 50;
        const rng = () => (s = (s * 9301 + 0.49297) % 1);
        const r = dealRound(1, d, T0, rng);
        const [lo, hi] = TUNING[d].waitMs;
        expect(r.goAt - T0).toBeGreaterThanOrEqual(lo);
        expect(r.goAt - T0).toBeLessThanOrEqual(hi);
        expect(r.closesAt).toBe(r.goAt + TUNING[d].windowMs + 1_000);
        for (const x of r.decoys) {
          expect(x.at).toBeGreaterThan(T0);
          expect(x.at + x.ms).toBeLessThan(r.goAt);
        }
        if (d === 'easy') expect(r.decoys).toEqual([]);
      }
    }
  });

  it('settles as soon as everyone answers, fastest valid tap winning', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = armed(r);
    expect(r.phase).toBe('armed');
    tap(r, 'p_john', { round: 1, reactionMs: 310, early: false }, t + 2_500);
    expect(r.phase).toBe('armed');
    tap(r, 'p_sam', { round: 1, reactionMs: 240.4, early: false }, t + 2_500);
    expect(r.phase).toBe('result');
    expect(r.round!.winnerId).toBe('p_sam');
    expect(r.players.find((p) => p.id === 'p_sam')!.score).toBe(1);
    expect(r.round!.responses[1].reactionMs).toBe(240);
  });

  it('scores guesses as false starts and slow taps as misses', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_kit', name: 'Kit' },
    ]);
    join(r, 'p_sam', T0);
    join(r, 'p_kit', T0);
    const t = armed(r);
    tap(r, 'p_john', { round: 1, reactionMs: 60, early: false }, t);
    tap(r, 'p_sam', { round: 1, reactionMs: null, early: true }, t);
    tap(r, 'p_kit', { round: 1, reactionMs: 9_000, early: false }, t);
    expect(r.round!.responses).toEqual([
      { playerId: 'p_john', reactionMs: null, early: true },
      { playerId: 'p_sam', reactionMs: null, early: true },
      { playerId: 'p_kit', reactionMs: null, early: false },
    ]);
    expect(r.round!.winnerId).toBeNull();
    expect(r.players.map((p) => p.falseStarts)).toEqual([1, 1, 0]);
  });

  it('closes a round nobody finishes at its deadline', () => {
    const r = room();
    join(r, 'p_sam', T0);
    armed(r);
    tap(r, 'p_john', { round: 1, reactionMs: 300, early: false }, r.round!.goAt + 300);
    const due = deadline(r)!;
    expect(advance(r, due - 1, half)).toBe(false);
    advance(r, due, half);
    expect(r.phase).toBe('result');
    expect(r.round!.winnerId).toBe('p_john');
  });

  it('refuses a tap for another round, and counts only the first', () => {
    const r = room();
    const t = armed(r);
    expect(() => tap(r, 'p_john', { round: 2, reactionMs: 300, early: false }, t)).toThrow(/round is over/);
    tap(r, 'p_john', { round: 1, reactionMs: 300, early: false }, t);
    expect(() => tap(r, 'p_john', { round: 1, reactionMs: 200, early: false }, t)).toThrow(/round is over/);
  });

  it('plays five rounds to a finish, solo', () => {
    const r = room([]);
    let t = armed(r);
    for (let n = 1; n <= ROUNDS; n++) {
      tap(r, 'p_john', { round: n, reactionMs: 200 + n, early: false }, t);
      t += RESULT_MS;
      advance(r, t, half);
    }
    expect(r.phase).toBe('finished');
    const w = toWire(r, 'p_john', t);
    expect(w.standings).toEqual([{ id: 'p_john', name: 'John', score: 5, bestMs: 201, avgMs: 203, falseStarts: 0 }]);
    // Nobody wins alone.
    expect(w.winnerIds).toEqual([]);
  });

  it('ranks by rounds won and names the winner', () => {
    const r = room();
    join(r, 'p_sam', T0);
    let t = armed(r);
    const plan: [number, number][] = [
      [200, 300],
      [300, 200],
      [200, 300],
      [300, 290],
      [900, 250],
    ];
    for (let n = 1; n <= ROUNDS; n++) {
      const [john, sam] = plan[n - 1];
      tap(r, 'p_john', { round: n, reactionMs: Math.min(john, 2_000), early: false }, t);
      tap(r, 'p_sam', { round: n, reactionMs: sam, early: false }, t);
      t += RESULT_MS;
      advance(r, t, half);
    }
    const w = toWire(r, 'p_john', t);
    expect(w.standings!.map((s) => [s.id, s.score])).toEqual([
      ['p_sam', 3],
      ['p_john', 2],
    ]);
    expect(w.winnerIds).toEqual(['p_sam']);
  });

  it('hands the host on when the host walks out mid-game', () => {
    const r = room();
    join(r, 'p_sam', T0);
    armed(r);
    leave(r, 'p_john', T0 + 4_000);
    expect(r.hostId).toBe('p_sam');
    expect(r.phase).toBe('armed');
  });
});

describe('again', () => {
  it('re-invites everyone who is not still here', () => {
    const r = room([
      { id: 'p_sam', name: 'Sam' },
      { id: 'p_kit', name: 'Kit' },
    ]);
    join(r, 'p_sam', T0);
    let t = armed(r);
    for (let n = 1; n <= ROUNDS; n++) {
      tap(r, 'p_john', { round: n, reactionMs: 250, early: false }, t);
      tap(r, 'p_sam', { round: n, reactionMs: 260, early: false }, t);
      t += RESULT_MS;
      advance(r, t, half);
    }
    expect(() => again(r, 'p_sam', t)).toThrow(/Only the host/);
    again(r, 'p_john', t);
    expect(r.phase).toBe('lobby');
    expect(r.players.map((p) => [p.id, p.status, p.score])).toEqual([
      ['p_john', 'joined', 0],
      ['p_sam', 'joined', 0],
      ['p_kit', 'invited', 0],
    ]);
  });
});

describe('the wire', () => {
  it('hides reaction times and the winner until the round settles', () => {
    const r = room();
    join(r, 'p_sam', T0);
    const t = armed(r);
    tap(r, 'p_sam', { round: 1, reactionMs: 250, early: false }, t);
    const w = toWire(r, 'p_john', t);
    expect(w.round!.responses).toEqual([{ playerId: 'p_sam', reactionMs: null, early: false }]);
    expect(w.round!.winnerId).toBeNull();
    expect(w.meId).toBe('p_john');
    expect(w.players[0].isHost).toBe(true);
    expect(w.serverNow).toBe(t);
  });
});
