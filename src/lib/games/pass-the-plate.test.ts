import { describe, expect, it } from 'vitest';
import {
  about,
  advance,
  again,
  berryPoints,
  createRoom,
  deadline,
  deckFor,
  deckKinds,
  dessertPoints,
  direction,
  gainOf,
  join,
  leave,
  ownPoints,
  pick,
  place,
  scoreRound,
  start,
  standings,
  toWire,
  winners,
  CARDS,
  COUNTDOWN_MS,
  HAND_SIZE,
  KINDS,
  SCORING_MS,
  TURN_MS,
  type Card,
  type Difficulty,
  type Kind,
  type Played,
  type Room,
} from './pass-the-plate';

const T0 = 1_790_000_000_000;
const SAM = { id: 'p_sam', name: 'Sam' };
const KIM = { id: 'p_kim', name: 'Kim' };
const ROB = { id: 'p_rob', name: 'Rob' };
const ZOE = { id: 'p_zoe', name: 'Zoe' };

/** A small seeded generator, so a shuffle is the same every run. */
function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

function room(invite = [SAM], difficulty: Difficulty = 'medium'): Room {
  return createRoom({ id: 'g_1', host: { id: 'p_john', name: 'John' }, invite, difficulty, now: T0 });
}

/** Everyone joins and the countdown runs down: round 1 is dealt. */
function playing(r: Room, rng = seeded()): number {
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, 'p_john', T0);
  const now = T0 + COUNTDOWN_MS;
  advance(r, now, rng);
  return now;
}

/** A table built in order, so a gravy jug meets its pie. */
function table(...kinds: Kind[]): Played[] {
  const t: Played[] = [];
  kinds.forEach((kind, i) => place(t, { uid: 1000 + i, kind }));
  return t;
}

const p = (r: Room, id: string) => r.players.find((x) => x.id === id)!;

/** Give a player exactly these cards (fresh uids). */
function hand(r: Room, id: string, kinds: Kind[]): Card[] {
  const cards = kinds.map((kind) => ({ uid: r.nextUid++, kind }));
  p(r, id).hand = cards;
  return cards;
}

describe('the deck', () => {
  it('is 112 cards with the counts the spec gives', () => {
    const full = deckFor('hard');
    expect(full).toHaveLength(112);
    const count = (k: Kind) => full.filter((x) => x === k).length;
    expect(Object.fromEntries(KINDS.map((k) => [k, count(k)]))).toEqual({
      pancake: 14,
      pizza: 14,
      popcorn: 14,
      berry1: 6,
      berry2: 12,
      berry3: 8,
      pie2: 6,
      pie3: 10,
      pie4: 6,
      gravy: 6,
      spoon: 4,
      icecream: 12,
    });
    expect(deckFor('medium')).toEqual(full);
  });

  it('leaves the gravy jug and the serving spoon out on easy', () => {
    expect(deckKinds('easy')).not.toContain('gravy');
    expect(deckKinds('easy')).not.toContain('spoon');
    expect(deckFor('easy')).toHaveLength(102);
  });

  it('always has enough for the biggest table', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (const [n, size] of Object.entries(HAND_SIZE)) expect(deckFor(d).length).toBeGreaterThanOrEqual(Number(n) * size);
    }
  });

  it('every card has a name, an emoji and a rule', () => {
    for (const k of KINDS) {
      expect(CARDS[k].name.length).toBeGreaterThan(2);
      expect(CARDS[k].emoji.length).toBeGreaterThan(0);
      expect(CARDS[k].rule.length).toBeGreaterThan(10);
    }
  });
});

describe('scoring', () => {
  it('pancakes score 6 a pair; the odd one nothing', () => {
    expect(ownPoints(table('pancake')).pancakes).toBe(0);
    expect(ownPoints(table('pancake', 'pancake')).pancakes).toBe(6);
    expect(ownPoints(table('pancake', 'pancake', 'pancake')).pancakes).toBe(6);
    expect(ownPoints(table('pancake', 'pancake', 'pancake', 'pancake')).pancakes).toBe(12);
  });

  it('pizza scores 12 a whole three; one or two nothing', () => {
    expect(ownPoints(table('pizza', 'pizza')).pizza).toBe(0);
    expect(ownPoints(table('pizza', 'pizza', 'pizza')).pizza).toBe(12);
    expect(ownPoints(table(...Array<Kind>(7).fill('pizza'))).pizza).toBe(24);
  });

  it('popcorn slides 1, 3, 6, 10, 14 and caps at 18', () => {
    const scores = [0, 1, 2, 3, 4, 5, 6, 7, 9].map((n) => ownPoints(table(...Array<Kind>(n).fill('popcorn'))).popcorn);
    expect(scores).toEqual([0, 1, 3, 6, 10, 14, 18, 18, 18]);
  });

  it('a gravy jug doubles the NEXT pie only, oldest jug first', () => {
    expect(ownPoints(table('pie3')).pies).toBe(3);
    expect(ownPoints(table('gravy', 'pie3')).pies).toBe(6);
    expect(ownPoints(table('pie3', 'gravy')).pies).toBe(3);
    expect(ownPoints(table('gravy', 'pie4', 'pie2')).pies).toBe(8 + 2);
    expect(ownPoints(table('gravy', 'gravy', 'pie2', 'pie4')).pies).toBe(4 + 8);
    const t = table('gravy', 'pancake', 'pie2');
    expect(t[0].spent).toBe(true);
    expect(t[2].boosted).toBe(true);
  });

  it('strawberries: most 7, second 3; a tie for most splits it and nobody is second', () => {
    expect(berryPoints([{ id: 'a', berries: 6 }, { id: 'b', berries: 4 }, { id: 'c', berries: 1 }])).toEqual({ a: 7, b: 3, c: 0 });
    expect(berryPoints([{ id: 'a', berries: 5 }, { id: 'b', berries: 5 }, { id: 'c', berries: 2 }])).toEqual({ a: 3, b: 3, c: 0 });
    expect(berryPoints([{ id: 'a', berries: 5 }, { id: 'b', berries: 5 }, { id: 'c', berries: 5 }])).toEqual({ a: 2, b: 2, c: 2 });
    expect(berryPoints([{ id: 'a', berries: 5 }, { id: 'b', berries: 2 }, { id: 'c', berries: 2 }])).toEqual({ a: 7, b: 1, c: 1 });
    // Nobody with none scores, and a lone berry-holder gets no second.
    expect(berryPoints([{ id: 'a', berries: 3 }, { id: 'b', berries: 0 }])).toEqual({ a: 7, b: 0 });
    expect(berryPoints([{ id: 'a', berries: 0 }, { id: 'b', berries: 0 }])).toEqual({ a: 0, b: 0 });
  });

  it('ice cream: most +5, fewest −5 (three or more), split rounded down; all level scores nothing', () => {
    expect(dessertPoints([{ id: 'a', scoops: 4 }, { id: 'b', scoops: 2 }, { id: 'c', scoops: 0 }])).toEqual({ a: 5, b: 0, c: -5 });
    expect(dessertPoints([{ id: 'a', scoops: 3 }, { id: 'b', scoops: 3 }, { id: 'c', scoops: 1 }])).toEqual({ a: 2, b: 2, c: -5 });
    expect(dessertPoints([{ id: 'a', scoops: 3 }, { id: 'b', scoops: 1 }, { id: 'c', scoops: 1 }])).toEqual({ a: 5, b: -2, c: -2 });
    expect(dessertPoints([{ id: 'a', scoops: 2 }, { id: 'b', scoops: 2 }, { id: 'c', scoops: 2 }])).toEqual({ a: 0, b: 0, c: 0 });
    // Two players: nobody loses for fewest.
    expect(dessertPoints([{ id: 'a', scoops: 2 }, { id: 'b', scoops: 0 }])).toEqual({ a: 5, b: 0 });
  });

  it('a round row adds up', () => {
    const rows = scoreRound([
      { id: 'a', table: table('pancake', 'pancake', 'pizza', 'pizza', 'pizza', 'popcorn', 'popcorn', 'gravy', 'pie4', 'berry3', 'berry1', 'icecream') },
      { id: 'b', table: table('berry1', 'berry2', 'pie2', 'spoon', 'icecream', 'icecream') },
    ]);
    expect(rows[0]).toEqual({
      playerId: 'a',
      pancakes: 6,
      pizza: 12,
      popcorn: 3,
      pies: 8,
      berryCount: 4,
      berries: 7,
      scoops: 1,
      total: 6 + 12 + 3 + 8 + 7,
    });
    expect(rows[1]).toMatchObject({ pies: 2, berryCount: 3, berries: 3, scoops: 2, total: 2 + 3 });
  });

  it('a hint says what a card would add now', () => {
    const t = table('pancake', 'pizza', 'pizza', 'gravy');
    expect(gainOf(t, { uid: 1, kind: 'pancake' })).toBe(6);
    expect(gainOf(t, { uid: 1, kind: 'pizza' })).toBe(12);
    expect(gainOf(t, { uid: 1, kind: 'pie3' })).toBe(6);
    expect(gainOf(t, { uid: 1, kind: 'popcorn' })).toBe(1);
    expect(gainOf(t, { uid: 1, kind: 'berry3' })).toBe(0);
    expect(gainOf(t, { uid: 1, kind: 'icecream' })).toBe(0);
    // The table it was asked about is untouched.
    expect(t[3].spent).toBe(false);
  });
});

describe('the lobby', () => {
  it('needs two to start and refuses a sixth', () => {
    const r = room([]);
    expect(() => start(r, 'p_john', T0)).toThrow(/at least two/);
    expect(() => room([SAM, KIM, ROB, ZOE, { id: 'p_six', name: 'Six' }])).toThrow(/Up to 5/);
  });

  it('says what kind of game it is', () => {
    expect(about(room([SAM], 'easy'))).toMatch(/simple deck · hints on/);
    expect(about(room([SAM], 'hard'))).toMatch(/no hints/);
  });

  it('deals the hand size for the table: 2→10, 3→9, 4→8, 5→7', () => {
    const tables = [[SAM], [SAM, KIM], [SAM, KIM, ROB], [SAM, KIM, ROB, ZOE]];
    for (const invite of tables) {
      const r = room(invite);
      playing(r);
      expect(r.phase).toBe('picking');
      const n = invite.length + 1;
      expect(r.handSize).toBe(HAND_SIZE[n]);
      for (const pl of r.players) expect(pl.hand).toHaveLength(HAND_SIZE[n]);
      const uids = r.players.flatMap((pl) => pl.hand.map((c) => c.uid));
      expect(new Set(uids).size).toBe(uids.length);
    }
  });
});

describe('a turn', () => {
  it('reveals when the last player chooses, and passes plates left in round 1', () => {
    const r = room([SAM, KIM]);
    const now = playing(r);
    const before = r.players.map((pl) => pl.hand.map((c) => c.uid));
    pick(r, 'p_john', { cards: [before[0][0]] }, now);
    pick(r, 'p_sam', { cards: [before[1][0]] }, now);
    expect(r.turn).toBe(1);
    expect(r.players.every((pl) => pl.played.length === 0)).toBe(true);
    // Changing your mind is fine until the reveal.
    pick(r, 'p_sam', { cards: [before[1][1]] }, now);
    pick(r, 'p_kim', { cards: [before[2][0]] }, now + 500);
    expect(r.turn).toBe(2);
    expect(p(r, 'p_sam').played.map((c) => c.uid)).toEqual([before[1][1]]);
    // Left: John's plate went to Sam, Sam's to Kim, Kim's to John.
    expect(p(r, 'p_sam').hand.map((c) => c.uid)).toEqual(before[0].slice(1));
    expect(p(r, 'p_kim').hand.map((c) => c.uid)).toEqual(before[1].filter((u) => u !== before[1][1]));
    expect(p(r, 'p_john').hand.map((c) => c.uid)).toEqual(before[2].slice(1));
    expect(r.lastTurn?.map((t) => [t.playerId, t.cards.length, t.auto])).toEqual([
      ['p_john', 1, false],
      ['p_sam', 1, false],
      ['p_kim', 1, false],
    ]);
    expect(r.phaseEndsAt).toBe(now + 500 + TURN_MS.medium);
  });

  it('passes right in round 2', () => {
    expect([1, 2, 3].map(direction)).toEqual(['left', 'right', 'left']);
  });

  it('refuses a card not on your plate, two without a spoon, and off-phase picks', () => {
    const r = room([SAM]);
    const now = playing(r);
    const sams = p(r, 'p_sam').hand[0].uid;
    expect(() => pick(r, 'p_john', { cards: [sams] }, now)).toThrow(/not on your plate/);
    expect(() => pick(r, 'p_john', { cards: [] }, now)).toThrow(/Choose one/);
    expect(() => pick(r, 'p_john', { cards: 'x' }, now)).toThrow(/Choose one/);
    expect(() => pick(r, 'p_john', { cards: [1.5] }, now)).toThrow(/Choose one/);
    const [a, b] = p(r, 'p_john').hand;
    expect(() => pick(r, 'p_john', { cards: [a.uid, a.uid] }, now)).toThrow(/two different/);
    expect(() => pick(r, 'p_john', { cards: [a.uid, b.uid] }, now)).toThrow(/serving spoon/);
    expect(() => pick(r, 'p_zed', { cards: [a.uid] }, now)).toThrow(/not in this game/);
    const lobby = room([SAM]);
    expect(() => pick(lobby, 'p_john', { cards: [1] }, T0)).toThrow(/not playing|not started/);
  });

  it('a serving spoon takes two, and goes back on the plate you pass', () => {
    const r = room([SAM], 'hard');
    const now = playing(r);
    p(r, 'p_john').played = table('spoon');
    const mine = hand(r, 'p_john', ['pizza', 'pizza', 'popcorn', 'pie2']);
    const theirs = hand(r, 'p_sam', ['pancake', 'pancake', 'popcorn', 'pie3']);
    const w = toWire(r, 'p_john', now);
    expect(w.canTakeTwo).toBe(true);
    pick(r, 'p_john', { cards: [mine[0].uid, mine[1].uid] }, now);
    pick(r, 'p_sam', { cards: [theirs[0].uid] }, now);
    expect(p(r, 'p_john').played.map((c) => c.kind)).toEqual(['pizza', 'pizza']);
    // John's plate (popcorn, pie2 + the spoon) went to Sam; both now hold three.
    expect(p(r, 'p_sam').hand.map((c) => c.kind)).toEqual(['popcorn', 'pie2', 'spoon']);
    expect(p(r, 'p_john').hand).toHaveLength(3);
    expect(r.lastTurn?.[0].cards).toHaveLength(2);
  });
});

describe('the clock', () => {
  it('takes a random card for anyone who has not chosen, marked auto', () => {
    const r = room([SAM]);
    const now = playing(r);
    const mine = p(r, 'p_john').hand[2].uid;
    pick(r, 'p_john', { cards: [mine] }, now);
    expect(advance(r, now + TURN_MS.medium - 1, seeded())).toBe(false);
    expect(advance(r, now + TURN_MS.medium, () => 0.99)).toBe(true);
    expect(r.turn).toBe(2);
    expect(r.lastTurn?.map((t) => t.auto)).toEqual([false, true]);
    expect(p(r, 'p_john').played[0].uid).toBe(mine);
    expect(p(r, 'p_sam').played).toHaveLength(1);
  });

  it('ignores a clock that is not a number', () => {
    const r = room([SAM]);
    const now = playing(r);
    expect(advance(r, Number.NaN, seeded())).toBe(false);
    expect(advance(r, Number.POSITIVE_INFINITY, seeded())).toBe(false);
    expect(r.turn).toBe(1);
    // A far-future clock moves one step, never the whole game.
    advance(r, now + 10 ** 9, seeded());
    expect(r.turn).toBe(2);
    expect(r.round).toBe(1);
  });

  it('plays a whole game on the clock alone: three rounds, scoring between, standings at the end', () => {
    const r = room([SAM, KIM], 'hard');
    let now = playing(r);
    const rng = seeded(3);
    const rounds: number[] = [];
    for (let i = 0; i < 200 && r.phase !== 'finished'; i++) {
      now = deadline(r)!;
      if (r.phase === 'scoring') rounds.push(r.round);
      advance(r, now, rng);
    }
    expect(r.phase).toBe('finished');
    expect(rounds).toEqual([1, 2, 3]);
    expect(r.results.map((x) => x.round)).toEqual([1, 2, 3]);
    for (const res of r.results) {
      for (const row of res.rows) expect(row.total).toBe(row.pancakes + row.pizza + row.popcorn + row.pies + row.berries);
    }
    const s = standings(r);
    expect(s).toHaveLength(3);
    for (const row of s) {
      const pl = p(r, row.id);
      const dessert = r.dessert!.find((d) => d.playerId === row.id)!.points;
      expect(row.score).toBe(pl.rounds.reduce((a, b) => a + b, 0) + dessert);
    }
    expect(s.map((x) => x.score)).toEqual([...s.map((x) => x.score)].sort((a, b) => b - a));
    expect(winners(r).length).toBeGreaterThanOrEqual(1);
    expect(r.dessert!.reduce((n, d) => n + d.scoops, 0)).toBe(
      r.results.flatMap((x) => x.rows).reduce((n, row) => n + row.scoops, 0),
    );
    // The scoring phase lasted its time.
    expect(SCORING_MS).toBeGreaterThan(0);
  });
});

describe('leaving', () => {
  it('drops the leaver’s plate, reveals if everyone else had chosen, and passes round the smaller table', () => {
    const r = room([SAM, KIM]);
    const now = playing(r);
    pick(r, 'p_john', { cards: [p(r, 'p_john').hand[0].uid] }, now);
    pick(r, 'p_sam', { cards: [p(r, 'p_sam').hand[0].uid] }, now);
    leave(r, 'p_kim', now + 1);
    expect(r.turn).toBe(2);
    expect(p(r, 'p_kim').hand).toEqual([]);
    expect(p(r, 'p_john').hand).toHaveLength(8);
    expect(p(r, 'p_sam').hand).toHaveLength(8);
    expect(r.lastTurn?.map((t) => t.playerId)).toEqual(['p_john', 'p_sam']);
  });

  it('a table of one ends with them the winner, the leaver last', () => {
    const r = room([SAM]);
    const now = playing(r);
    p(r, 'p_sam').rounds = [40];
    leave(r, 'p_sam', now);
    expect(r.phase).toBe('finished');
    expect(winners(r)).toEqual(['p_john']);
    const s = standings(r);
    expect(s.map((x) => [x.id, x.place, x.left])).toEqual([
      ['p_john', 1, false],
      ['p_sam', 2, true],
    ]);
  });

  it('the host leaving the lobby closes it; mid-game the host role moves on', () => {
    const lobby = room([SAM]);
    leave(lobby, 'p_john', T0);
    expect(lobby.phase).toBe('closed');
    const r = room([SAM, KIM]);
    const now = playing(r);
    leave(r, 'p_john', now);
    expect(r.hostId).toBe('p_sam');
    expect(r.phase).toBe('picking');
  });

  it('a leaver during the countdown leaves one: it finishes', () => {
    const r = room([SAM]);
    join(r, 'p_sam', T0);
    start(r, 'p_john', T0);
    leave(r, 'p_sam', T0 + 1);
    advance(r, T0 + COUNTDOWN_MS, seeded());
    expect(r.phase).toBe('finished');
    expect(winners(r)).toEqual(['p_john']);
  });
});

describe('the result', () => {
  it('breaks a tie on points with ice cream, and shares a dead heat', () => {
    const r = room([SAM, KIM]);
    playing(r);
    p(r, 'p_john').rounds = [20];
    p(r, 'p_sam').rounds = [20];
    p(r, 'p_kim').rounds = [10];
    p(r, 'p_john').iceCream = 1;
    p(r, 'p_sam').iceCream = 2;
    p(r, 'p_kim').iceCream = 2;
    r.dessert = [];
    expect(standings(r).map((s) => [s.id, s.place])).toEqual([
      ['p_sam', 1],
      ['p_john', 2],
      ['p_kim', 3],
    ]);
    expect(winners(r)).toEqual(['p_sam']);
    p(r, 'p_john').iceCream = 2;
    expect(winners(r).sort()).toEqual(['p_john', 'p_sam']);
  });

  it('play again goes back to the lobby with a clean table', () => {
    const r = room([SAM]);
    const now = playing(r);
    leave(r, 'p_sam', now);
    expect(r.phase).toBe('finished');
    again(r, 'p_john', now + 1);
    expect(r.phase).toBe('lobby');
    expect(r.round).toBe(0);
    expect(p(r, 'p_sam').status).toBe('invited');
    expect(p(r, 'p_john')).toMatchObject({ hand: [], played: [], rounds: [], iceCream: 0, seated: false });
  });
});

describe('the wire', () => {
  /** Every uid on the given plates, as the JSON would spell it. */
  const uidKeys = (cards: Card[]) => cards.map((c) => `"uid":${c.uid},`);

  it('never shows another player their neighbours’ plates or choices', () => {
    const r = room([SAM, KIM, ROB, ZOE], 'easy');
    const now = playing(r);
    // Two have chosen: their choices are as secret as their plates.
    pick(r, 'p_sam', { cards: [p(r, 'p_sam').hand[3].uid] }, now);
    pick(r, 'p_kim', { cards: [p(r, 'p_kim').hand[5].uid] }, now);
    for (const viewer of r.players) {
      const json = JSON.stringify(toWire(r, viewer.id, now));
      for (const other of r.players) {
        const keys = uidKeys(other.hand);
        if (other.id === viewer.id) {
          for (const k of keys) expect(json).toContain(k);
        } else {
          for (const k of keys) expect(json, `${viewer.id} sees ${other.id}'s plate`).not.toContain(k);
        }
      }
      const w = toWire(r, viewer.id, now);
      expect(w.myPick).toEqual(viewer.pick ?? []);
      // Only whether others have chosen, never what.
      expect(w.players.find((x) => x.id === 'p_sam')!.picked).toBe(true);
      expect(w.players.find((x) => x.id === 'p_john')!.picked).toBe(false);
      for (const pl of w.players) expect(Object.keys(pl)).not.toContain('hand');
      expect(w.players.map((x) => x.handCount)).toEqual([7, 7, 7, 7, 7]);
    }
  });

  it('shows hints by difficulty: gains on easy, a running total on medium, nothing on hard', () => {
    for (const [d, hints] of [
      ['easy', 'gains'],
      ['medium', 'total'],
      ['hard', 'none'],
    ] as const) {
      const r = room([SAM], d);
      const now = playing(r);
      const w = toWire(r, 'p_john', now);
      expect(w.hints).toBe(hints);
      expect(w.hand.every((c) => (hints === 'gains' ? typeof c.gain === 'number' : c.gain === null))).toBe(true);
      expect(w.players.every((x) => (hints === 'none' ? x.roundSoFar === null : x.roundSoFar === 0))).toBe(true);
      expect(w.kinds.map((k) => k.kind)).toEqual(deckKinds(d));
      expect(w.turnMs).toBe(TURN_MS[d]);
    }
  });

  it('says where my plate goes and where the next one comes from', () => {
    const r = room([SAM, KIM]);
    const now = playing(r);
    const w = toWire(r, 'p_sam', now);
    expect([w.direction, w.passTo, w.passFrom]).toEqual(['left', 'p_kim', 'p_john']);
  });

  it('a finished room carries standings and winners for the leaderboard', () => {
    const r = room([SAM]);
    const now = playing(r);
    leave(r, 'p_sam', now);
    const w = toWire(r, 'p_john', now);
    expect(w.standings?.map((s) => s.id)).toEqual(['p_john', 'p_sam']);
    expect(typeof w.standings?.[0].score).toBe('number');
    expect(w.winnerIds).toEqual(['p_john']);
  });
});
