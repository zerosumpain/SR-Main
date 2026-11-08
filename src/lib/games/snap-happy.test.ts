import { describe, expect, it } from 'vitest';
import {
  advance,
  COUNTDOWN_MS,
  createRoom,
  dealRound,
  join,
  snap,
  start,
  toScreen,
  toWire,
  TUNING,
  ROUNDS,
  PICTURES,
  type Room,
} from './snap-happy';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

function room(): Room {
  const r = createRoom({ id: 'g_1', host: { id: 'p_a', name: 'Ann' }, invite: [{ id: 'p_b', name: 'Bob' }, { id: 'v_c', name: 'Cat' }], difficulty: 'medium', now: T0 });
  join(r, 'p_b', T0);
  join(r, 'v_c', T0);
  start(r, 'p_a', T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  return r;
}

describe('a round', () => {
  it('shows the target once, after at least the fewest flips, with a tail after it', () => {
    for (let i = 0; i < 50; i++) {
      const r = dealRound(1, 'hard', [], T0, Math.random);
      const at = r.flips.findIndex((f) => f.pic === r.target);
      expect(r.flips.filter((f) => f.pic === r.target)).toHaveLength(1);
      expect(at).toBeGreaterThanOrEqual(TUNING.hard.before[0]);
      expect(r.flips.length - at - 1).toBe(2);
      expect(r.flips[at].at).toBe(r.goAt);
    }
  });

  it('never repeats a target already used in the game', () => {
    const used = Object.keys(PICTURES).slice(1) as (keyof typeof PICTURES)[];
    expect(dealRound(1, 'easy', used, T0, Math.random).target).toBe(Object.keys(PICTURES)[0]);
  });
});

describe('snapping', () => {
  it('fastest right snap scores three, then two, then one; early costs a point', () => {
    const r = room();
    const g = r.round!.goAt;
    snap(r, 'p_b', { round: 1, at: g + 400 }, g + 450);
    snap(r, 'p_a', { round: 1, at: g + 250 }, g + 460);
    snap(r, 'v_c', { round: 1, at: g - 300 }, g + 470);
    expect(r.phase).toBe('result');
    const pts = Object.fromEntries(r.round!.snaps.map((s) => [s.playerId, s.points]));
    expect(pts).toEqual({ p_a: 3, p_b: 2, v_c: -1 });
    expect(r.players.find((p) => p.id === 'v_c')!.score).toBe(0);
  });

  it('a snap faster than anybody can see is early; past the window is a miss', () => {
    const r = room();
    const g = r.round!.goAt;
    snap(r, 'p_a', { round: 1, at: g + 50 }, g + 60);
    snap(r, 'p_b', { round: 1, at: g + TUNING.medium.windowMs + 100 }, g + TUNING.medium.windowMs + 120);
    const [a, b] = r.round!.snaps;
    expect(a.early).toBe(true);
    expect(b.reactionMs).toBeNull();
    expect(b.early).toBe(false);
  });

  it('a phone clock that is wildly off is not believed', () => {
    const r = room();
    const now = r.round!.goAt + 300;
    snap(r, 'p_a', { round: 1, at: now - 60_000 }, now);
    expect(r.round!.snaps[0].reactionMs).toBe(300);
  });

  it('refuses a snap before the pictures start, and for another round', () => {
    const r = room();
    expect(() => snap(r, 'p_a', { round: 1, at: T0 }, r.round!.startsAt - 100)).toThrow(/Wait/u);
    expect(() => snap(r, 'p_a', { round: 2, at: r.round!.goAt + 200 }, r.round!.goAt + 200)).toThrow(/over/u);
  });

  it('a round nobody finishes settles on its clock, and the game ends after eight', () => {
    const r = room();
    let now = T0 + COUNTDOWN_MS;
    for (let i = 0; i < ROUNDS * 3 && r.phase !== 'finished'; i++) {
      now += 30_000;
      advance(r, now, half);
    }
    expect(r.phase).toBe('finished');
    expect(r.used).toHaveLength(ROUNDS);
  });
});

describe('the wires', () => {
  it('the phone never sees the run or when the target comes while the round is live', () => {
    const r = room();
    const w = toWire(r, 'p_a', r.round!.startsAt);
    expect(w.round?.goAt).toBeNull();
    expect(JSON.stringify(w)).not.toContain('"flips"');
    const s = toScreen(r, r.round!.startsAt);
    expect(s.round?.flips.length).toBeGreaterThan(3);
  });
});
