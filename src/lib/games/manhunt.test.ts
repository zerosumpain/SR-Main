import { describe, expect, it } from 'vitest';
import {
  CATCH_COOLDOWN_MS,
  CATCH_M,
  CLAIM_MS,
  COUNTDOWN_MS,
  FINISHED_MS,
  FIX_MIN_GAP_MS,
  HEADSTART_MS,
  OUTSIDE_LIVE_MS,
  PING_MS,
  RUNNER_QUIET_MS,
  about,
  advance,
  again,
  claimCatch,
  confirmCatch,
  createRoom,
  deadline,
  distanceM,
  isOutside,
  join,
  leave,
  maxPlayers,
  minutesFrom,
  nextPingAt,
  pickRunner,
  position,
  radiusFrom,
  setArea,
  standings,
  start,
  toWire,
  winners,
  withinCatch,
  type Difficulty,
  type Fix,
  type Room,
} from './manhunt';
import { GAMES } from './catalogue';
import { roundRows } from './results';

const T0 = 1_790_000_000_000;
const JOHN = { id: 'p_john', name: 'John' };
const SAM = { id: 'p_sam', name: 'Sam' };
const KIM = { id: 'p_kim', name: 'Kim' };
const ROB = { id: 'p_rob', name: 'Rob' };

/** The circle's centre. Every test position is a distinctive offset from it. */
const C = { lat: 51.5, lng: -0.12 };
const M_PER_DEG_LAT = 111_195;
/** A point `n` metres north and `e` metres east of the centre. */
function at(n: number, e = 0): { lat: number; lng: number } {
  const lat = C.lat + n / M_PER_DEG_LAT;
  const lng = C.lng + e / (M_PER_DEG_LAT * Math.cos((C.lat * Math.PI) / 180));
  return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
}

function room(difficulty: Difficulty = 'medium', options: Record<string, unknown> = {}): Room {
  return createRoom({
    id: 'g_1',
    host: JOHN,
    invite: [SAM, KIM, ROB],
    difficulty,
    options: { ...C, radius: 500, minutes: 30, ...options },
    now: T0,
  });
}

/** Everyone joins, Sam is picked to run, the host starts and the 3-2-1 runs. Returns the head start's start. */
function headStart(r: Room): number {
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  pickRunner(r, JOHN.id, { playerId: SAM.id }, T0);
  start(r, JOHN.id, T0);
  advance(r, T0 + COUNTDOWN_MS, () => 0.99);
  return T0 + COUNTDOWN_MS;
}

/** Into the hunt itself. Returns its start. */
function hunting(r: Room): number {
  const t = headStart(r) + HEADSTART_MS;
  advance(r, t, () => 0.5);
  return t;
}

const send = (r: Room, id: string, where: { lat: number; lng: number }, now: number, accuracy = 5) =>
  position(r, id, { ...where, accuracy, at: now }, now);

/** The wire as `id` sees it, as the JSON a phone receives. */
const json = (r: Room, id: string, now: number) => JSON.stringify(toWire(r, id, now));
/** A coordinate as it would appear in that JSON. */
const coord = (p: { lat: number; lng: number }) => String(p.lat);

describe('setting up', () => {
  it('holds up to eight, and needs three and a play area to start', () => {
    expect(maxPlayers).toBe(8);
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    expect(() => createRoom({ id: 'g', host: JOHN, invite: many, difficulty: 'easy', now: T0 })).toThrow(/Up to 8/);

    const bare = createRoom({ id: 'g', host: JOHN, invite: [SAM, KIM], difficulty: 'easy', now: T0 });
    expect(bare.area).toBeNull();
    join(bare, SAM.id, T0);
    join(bare, KIM.id, T0);
    expect(() => start(bare, JOHN.id, T0)).toThrow(/play area/);
    setArea(bare, JOHN.id, { ...C }, T0);
    expect(bare.area).toEqual({ ...C, radiusM: 500 });

    const two = room();
    join(two, SAM.id, T0);
    expect(() => start(two, JOHN.id, T0)).toThrow(/at least three/);
    join(two, KIM.id, T0);
    expect(() => start(two, SAM.id, T0)).toThrow(/Only the host/);
    start(two, JOHN.id, T0);
    expect(two.phase).toBe('countdown');
    // Rob never answered: he is out of this one.
    expect(two.players.find((p) => p.id === ROB.id)?.status).toBe('declined');
  });

  it('keeps the radius to 250 m – 2 km and the length to 15 – 60 minutes', () => {
    expect(radiusFrom(100)).toBe(250);
    expect(radiusFrom(5_000)).toBe(2_000);
    expect(radiusFrom(744)).toBe(740);
    expect(radiusFrom(Number.NaN)).toBe(500);
    expect(radiusFrom('900')).toBe(500);
    expect(minutesFrom(5)).toBe(15);
    expect(minutesFrom(90)).toBe(60);
    expect(minutesFrom(Infinity)).toBe(30);
    expect(room('hard', { radius: 1_500, minutes: 45 })).toMatchObject({ radius: 1_500, minutes: 45 });
  });

  it('says what the game is without saying where', () => {
    const r = room('hard', { radius: 1_500, minutes: 20 });
    expect(about(r)).toBe('1.5 km · 20 min · a ping every 2 min');
    expect(about(r)).not.toContain(String(C.lat));
  });

  it('lets only the host set the area or the runner, and only in the lobby', () => {
    const r = room();
    expect(() => setArea(r, SAM.id, { ...C }, T0)).toThrow(/Only the host/);
    expect(() => setArea(r, JOHN.id, { lat: 95, lng: 0 }, T0)).toThrow(/not a place/);
    expect(() => setArea(r, JOHN.id, { lat: Number.NaN, lng: 0 }, T0)).toThrow(/not a place/);
    setArea(r, JOHN.id, { ...at(10), radius: 800, minutes: 50 }, T0);
    expect(r).toMatchObject({ radius: 800, minutes: 50, area: { ...at(10), radiusM: 800 } });
    expect(() => pickRunner(r, SAM.id, { playerId: SAM.id }, T0)).toThrow(/Only the host/);
    expect(() => pickRunner(r, JOHN.id, { playerId: 'p_nobody' }, T0)).toThrow(/Pick somebody/);
    hunting(r);
    expect(() => setArea(r, JOHN.id, { ...C }, T0)).toThrow(/fixed/);
  });
});

describe('the head start', () => {
  it('makes the picked player the runner and everyone else a hunter', () => {
    const r = room();
    const t = headStart(r);
    expect(r.phase).toBe('headstart');
    expect(r.runnerId).toBe(SAM.id);
    expect(r.players.filter((p) => p.role === 'hunter').map((p) => p.id)).toEqual([JOHN.id, KIM.id, ROB.id]);
    expect(deadline(r)).toBe(t + HEADSTART_MS);
  });

  it('draws a runner when the host did not pick one', () => {
    const r = room();
    for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
    start(r, JOHN.id, T0);
    advance(r, T0 + COUNTDOWN_MS, () => 0.6);
    expect(r.runnerId).toBe(KIM.id);
  });

  it('shows nobody to anybody, though the fixes are taken', () => {
    const r = room();
    const t = headStart(r);
    const sam = at(120, 40);
    const kim = at(-200, 10);
    expect(send(r, SAM.id, sam, t + 1_000)).toBe(true);
    expect(send(r, KIM.id, kim, t + 1_000)).toBe(true);
    expect(json(r, KIM.id, t + 2_000)).not.toContain(coord(sam));
    expect(json(r, JOHN.id, t + 2_000)).not.toContain(coord(kim));
    expect(json(r, SAM.id, t + 2_000)).not.toContain(coord(kim));
    // Each sees their own.
    expect(json(r, SAM.id, t + 2_000)).toContain(coord(sam));
  });

  it('then starts the hunt and its clock', () => {
    const r = room('easy', { minutes: 20 });
    const t = hunting(r);
    expect(r.phase).toBe('hunt');
    expect(r.endsAt).toBe(t + 20 * 60_000);
    expect(nextPingAt(r)).toBe(t + PING_MS.easy);
    expect(deadline(r)).toBe(t + PING_MS.easy);
  });
});

describe('positions', () => {
  it('ignores a phone sending faster than every three seconds', () => {
    const r = room();
    const t = hunting(r);
    expect(send(r, KIM.id, at(1), t)).toBe(true);
    expect(send(r, KIM.id, at(2), t + FIX_MIN_GAP_MS - 1)).toBe(false);
    expect(r.players.find((p) => p.id === KIM.id)?.fix).toMatchObject(at(1));
    expect(send(r, KIM.id, at(3), t + FIX_MIN_GAP_MS)).toBe(true);
    expect(r.players.find((p) => p.id === KIM.id)?.fix).toMatchObject(at(3));
  });

  it('guards the time: a stale fix is dropped, a future or missing time is now', () => {
    const r = room();
    const t = hunting(r);
    expect(position(r, KIM.id, { ...at(1), accuracy: 5, at: t - 61_000 }, t)).toBe(false);
    expect(position(r, KIM.id, { ...at(1), accuracy: 5, at: t + 99_000 }, t)).toBe(true);
    expect(r.players.find((p) => p.id === KIM.id)?.fix?.at).toBe(t);
    expect(position(r, ROB.id, { ...at(1), accuracy: 5, at: Number.NaN }, t)).toBe(true);
    expect(r.players.find((p) => p.id === ROB.id)?.fix?.at).toBe(t);
  });

  it('refuses a place that is not on the map, or a fix with no accuracy', () => {
    const r = room();
    const t = hunting(r);
    expect(() => position(r, KIM.id, { lat: 91, lng: 0, accuracy: 5, at: t }, t)).toThrow(/not a place/);
    expect(() => position(r, KIM.id, { lat: Number.NaN, lng: 0, accuracy: 5, at: t }, t)).toThrow(/not a place/);
    expect(() => position(r, KIM.id, { ...at(1), accuracy: -1, at: t }, t)).toThrow(/accuracy/);
    expect(() => position(r, KIM.id, { ...at(1), accuracy: Number.NaN, at: t }, t)).toThrow(/accuracy/);
  });

  it('takes nothing in the lobby, or from somebody not in the hunt', () => {
    const r = room();
    expect(send(r, JOHN.id, at(1), T0)).toBe(false);
    const t = hunting(r);
    leave(r, ROB.id, t);
    expect(send(r, ROB.id, at(1), t + 5_000)).toBe(false);
  });
});

describe('who sees whom', () => {
  it('hunters see each other live, never the runner between pings; the runner sees no hunter live', () => {
    const r = room();
    const t = hunting(r);
    const sam = at(150, 90);
    const john = at(-60, -30);
    const kim = at(80, -250);
    send(r, SAM.id, sam, t + 1_000);
    send(r, JOHN.id, john, t + 1_000);
    send(r, KIM.id, kim, t + 1_000);

    for (const hunter of [JOHN.id, KIM.id, ROB.id]) {
      const wire = json(r, hunter, t + 2_000);
      expect(wire).not.toContain(coord(sam));
      expect(wire).toContain(coord(john));
      expect(wire).toContain(coord(kim));
    }
    const runnerWire = json(r, SAM.id, t + 2_000);
    expect(runnerWire).toContain(coord(sam));
    expect(runnerWire).not.toContain(coord(john));
    expect(runnerWire).not.toContain(coord(kim));
    expect(toWire(r, SAM.id, t + 2_000).myRole).toBe('runner');
    expect(toWire(r, KIM.id, t + 2_000).myRole).toBe('hunter');
  });

  it('a ping shows the hunters where the runner was, and the runner where the hunters were', () => {
    const r = room('medium');
    const t = hunting(r);
    const samThen = at(150, 90);
    const kimThen = at(80, -250);
    send(r, SAM.id, samThen, t + 1_000);
    send(r, KIM.id, kimThen, t + 1_000);
    const p = t + PING_MS.medium;
    expect(advance(r, p, Math.random)).toBe(true);
    expect(r.pings).toHaveLength(1);

    // Everyone moves on after the ping.
    const samNow = at(170, 120);
    const kimNow = at(40, -200);
    send(r, SAM.id, samNow, p + 5_000);
    send(r, KIM.id, kimNow, p + 5_000);

    const kimWire = toWire(r, KIM.id, p + 6_000);
    expect(kimWire.pings[0].runner).toMatchObject(samThen);
    expect(kimWire.pings[0].hunters).toEqual([]);
    expect(JSON.stringify(kimWire)).not.toContain(coord(samNow));

    const samWire = toWire(r, SAM.id, p + 6_000);
    expect(samWire.pings[0].runner).toBeNull();
    expect(samWire.pings[0].hunters.find((h) => h.id === KIM.id)?.fix).toMatchObject(kimThen);
    expect(JSON.stringify(samWire)).not.toContain(coord(kimNow));
  });

  it('pings every 5, 3 or 2 minutes by difficulty', () => {
    for (const [d, mins] of [['easy', 5], ['medium', 3], ['hard', 2]] as const) {
      const r = room(d, { minutes: 15 });
      const t = hunting(r);
      advance(r, t + 15 * 60_000 - 1, Math.random);
      // No ping lands on the final whistle.
      expect(r.pings.map((p) => (p.at - t) / 60_000)).toEqual(
        Array.from({ length: Math.ceil(15 / mins) - 1 }, (_, i) => (i + 1) * mins),
      );
    }
  });

  it('shows the runner live for 30 s after a fix outside the circle', () => {
    const r = room();
    const t = hunting(r);
    const outside = at(560);
    expect(isOutside(r.area!, { ...outside, accuracy: 5, at: t, receivedAt: t })).toBe(true);
    send(r, SAM.id, outside, t + 1_000);
    expect(r.liveUntil).toBe(t + 1_000 + OUTSIDE_LIVE_MS);
    expect(json(r, KIM.id, t + 2_000)).toContain(coord(outside));
    expect(toWire(r, SAM.id, t + 2_000).runnerLiveUntil).toBe(t + 1_000 + OUTSIDE_LIVE_MS);

    // Back inside: still live until the 30 s run out, from the last fix outside.
    const inside = at(300);
    send(r, SAM.id, inside, t + 10_000);
    expect(json(r, KIM.id, t + 11_000)).toContain(coord(inside));
    expect(deadline(r)).toBe(t + 1_000 + OUTSIDE_LIVE_MS);
    advance(r, t + 1_000 + OUTSIDE_LIVE_MS, Math.random);
    expect(r.liveUntil).toBeNull();
    expect(json(r, KIM.id, t + 32_000)).not.toContain(coord(inside));
  });

  it('gives the edge the benefit of the doubt', () => {
    const area = { ...C, radiusM: 500 };
    const fix = (n: number, accuracy: number): Fix => ({ ...at(n), accuracy, at: T0, receivedAt: T0 });
    expect(isOutside(area, fix(510, 20))).toBe(false);
    expect(isOutside(area, fix(530, 20))).toBe(true);
    // Rough GPS buys no more than 25 m.
    expect(isOutside(area, fix(520, 200))).toBe(false);
    expect(isOutside(area, fix(530, 200))).toBe(true);
  });

  it('shows a player who left, or one who never joined, no positions at all', () => {
    const r = room();
    const t = hunting(r);
    const kim = at(80, -250);
    send(r, KIM.id, kim, t + 1_000);
    leave(r, ROB.id, t + 2_000);
    expect(json(r, ROB.id, t + 3_000)).not.toContain(coord(kim));
  });
});

describe('the catch', () => {
  function close(r: Room, t: number, gapM = 10) {
    send(r, SAM.id, at(200), t);
    send(r, KIM.id, at(200 + gapM), t);
  }

  it('measures distance in metres', () => {
    expect(distanceM(at(0), at(100))).toBeCloseTo(100, 0);
    expect(distanceM(at(0), at(0, 100))).toBeCloseTo(100, 0);
  });

  it('allows the catch radius plus the rougher fix, capped', () => {
    const f = (n: number, accuracy: number): Fix => ({ ...at(n), accuracy, at: T0, receivedAt: T0 });
    expect(withinCatch(f(0, 5), f(CATCH_M + 4, 5))).toBe(true);
    expect(withinCatch(f(0, 5), f(CATCH_M + 6.5, 5))).toBe(false);
    expect(withinCatch(f(0, 40), f(49, 5))).toBe(true);
    expect(withinCatch(f(0, 400), f(51, 400))).toBe(false);
  });

  it('refuses a far claim and makes that hunter wait', () => {
    const r = room();
    const t = hunting(r) + 10_000;
    close(r, t, 80);
    expect(() => claimCatch(r, KIM.id, t)).toThrow(/Not close enough/);
    expect(toWire(r, KIM.id, t).catchCooldownUntil).toBe(t + CATCH_COOLDOWN_MS);
    // The cooldown is Kim's alone, and nobody else is told of it.
    expect(toWire(r, JOHN.id, t).catchCooldownUntil).toBeNull();
    send(r, KIM.id, at(205), t + 5_000);
    expect(() => claimCatch(r, KIM.id, t + 5_000)).toThrow(/try again in 25 seconds/);
    claimCatch(r, KIM.id, t + CATCH_COOLDOWN_MS);
    expect(r.claim?.hunterId).toBe(KIM.id);
  });

  it('needs a fresh, sharp fix from the hunter', () => {
    const r = room();
    const t = hunting(r) + 10_000;
    send(r, SAM.id, at(200), t + 20_000);
    send(r, KIM.id, at(205), t);
    expect(() => claimCatch(r, KIM.id, t + 31_000)).toThrow(/fresh, sharp/);
    send(r, KIM.id, at(205), t + 32_000, 80);
    expect(() => claimCatch(r, KIM.id, t + 33_000)).toThrow(/fresh, sharp/);
  });

  it('only a hunter claims, only in the hunt, one claim at a time', () => {
    const r = room();
    expect(() => claimCatch(r, KIM.id, T0)).toThrow(/not playing/);
    const t = hunting(r) + 10_000;
    close(r, t);
    send(r, ROB.id, at(205), t);
    expect(() => claimCatch(r, SAM.id, t)).toThrow(/Only a hunter/);
    claimCatch(r, KIM.id, t);
    expect(() => claimCatch(r, ROB.id, t)).toThrow(/already claimed/);
    expect(() => confirmCatch(r, KIM.id, t)).toThrow(/Only the runner/);
  });

  it('ends when the runner confirms: the catcher wins, and every position is dropped', () => {
    const r = room();
    const t = hunting(r) + 10_000;
    const kim = at(205);
    const sam = at(200);
    send(r, SAM.id, sam, t);
    send(r, KIM.id, kim, t);
    send(r, JOHN.id, at(-321), t);
    claimCatch(r, KIM.id, t + 1_000);
    expect(toWire(r, SAM.id, t + 1_000).claim).toEqual({ hunterId: KIM.id, deadline: t + 1_000 + CLAIM_MS, quiet: false });
    confirmCatch(r, SAM.id, t + 2_000);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ outcome: 'caught', catcherId: KIM.id, confirmed: true, at: t + 2_000 });
    expect(winners(r)).toEqual([KIM.id]);
    expect(standings(r).map((s) => [s.id, s.place, s.role, s.result])).toEqual([
      [KIM.id, 1, 'hunter', 'won'],
      [JOHN.id, 2, 'hunter', 'team'],
      [ROB.id, 2, 'hunter', 'team'],
      [SAM.id, 4, 'runner', 'lost'],
    ]);
    expect(r.players.every((p) => p.fix === null)).toBe(true);
    expect(r.pings).toEqual([]);
    for (const p of r.players) {
      const wire = json(r, p.id, t + 3_000);
      for (const spot of [kim, sam, at(-321)]) expect(wire).not.toContain(coord(spot));
    }
    expect(deadline(r)).toBe(t + 2_000 + FINISHED_MS);
  });

  it('is accepted by the server when the runner does not answer in 20 s', () => {
    const r = room();
    const t = hunting(r) + 10_000;
    close(r, t);
    claimCatch(r, KIM.id, t);
    expect(deadline(r)).toBe(t + CLAIM_MS);
    advance(r, t + CLAIM_MS, Math.random);
    expect(r.result).toMatchObject({ outcome: 'caught', catcherId: KIM.id, confirmed: false });
  });

  it('settles a claim made in the last seconds before the clock runs out', () => {
    const r = room('medium', { minutes: 15 });
    const start = hunting(r);
    const t = start + 15 * 60_000 - 5_000;
    advance(r, t - 1, Math.random);
    close(r, t);
    claimCatch(r, KIM.id, t);
    advance(r, start + 15 * 60_000 + 1_000, Math.random);
    expect(r.phase).toBe('hunt');
    advance(r, t + CLAIM_MS, Math.random);
    expect(r.result?.outcome).toBe('caught');
  });

  it('takes a hunter at their word when the runner has gone quiet', () => {
    const r = room();
    const t = hunting(r);
    send(r, SAM.id, at(400), t + 1_000);
    send(r, KIM.id, at(-400), t + RUNNER_QUIET_MS + 2_000);
    expect(toWire(r, KIM.id, t + RUNNER_QUIET_MS + 2_000).runnerQuiet).toBe(true);
    claimCatch(r, KIM.id, t + RUNNER_QUIET_MS + 2_000);
    expect(r.claim?.quiet).toBe(true);
  });
});

describe('the end', () => {
  it('goes to the runner when time runs out', () => {
    const r = room('easy', { minutes: 15 });
    const t = hunting(r);
    advance(r, t + 15 * 60_000, Math.random);
    expect(r.phase).toBe('finished');
    expect(r.result).toMatchObject({ outcome: 'time', catcherId: null });
    expect(winners(r)).toEqual([SAM.id]);
    expect(standings(r)[0]).toMatchObject({ id: SAM.id, place: 1, role: 'runner', result: 'won' });
    expect(standings(r).slice(1).every((s) => s.result === 'lost' && s.place === 2)).toBe(true);
  });

  it('goes to the hunters still in when the runner leaves', () => {
    const r = room();
    const t = hunting(r);
    leave(r, ROB.id, t + 1_000);
    leave(r, SAM.id, t + 2_000);
    expect(r.result).toMatchObject({ outcome: 'runner-left', catcherId: null });
    expect(winners(r).sort()).toEqual([JOHN.id, KIM.id]);
    expect(standings(r).find((s) => s.id === SAM.id)).toMatchObject({ result: 'lost', left: true });
  });

  it('goes to the runner when every hunter leaves, and a leaver takes their claim', () => {
    const r = room();
    const t = hunting(r) + 10_000;
    send(r, SAM.id, at(200), t);
    send(r, KIM.id, at(205), t);
    claimCatch(r, KIM.id, t);
    leave(r, KIM.id, t + 1_000);
    expect(r.claim).toBeNull();
    leave(r, JOHN.id, t + 2_000);
    expect(r.phase).toBe('hunt');
    leave(r, ROB.id, t + 3_000);
    expect(r.result).toMatchObject({ outcome: 'hunters-left' });
    expect(winners(r)).toEqual([SAM.id]);
  });

  it('closes the room when the host leaves the lobby', () => {
    const r = room();
    leave(r, JOHN.id, T0);
    expect(r.phase).toBe('closed');
  });

  it('a clock that is not a number does nothing; a far one plays out to the whistle', () => {
    const r = room();
    const t = hunting(r);
    send(r, SAM.id, at(1), t);
    const before = JSON.stringify(r);
    expect(advance(r, Number.NaN, Math.random)).toBe(false);
    expect(JSON.stringify(r)).toBe(before);
    expect(advance(r, t + 10 * 60 * 60_000, Math.random)).toBe(true);
    expect(r.result?.outcome).toBe('time');
  });

  it('plays again in the same place, the runner passing to the next player', () => {
    const r = room();
    const t = hunting(r);
    advance(r, t + 30 * 60_000, Math.random);
    expect(() => again(r, SAM.id, t + 31 * 60_000)).toThrow(/Only the host/);
    again(r, JOHN.id, t + 31 * 60_000);
    expect(r.phase).toBe('lobby');
    expect(r.runnerPick).toBe(KIM.id);
    expect(r.area).toEqual({ ...C, radiusM: 500 });
    start(r, JOHN.id, t + 31 * 60_000);
    advance(r, t + 31 * 60_000 + COUNTDOWN_MS, () => 0);
    expect(r.runnerId).toBe(KIM.id);
  });
});

describe('the leaderboard', () => {
  it('records the catcher’s win and nothing of where anyone was', () => {
    const r = room('hard');
    const t = hunting(r) + 10_000;
    send(r, SAM.id, at(200), t);
    send(r, KIM.id, at(205), t);
    claimCatch(r, KIM.id, t);
    confirmCatch(r, SAM.id, t + 1_000);
    const rows = roundRows(r, GAMES.manhunt, 1, t + 1_000, ['lat', 'lng', 'radius', 'minutes', 'topic']);
    expect(rows.map((row) => [row.playerId, row.won, row.rank, row.score])).toEqual([
      [KIM.id, true, 1, null],
      [JOHN.id, false, 2, null],
      [ROB.id, false, 3, null],
      [SAM.id, false, 4, null],
    ]);
    // The centre came in as options lat/lng; the room keeps it as `area`, which the recorder never reads.
    expect(rows[0].options).toEqual({ radius: 500, minutes: 30, label: '500 m · 30 min · a ping every 2 min' });
    expect(JSON.stringify(rows)).not.toContain(String(C.lat));
    expect(JSON.stringify(rows)).not.toContain(String(at(200).lat));
  });
});
