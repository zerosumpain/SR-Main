import { describe, expect, it } from 'vitest';
import {
  advance,
  AIM_MS,
  COUNTDOWN_MS,
  craneX,
  createRoom,
  drop,
  itemFor,
  ITEMS,
  join,
  report,
  REPORT_MS,
  SCREEN_ACTOR,
  start,
  TOPPLED_MS,
  type Room,
} from './biscuit-tower';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

function room(): Room {
  const r = createRoom({ id: 'g_1', host: { id: 'p_a', name: 'Ann' }, invite: [{ id: 'v_b', name: 'Bob' }], difficulty: 'medium', now: T0 });
  join(r, 'v_b', T0);
  start(r, 'p_a', T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  return r;
}

describe('the crane', () => {
  it('swings from the middle, right first, and back', () => {
    expect(craneX(0, 0, 2000)).toBeCloseTo(0);
    expect(craneX(500, 0, 2000)).toBeCloseTo(1);
    expect(craneX(1500, 0, 2000)).toBeCloseTo(-1);
  });
});

describe('a turn', () => {
  it('opens on the first player, and only they may drop', () => {
    const r = room();
    expect(r.phase).toBe('aiming');
    expect(r.turn?.playerId).toBe('p_a');
    expect(() => drop(r, 'v_b', { turn: 1, at: T0 + COUNTDOWN_MS + 100 }, T0 + COUNTDOWN_MS + 100)).toThrow(/not your turn/u);
    drop(r, 'p_a', { turn: 1, at: T0 + COUNTDOWN_MS + 100 }, T0 + COUNTDOWN_MS + 120);
    expect(r.phase).toBe('falling');
    expect(r.drops).toHaveLength(1);
  });

  it('only the TV reports; a settled drop scores and passes the turn on', () => {
    const r = room();
    const now = T0 + COUNTDOWN_MS + 200;
    drop(r, 'p_a', { turn: 1, at: now }, now);
    expect(() => report(r, 'p_a', { turn: 1, outcome: 'settled', height: 1 }, now)).toThrow(/Only the TV/u);
    report(r, SCREEN_ACTOR, { turn: 1, outcome: 'settled', height: 1.2 }, now + 2000, half);
    expect(r.players[0].score).toBe(1);
    expect(r.best).toEqual({ height: 1.2, playerId: 'p_a' });
    expect(r.turn?.playerId).toBe('v_b');
  });

  it('a topple ends the round; three rounds end the game', () => {
    const r = room();
    let now = T0 + COUNTDOWN_MS;
    for (let round = 1; round <= 3; round++) {
      const t = r.turn!;
      drop(r, t.playerId, { turn: t.number, at: now + 100 }, now + 100);
      report(r, SCREEN_ACTOR, { turn: t.number, outcome: 'toppled', height: 0 }, now + 1000, half);
      if (round < 3) {
        expect(r.phase).toBe('toppled');
        now += 1000 + TOPPLED_MS;
        advance(r, now, half);
        expect(r.round).toBe(round + 1);
        expect(r.drops).toHaveLength(0);
      }
    }
    expect(r.phase).toBe('finished');
  });

  it('nobody tapping drops it anyway, and a silent TV counts it as settled', () => {
    const r = room();
    const start = T0 + COUNTDOWN_MS;
    advance(r, start + AIM_MS, half);
    expect(r.phase).toBe('falling');
    advance(r, start + AIM_MS + REPORT_MS, half);
    expect(r.phase).toBe('aiming');
    expect(r.players[0].score).toBe(1);
  });
});

describe('items', () => {
  it('start as biscuits and get awkward as the tower grows', () => {
    expect(ITEMS[itemFor(0, 'medium', Math.random)].hard).toBe(0);
    const late = new Set(Array.from({ length: 200 }, () => ITEMS[itemFor(30, 'medium', Math.random)].hard));
    expect(late.has(2)).toBe(true);
  });
});
