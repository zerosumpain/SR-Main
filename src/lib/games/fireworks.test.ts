import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  FINISHED_MS,
  MAX_HINTS,
  MISFIRES,
  TURN_MS,
  about,
  advance,
  again,
  autoMove,
  buildDeck,
  createRoom,
  deadline,
  deduce,
  discard,
  handSize,
  hint,
  join,
  leave,
  maxScore,
  play,
  possibleColours,
  standings,
  start,
  toWire,
  winners,
  type Card,
  type Colour,
  type Difficulty,
  type Room,
} from './fireworks';

const T0 = 1_790_000_000_000;
const half = () => 0.5;

const JOHN = { id: 'p_john', name: 'John' };
const SAM = { id: 'p_sam', name: 'Sam' };
const KIM = { id: 'p_kim', name: 'Kim' };
const ROSE = { id: 'p_rose', name: 'Rose' };

function room(invite = [SAM], difficulty: Difficulty = 'medium'): Room {
  return createRoom({ id: 'g_1', host: JOHN, invite, difficulty, now: T0 });
}

let nextId = 1000;
const card = (colour: Colour, rank: number): Card => ({ id: nextId++, colour, rank });

/** Everyone joins, the countdown runs, then the hands (and the deck, top last) are set so the test knows them. */
function playing(r: Room, hands?: Record<string, Card[]>, deck?: Card[]): number {
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, JOHN.id, T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  if (hands)
    for (const p of r.players)
      if (hands[p.id])
        p.hand = hands[p.id].map((c) => ({ card: c, knows: { colours: [], notColours: [], rank: null, notRanks: [] } }));
  if (deck) r.deck = deck;
  return T0 + COUNTDOWN_MS;
}

function status(fn: () => void): [number, string] {
  try {
    fn();
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
  return [0, ''];
}

const me = (r: Room, id: string) => toWire(r, id, T0).players.find((p) => p.id === id)!;

describe('the deck and the deal', () => {
  it('is fifty cards in five colours, sixty with the prism suit on hard', () => {
    const d = buildDeck('medium', Math.random);
    expect(d).toHaveLength(50);
    for (const c of ['red', 'yellow', 'green', 'blue', 'white'])
      expect(d.filter((x) => x.colour === c).map((x) => x.rank).sort()).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    const h = buildDeck('hard', Math.random);
    expect(h).toHaveLength(60);
    expect(h.filter((x) => x.colour === 'prism')).toHaveLength(10);
    expect(new Set(h.map((x) => x.id)).size).toBe(60);
    expect(maxScore('medium')).toBe(25);
    expect(maxScore('hard')).toBe(30);
  });

  it('numbers cards after the shuffle, so an id says nothing about the card', () => {
    const a = buildDeck('medium', () => 0.1);
    const b = buildDeck('medium', () => 0.9);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => `${c.colour}${c.rank}`)).not.toEqual(b.map((c) => `${c.colour}${c.rank}`));
  });

  it('deals five at two or three players and four at four or five, and the host goes first', () => {
    expect([2, 3, 4, 5].map(handSize)).toEqual([5, 5, 4, 4]);
    const two = room();
    playing(two);
    expect(two.players.map((p) => p.hand.length)).toEqual([5, 5]);
    expect(two.deck).toHaveLength(40);
    expect(two.turnId).toBe(JOHN.id);
    expect(two.hints).toBe(MAX_HINTS);
    const four = room([SAM, KIM, ROSE]);
    playing(four);
    expect(four.players.map((p) => p.hand.length)).toEqual([4, 4, 4, 4]);
    expect(four.deck).toHaveLength(34);
  });

  it('needs two players to start', () => {
    const r = room([]);
    expect(status(() => start(r, JOHN.id, T0))).toEqual([409, 'Fireworks needs at least two players.']);
  });

  it('says what the difficulty is in the invite', () => {
    expect(about(room([SAM], 'easy'))).toBe('5 colours · 4 misfires');
    expect(about(room([SAM], 'hard'))).toBe('6 colours · 3 misfires');
  });
});

describe('hints', () => {
  it('points at every matching card, costs a token, and records what each card is not', () => {
    const r = room();
    const t = playing(r, {
      p_john: [card('red', 1), card('red', 2), card('blue', 1), card('green', 3), card('white', 4)],
      p_sam: [card('red', 1), card('blue', 2), card('red', 4), card('green', 1), card('yellow', 5)],
    });
    hint(r, JOHN.id, { to: SAM.id, colour: 'red' }, t);
    expect(r.hints).toBe(MAX_HINTS - 1);
    expect(r.turnId).toBe(SAM.id);
    const sam = r.players[1].hand;
    expect(sam.map((h) => h.knows.colours)).toEqual([['red'], [], ['red'], [], []]);
    expect(sam[1].knows.notColours).toEqual(['red']);
    expect(r.log.at(-1)).toMatchObject({ kind: 'hint', by: JOHN.id, to: SAM.id, colour: 'red', cards: [sam[0].card.id, sam[2].card.id] });

    hint(r, SAM.id, { to: JOHN.id, rank: 1 }, t + 1);
    const john = r.players[0].hand;
    expect(john.map((h) => h.knows.rank)).toEqual([1, null, 1, null, null]);
    expect(john[1].knows.notRanks).toEqual([1]);

    // What Sam now knows of his own cards.
    const w = me(r, SAM.id);
    expect(w.hand[0].knows).toEqual({ colours: ['red'], ranks: [1, 2, 3, 4, 5], hinted: true });
    expect(w.hand[1].knows).toEqual({ colours: ['yellow', 'green', 'blue', 'white'], ranks: [1, 2, 3, 4, 5], hinted: false });
  });

  it('refuses a hint that touches nothing, names no colour or number, or goes to yourself', () => {
    const r = room();
    const t = playing(r, {
      p_john: [card('red', 1), card('red', 2), card('blue', 1), card('green', 3), card('white', 4)],
      p_sam: [card('red', 1), card('blue', 2), card('red', 4), card('green', 1), card('green', 2)],
    });
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, colour: 'yellow' }, t))).toEqual([400, 'Sam has no card that hint points at.']);
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, rank: 5 }, t))[0]).toBe(400);
    expect(status(() => hint(r, JOHN.id, { to: SAM.id }, t))).toEqual([400, 'Hint one colour or one number.']);
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, colour: 'red', rank: 1 }, t))[0]).toBe(400);
    expect(status(() => hint(r, JOHN.id, { to: JOHN.id, rank: 1 }, t))[0]).toBe(400);
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, colour: 'prism' }, t))[0]).toBe(400);
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, rank: Number.NaN }, t))[0]).toBe(400);
    expect(status(() => hint(r, SAM.id, { to: JOHN.id, rank: 1 }, t))).toEqual([409, "It's not your turn."]);
    expect(r.hints).toBe(MAX_HINTS);
    r.hints = 0;
    expect(status(() => hint(r, JOHN.id, { to: SAM.id, rank: 1 }, t))[0]).toBe(409);
  });

  it('on hard, every colour hint lights the prism cards too, and two colours on one card mean prism', () => {
    const r = room([SAM], 'hard');
    const t = playing(r, {
      p_john: [card('red', 1), card('red', 2), card('blue', 1), card('green', 3), card('white', 4)],
      p_sam: [card('prism', 3), card('blue', 2), card('red', 4), card('green', 1), card('white', 2)],
    });
    hint(r, JOHN.id, { to: SAM.id, colour: 'red' }, t);
    const sam = r.players[1].hand;
    expect(r.log.at(-1)).toMatchObject({ cards: [sam[0].card.id, sam[2].card.id] });
    expect(possibleColours(sam[0].knows, 'hard')).toEqual(['red', 'prism']);
    expect(possibleColours(sam[1].knows, 'hard')).toEqual(['yellow', 'green', 'blue', 'white']);
    hint(r, SAM.id, { to: JOHN.id, rank: 1 }, t + 1);
    hint(r, JOHN.id, { to: SAM.id, colour: 'blue' }, t + 2);
    expect(possibleColours(sam[0].knows, 'hard')).toEqual(['prism']);
    expect(possibleColours(sam[2].knows, 'hard')).toEqual(['red']);
  });
});

describe('playing and dropping cards', () => {
  it('builds a firework in order, misfires out of order, and draws a card after each', () => {
    const r = room();
    const t = playing(
      r,
      {
        p_john: [card('red', 1), card('red', 3), card('blue', 1), card('green', 3), card('white', 4)],
        p_sam: [card('red', 2), card('blue', 2), card('red', 4), card('green', 1), card('green', 2)],
      },
      [card('white', 1), card('white', 1), card('yellow', 1), card('yellow', 2)],
    );
    const [r1, r3] = r.players[0].hand.map((h) => h.card.id);
    play(r, JOHN.id, { card: r1 }, t);
    expect(r.stacks.red).toBe(1);
    expect(r.players[0].hand).toHaveLength(5);
    expect(r.players[0].hand.at(-1)!.card).toMatchObject({ colour: 'yellow', rank: 2 });
    play(r, SAM.id, { card: r.players[1].hand[0].card.id }, t + 1);
    expect(r.stacks.red).toBe(2);
    play(r, JOHN.id, { card: r3 }, t + 2);
    expect(r.stacks.red).toBe(3);
    expect(r.misfires).toBe(0);
    const blue2 = r.players[1].hand.find((h) => h.card.colour === 'blue')!.card;
    play(r, SAM.id, { card: blue2.id }, t + 3);
    expect(r.misfires).toBe(1);
    expect(r.discards).toContainEqual(blue2);
    expect(r.stacks.blue).toBe(0);
    expect(status(() => play(r, JOHN.id, { card: 99_999 }, t + 4))).toEqual([400, 'That card is not in your hand.']);
    expect(status(() => play(r, JOHN.id, { card: '1' }, t + 4))[0]).toBe(400);
  });

  it('refuses a drop while every token is in; a drop wins one back', () => {
    const r = room();
    const t = playing(r);
    const id = r.players[0].hand[0].card.id;
    expect(status(() => discard(r, JOHN.id, { card: id }, t))[0]).toBe(409);
    r.hints = 5;
    discard(r, JOHN.id, { card: id }, t);
    expect(r.hints).toBe(6);
    expect(r.discards.map((c) => c.id)).toEqual([id]);
  });

  it('wins a token back for finishing a firework', () => {
    const r = room();
    const t = playing(r, { p_john: [card('green', 5), card('red', 1), card('red', 1), card('red', 1), card('red', 2)] });
    r.stacks.green = 4;
    r.hints = 3;
    play(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t);
    expect(r.stacks.green).toBe(5);
    expect(r.hints).toBe(4);
  });
});

describe('the end of the show', () => {
  it('ends on the last misfire and keeps the fireworks built so far', () => {
    const r = room();
    const t = playing(r, {
      p_john: [card('red', 4), card('red', 4), card('blue', 5), card('green', 3), card('white', 4)],
      p_sam: [card('red', 3), card('blue', 2), card('red', 5), card('green', 4), card('green', 2)],
    });
    r.stacks.yellow = 3;
    play(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t);
    play(r, SAM.id, { card: r.players[1].hand[0].card.id }, t + 1);
    expect(r.phase).toBe('playing');
    play(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t + 2);
    expect(r.misfires).toBe(MISFIRES.medium);
    expect(r.phase).toBe('finished');
    expect(r.ending).toBe('misfires');
    expect(standings(r).map((s) => [s.id, s.score, s.place])).toEqual([
      [JOHN.id, 3, 1],
      [SAM.id, 3, 1],
    ]);
    expect(winners(r)).toEqual([]);
    expect(deadline(r)).toBe(t + 2 + FINISHED_MS);
  });

  it('lets easy survive a third misfire', () => {
    const r = room([SAM], 'easy');
    const t = playing(r);
    r.misfires = 2;
    r.players[0].hand[0].card = { ...r.players[0].hand[0].card, colour: 'red', rank: 5 };
    play(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t);
    expect(r.misfires).toBe(3);
    expect(r.phase).toBe('playing');
  });

  it('is perfect at the top score: everyone wins', () => {
    const r = room();
    const t = playing(r, { p_john: [card('white', 5), card('red', 1), card('red', 1), card('red', 1), card('red', 2)] });
    for (const c of ['red', 'yellow', 'green', 'blue']) r.stacks[c] = 5;
    r.stacks.white = 4;
    play(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t);
    expect(r.phase).toBe('finished');
    expect(r.ending).toBe('perfect');
    expect(winners(r)).toEqual([JOHN.id, SAM.id]);
    expect(standings(r)[0].score).toBe(25);
  });

  it('gives everyone one last turn after the last card is drawn, the drawer included', () => {
    const r = room([SAM, KIM]);
    const t = playing(r, undefined, [card('yellow', 4)]);
    r.hints = 4;
    discard(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t); // draws the last card
    expect(r.deck).toHaveLength(0);
    expect(toWire(r, JOHN.id, t).finalTurns).toBe(3);
    hint(r, SAM.id, { to: JOHN.id, colour: r.players[0].hand[0].card.colour as 'red' }, t + 1);
    discard(r, KIM.id, { card: r.players[2].hand[0].card.id }, t + 2);
    expect(r.phase).toBe('playing');
    expect(r.turnId).toBe(JOHN.id);
    discard(r, JOHN.id, { card: r.players[0].hand[0].card.id }, t + 3);
    expect(r.phase).toBe('finished');
    expect(r.ending).toBe('deck');
    expect(r.turn).toBe(4);
  });
});

describe('the turn clock', () => {
  it('drops the oldest unhinted card for a player who runs out of time', () => {
    const r = room();
    const t = playing(r);
    hint(r, JOHN.id, { to: SAM.id, rank: r.players[1].hand[0].card.rank }, t);
    const hand = r.players[1].hand;
    const expected = hand.find((h) => h.knows.rank === null)!.card.id;
    expect(autoMove(r)).toEqual({ card: expected });
    expect(deadline(r)).toBe(t + TURN_MS.medium);
    expect(advance(r, t + TURN_MS.medium - 1, half)).toBe(false);
    expect(advance(r, t + TURN_MS.medium, half)).toBe(true);
    expect(r.discards.map((c) => c.id)).toEqual([expected]);
    expect(r.log.at(-1)).toMatchObject({ kind: 'discard', by: SAM.id, auto: true });
    expect(r.hints).toBe(MAX_HINTS);
    expect(r.turnId).toBe(JOHN.id);
    expect(deadline(r)).toBe(t + 2 * TURN_MS.medium);
  });

  it('still drops a card with every token in, for no token', () => {
    const r = room();
    const t = playing(r);
    advance(r, t + TURN_MS.medium, half);
    expect(r.discards).toHaveLength(1);
    expect(r.hints).toBe(MAX_HINTS);
  });

  it('ignores a clock that is not a number, and takes one step for a far-future one', () => {
    const r = room();
    const t = playing(r);
    expect(advance(r, Number.NaN, half)).toBe(false);
    expect(r.turn).toBe(0);
    advance(r, t + 1e12, half);
    expect(r.turn).toBe(1);
    expect(r.phase).toBe('playing');
  });
});

describe('leaving', () => {
  it('puts the leaver’s cards on the discards, passes their turn, and plays on', () => {
    const r = room([SAM, KIM]);
    const t = playing(r);
    const cards = r.players[0].hand.map((h) => h.card.id);
    leave(r, JOHN.id, t);
    expect(r.phase).toBe('playing');
    expect(r.hostId).toBe(SAM.id);
    expect(r.turnId).toBe(SAM.id);
    expect(r.discards.map((c) => c.id)).toEqual(cards);
    expect(r.misfires).toBe(0);
    expect(status(() => hint(r, SAM.id, { to: JOHN.id, rank: 1 }, t))[0]).toBe(400);
  });

  it('ends the show with the score so far when one player is left', () => {
    const r = room();
    const t = playing(r);
    r.stacks.red = 2;
    leave(r, SAM.id, t);
    expect(r.phase).toBe('finished');
    expect(r.ending).toBe('left');
    expect(standings(r).map((s) => [s.id, s.score, s.left])).toEqual([
      [JOHN.id, 2, false],
      [SAM.id, 2, true],
    ]);
  });

  it('plays again with the same table, cleared', () => {
    const r = room();
    const t = playing(r);
    leave(r, SAM.id, t);
    again(r, JOHN.id, t + 1);
    expect(r.phase).toBe('lobby');
    expect(r.players.map((p) => [p.status, p.hand.length])).toEqual([
      ['joined', 0],
      ['invited', 0],
    ]);
    expect(r.hints).toBe(MAX_HINTS);
    expect(r.log).toEqual([]);
  });
});

describe('the wire never shows a player their own cards', () => {
  /** Each viewer's own hand is one colour that appears nowhere else they can see. */
  function secretTable(difficulty: Difficulty = 'medium') {
    const r = room([SAM, KIM], difficulty);
    const t = playing(
      r,
      {
        p_john: [card('red', 1), card('red', 2), card('red', 3), card('red', 4), card('red', 5)],
        p_sam: [card('blue', 1), card('blue', 2), card('blue', 3), card('blue', 4), card('blue', 5)],
        p_kim: [card('green', 1), card('green', 2), card('green', 3), card('green', 4), card('green', 5)],
      },
      // The deck holds the yellows and whites: nobody may see them.
      [card('yellow', 3), card('white', 2), card('yellow', 4)],
    );
    return { r, t };
  }

  it('for each player: their own colour and the deck appear nowhere on their wire', () => {
    const { r, t } = secretTable();
    hint(r, JOHN.id, { to: SAM.id, rank: 3 }, t);
    for (const [id, secret] of [
      [JOHN.id, 'red'],
      [SAM.id, 'blue'],
      [KIM.id, 'green'],
    ] as const) {
      const wire = toWire(r, id, t);
      const json = JSON.stringify(wire);
      expect(json).not.toContain(`"colour":"${secret}"`);
      expect(json).not.toContain('"colour":"yellow"');
      expect(json).not.toContain('"colour":"white"');
      expect(json).not.toContain('"deck":[');
      const mine = wire.players.find((p) => p.id === id)!;
      expect(mine.hand.every((h) => h.colour === null && h.rank === null)).toBe(true);
      // Everyone else's cards, face up.
      for (const p of wire.players.filter((x) => x.id !== id)) expect(p.hand.every((h) => h.colour !== null)).toBe(true);
    }
    // Sam knows only what the hint said: which card is a 3.
    const sam = me(r, SAM.id);
    expect(sam.hand.map((h) => h.knows.ranks)).toEqual([[1, 2, 4, 5], [1, 2, 4, 5], [3], [1, 2, 4, 5], [1, 2, 4, 5]]);
    expect(sam.hand.every((h) => h.could === null)).toBe(true);
  });

  it('on easy, the "could be" counts only cards the viewer can see', () => {
    const { r, t } = secretTable('easy');
    const wire = toWire(r, JOHN.id, t);
    const json = JSON.stringify(wire);
    expect(json).not.toContain('"colour":"red"');
    // John sees all of Sam's blues and Kim's greens, so a blue 5 or green 5 cannot be his.
    const could = wire.players[0].hand[0].could!;
    expect(could.colours).toEqual(['red', 'yellow', 'green', 'blue', 'white']);
    expect(could.ranks).toEqual([1, 2, 3, 4, 5]);
    const fives = deduce(r, JOHN.id, { colours: [], notColours: [], rank: 5, notRanks: [] });
    expect(fives.colours).toEqual(['red', 'yellow', 'white']);
    // Deducing for John never read John's own hand: the red 5 he holds is still possible.
    expect(fives.colours).toContain('red');
  });

  it('shows every hand once the show is over', () => {
    const { r, t } = secretTable();
    leave(r, SAM.id, t);
    leave(r, KIM.id, t);
    const wire = toWire(r, JOHN.id, t);
    expect(wire.phase).toBe('finished');
    expect(wire.players[0].hand.map((h) => h.colour)).toEqual(['red', 'red', 'red', 'red', 'red']);
  });
});
