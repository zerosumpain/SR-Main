import { describe, expect, it } from 'vitest';
import {
  CARDS,
  CLUE_MS,
  COUNTDOWN_MS,
  GRACE_MS,
  GUESS_MS,
  LOBBY_MS,
  MAX_PLAYERS,
  REVEAL_MS,
  REVIEW_MS,
  about,
  advance,
  again,
  checkClue,
  clue,
  clueKey,
  createRoom,
  dealWords,
  deadline,
  done,
  guess,
  guessMatches,
  join,
  judge,
  leave,
  normalise,
  pass,
  standings,
  start,
  stem,
  toWire,
  unveto,
  veto,
  type Difficulty,
  type Room,
} from './one-clue';
import { EASY, HARD, MEDIUM, WORDS } from './words/one-clue';
import { roundRows } from './results';
import { GAMES } from './catalogue';

const T0 = 1_790_000_000_000;
/** Always the first of whatever is offered: the deck is the list's first ten, the first guesser seat 0. */
const first = () => 0;

const JOHN = { id: 'p_john', name: 'John' };
const SAM = { id: 'p_sam', name: 'Sam' };
const KIM = { id: 'p_kim', name: 'Kim' };
const ROBIN = { id: 'p_robin', name: 'Robin' };

function room(invite = [SAM, KIM, ROBIN], difficulty: Difficulty = 'easy'): Room {
  return createRoom({ id: 'g_1', host: JOHN, invite, difficulty, now: T0 });
}

/** Everyone joins, the host starts, the countdown runs down. Returns the clock at the first card. */
function dealt(r: Room, rng = first): number {
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, JOHN.id, T0);
  advance(r, T0 + COUNTDOWN_MS, rng);
  return T0 + COUNTDOWN_MS;
}

const givers = (r: Room) => r.card!.givers.filter((id) => r.players.find((p) => p.id === id)?.status === 'joined');

/** Every clue-giver writes a clue nobody else wrote, and the review is waved through. */
function toGuessing(r: Room, t: number): void {
  givers(r).forEach((id, n) => clue(r, id, { text: `hint${n}` }, t));
  if (r.phase === 'review') for (const id of givers(r)) done(r, id, t);
  expect(r.phase).toBe('guess');
}

/** Everyone still in says next. */
function next(r: Room, t: number): void {
  for (const p of r.players) if (p.status === 'joined') done(r, p.id, t);
}

const json = (r: Room, viewer: string, now: number) => JSON.stringify(toWire(r, viewer, now));

describe('the word lists', () => {
  it('are single lower-case words, distinct within and across levels, and enough for several games', () => {
    const all = [...EASY, ...MEDIUM, ...HARD];
    for (const w of all) expect(w).toMatch(/^[a-z]+$/);
    expect(new Set(all).size).toBe(all.length);
    for (const level of ['easy', 'medium', 'hard'] as const) expect(WORDS[level].length).toBeGreaterThanOrEqual(CARDS * 8);
  });

  it('deals ten different words and keeps the last game\'s off the next', () => {
    const a = dealWords('easy', first);
    expect(a).toHaveLength(CARDS);
    expect(new Set(a).size).toBe(CARDS);
    const b = dealWords('easy', first, a);
    expect(b.some((w) => a.includes(w))).toBe(false);
    const random = dealWords('hard', () => 0.999_999);
    expect(new Set(random).size).toBe(CARDS);
  });
});

describe('the checks', () => {
  it('normalises case, accents, punctuation and an article', () => {
    expect(normalise('  The Café! ')).toBe('cafe');
    expect(normalise("Dog's")).toBe('dogs');
    expect(normalise('ice-cream')).toBe('ice cream');
  });

  it('stems plurals and simple endings', () => {
    expect(stem('bakes')).toBe(stem('baking'));
    expect(stem('baked')).toBe(stem('bake'));
    expect(stem('running')).toBe(stem('run'));
    expect(stem('berries')).toBe(stem('berry'));
    expect(stem('boxes')).toBe(stem('box'));
    expect(stem('glass')).toBe('glass');
  });

  it('cancels empty, multi-word and too-close clues', () => {
    expect(checkClue(undefined, 'snow')).toBe('empty');
    expect(checkClue('  ', 'snow')).toBe('empty');
    expect(checkClue('cold white', 'snow')).toBe('not-one-word');
    expect(checkClue('!!!', 'snow')).toBe('not-one-word');
    expect(checkClue('Snow', 'snow')).toBe('too-close');
    expect(checkClue('SNÓWS', 'snow')).toBe('too-close');
    expect(checkClue('snowman', 'snow')).toBe('too-close');
    expect(checkClue('sun', 'sunset')).toBe('too-close');
    expect(checkClue('baking', 'bake')).toBe('too-close');
    expect(checkClue('the cold', 'snow')).toBe('ok');
    expect(checkClue('winter', 'snow')).toBe('ok');
    // Left to the family's vetoes: a misspelling, and a fair near-word.
    expect(checkClue('horse', 'house')).toBe('ok');
  });

  it('counts two clues the same once normalised and stemmed', () => {
    expect(clueKey('Trunks!')).toBe(clueKey('trunk'));
    expect(clueKey('Café')).toBe(clueKey('cafe'));
    expect(clueKey('trunk')).not.toBe(clueKey('tusk'));
  });

  it('accepts a guess with a trivial typo or plural, and nothing looser', () => {
    expect(guessMatches('Elephant', 'elephant')).toBe(true);
    expect(guessMatches('elephants', 'elephant')).toBe(true);
    expect(guessMatches('elephnat', 'elephant')).toBe(true);
    expect(guessMatches('elephent', 'elephant')).toBe(true);
    expect(guessMatches('the moon', 'moon')).toBe(true);
    expect(guessMatches('tooth brush', 'toothbrush')).toBe(true);
    expect(guessMatches('dentsit', 'dentist')).toBe(true);
    expect(guessMatches('imagnation', 'imagination')).toBe(true);
    // Another real word is a different guess, a short word has no slack, and the first letter counts.
    expect(guessMatches('horse', 'house')).toBe(false);
    expect(guessMatches('cat', 'car')).toBe(false);
    expect(guessMatches('mouse', 'house')).toBe(false);
    expect(guessMatches('elegant', 'elephant')).toBe(false);
    expect(guessMatches('', 'moon')).toBe(false);
  });
});

describe('the lobby', () => {
  it('seats up to seven and needs three to start', () => {
    const many = Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    expect(() => createRoom({ id: 'g', host: JOHN, invite: many, difficulty: 'easy', now: T0 })).toThrow(/Up to 7/);
    expect(() => createRoom({ id: 'g', host: JOHN, invite: many.slice(0, 6), difficulty: 'easy', now: T0 })).not.toThrow();
    const r = room([SAM, KIM]);
    join(r, SAM.id, T0);
    expect(() => start(r, JOHN.id, T0)).toThrow(/at least 3/);
    expect(() => start(r, SAM.id, T0)).toThrow(/Only the host/);
    join(r, KIM.id, T0);
    start(r, JOHN.id, T0);
    expect(r.phase).toBe('countdown');
    expect(about(r)).toBe('10 cards · a team game');
  });

  it('closes an unanswered lobby', () => {
    const r = room();
    expect(advance(r, T0 + LOBBY_MS, first)).toBe(true);
    expect(r.phase).toBe('closed');
  });

  it('ignores a clock that is not a number', () => {
    const r = room();
    dealt(r);
    const before = JSON.stringify(r);
    expect(advance(r, Number.NaN, first)).toBe(false);
    expect(advance(r, Number.POSITIVE_INFINITY, first)).toBe(false);
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('a card', () => {
  it('deals the first card to the first seat, with the word for the clue-givers', () => {
    const r = room();
    const t = dealt(r);
    expect(r.phase).toBe('clues');
    expect(r.card!.guesserId).toBe(JOHN.id);
    expect(givers(r)).toEqual([SAM.id, KIM.id, ROBIN.id]);
    expect(r.card!.word).toBe(EASY[0]);
    expect(deadline(r)).toBe(t + CLUE_MS.easy + GRACE_MS);
    expect(toWire(r, SAM.id, t).word).toBe(EASY[0]);
    expect(toWire(r, SAM.id, t).role).toBe('clue');
    expect(toWire(r, JOHN.id, t).word).toBeNull();
    expect(toWire(r, JOHN.id, t).role).toBe('guesser');
  });

  it('clocks scale with difficulty', () => {
    expect(CLUE_MS.easy).toBeGreaterThan(CLUE_MS.medium);
    expect(CLUE_MS.medium).toBeGreaterThan(CLUE_MS.hard);
    const r = room([SAM, KIM], 'hard');
    const t = dealt(r);
    expect(r.phaseEndsAt).toBe(t + CLUE_MS.hard);
    expect(HARD).toContain(r.card!.word);
  });

  it('refuses the guesser a clue, a clue outside its phase, and a guess from a clue-giver', () => {
    const r = room();
    const t = dealt(r);
    expect(() => clue(r, JOHN.id, { text: 'x' }, t)).toThrow(/guessing this one/);
    expect(() => clue(r, SAM.id, { text: 42 }, t)).toThrow(/some text/);
    expect(() => guess(r, JOHN.id, { text: 'apple' }, t)).toThrow(/time to guess/);
    expect(() => clue(r, SAM.id, { text: 'late' }, t + CLUE_MS.easy + GRACE_MS + 1)).toThrow(/Time's up/);
    toGuessing(r, t);
    expect(() => guess(r, SAM.id, { text: 'apple' }, t)).toThrow(/Only the guesser/);
    expect(() => guess(r, JOHN.id, { text: '   ' }, t)).toThrow(/Type a guess/);
  });

  it('opens the review once every clue-giver has written, cancels the duplicates, and shows the guesser only the survivors', () => {
    const r = room();
    const t = dealt(r); // apple
    clue(r, SAM.id, { text: 'Fruit' }, t + 1000);
    clue(r, KIM.id, { text: 'fruits' }, t + 2000);
    expect(r.phase).toBe('clues');
    clue(r, ROBIN.id, { text: 'Orchard' }, t + 3000);
    expect(r.phase).toBe('review');
    expect(r.phaseEndsAt).toBe(t + 3000 + REVIEW_MS);
    expect(judge(r, r.card!).map((c) => [c.playerId, c.status])).toEqual([
      [SAM.id, 'duplicate'],
      [KIM.id, 'duplicate'],
      [ROBIN.id, 'ok'],
    ]);
    for (const id of [SAM.id, KIM.id, ROBIN.id]) done(r, id, t + 4000);
    expect(r.phase).toBe('guess');
    const mine = toWire(r, JOHN.id, t + 4000);
    expect(mine.clues).toEqual([{ playerId: ROBIN.id, text: 'Orchard', status: 'ok', vetoes: 0, strikeAt: 0, vetoed: false }]);
    expect(mine.cancelledCount).toBe(2);
    expect(mine.word).toBeNull();
    expect(toWire(r, SAM.id, t + 4000).clues?.map((c) => c.status)).toEqual(['duplicate', 'duplicate', 'ok']);
  });

  it('skips the review when nothing survived the checks', () => {
    const r = room();
    const t = dealt(r); // apple
    clue(r, SAM.id, { text: 'apples' }, t);
    clue(r, KIM.id, { text: 'red fruit' }, t);
    clue(r, ROBIN.id, { text: 'Apple' }, t);
    expect(r.phase).toBe('guess');
    expect(toWire(r, JOHN.id, t).clues).toEqual([]);
    expect(toWire(r, JOHN.id, t).cancelledCount).toBe(3);
  });

  it('strikes a clue once half the other clue-givers veto it, and only clue-givers veto', () => {
    const r = room();
    const t = dealt(r);
    clue(r, SAM.id, { text: 'Fruit' }, t);
    clue(r, KIM.id, { text: 'Tree' }, t);
    clue(r, ROBIN.id, { text: 'Pomme' }, t);
    expect(r.phase).toBe('review');
    expect(() => veto(r, JOHN.id, { playerId: ROBIN.id }, t)).toThrow(/Only the clue-givers/);
    expect(() => veto(r, ROBIN.id, { playerId: ROBIN.id }, t)).toThrow(/your own/);
    // Two others: one veto of two strikes (half, rounded up).
    veto(r, SAM.id, { playerId: ROBIN.id }, t);
    veto(r, SAM.id, { playerId: ROBIN.id }, t); // idempotent
    let robin = judge(r, r.card!).find((c) => c.playerId === ROBIN.id)!;
    expect([robin.status, robin.vetoes, robin.strikeAt]).toEqual(['vetoed', 1, 1]);
    unveto(r, SAM.id, { playerId: ROBIN.id }, t);
    robin = judge(r, r.card!).find((c) => c.playerId === ROBIN.id)!;
    expect(robin.status).toBe('ok');
    veto(r, KIM.id, { playerId: ROBIN.id }, t);
    expect(toWire(r, KIM.id, t).clues?.find((c) => c.playerId === ROBIN.id)?.vetoed).toBe(true);
    expect(toWire(r, SAM.id, t).clues?.find((c) => c.playerId === ROBIN.id)?.vetoed).toBe(false);
    advance(r, t + REVIEW_MS, first);
    expect(r.phase).toBe('guess');
    const shown = toWire(r, JOHN.id, t + REVIEW_MS);
    expect(shown.clues?.map((c) => c.text)).toEqual(['Fruit', 'Tree']);
    expect(shown.cancelledCount).toBe(1);
  });

  it('a veto on a clue the checks already cancelled is refused', () => {
    const r = room();
    const t = dealt(r);
    clue(r, SAM.id, { text: 'Fruit' }, t);
    clue(r, KIM.id, { text: 'fruit' }, t);
    clue(r, ROBIN.id, { text: 'Tree' }, t);
    expect(() => veto(r, ROBIN.id, { playerId: SAM.id }, t)).toThrow(/already out/);
  });

  it('scores a right guess, shows everyone the answer, and moves the guesser round the table', () => {
    const r = room();
    const t = dealt(r);
    toGuessing(r, t + 1000);
    guess(r, JOHN.id, { text: 'Apples' }, t + 3000);
    expect(r.phase).toBe('reveal');
    expect(r.score).toBe(1);
    const w = toWire(r, JOHN.id, t + 3000);
    expect([w.outcome, w.word, w.guess]).toEqual(['correct', 'apple', 'Apples']);
    expect(w.clues?.length).toBe(3);
    next(r, t + 4000);
    expect(r.phase).toBe('clues');
    expect(r.card!.index).toBe(1);
    expect(r.card!.guesserId).toBe(SAM.id);
    expect(toWire(r, SAM.id, t + 4000).word).toBeNull();
  });

  it('a pass loses the card only; a wrong guess loses the next card too', () => {
    const r = room();
    const t = dealt(r);
    toGuessing(r, t);
    pass(r, JOHN.id, t);
    expect(r.played.map((c) => c.outcome)).toEqual(['passed']);
    next(r, t);
    expect(r.card!.index).toBe(1);
    toGuessing(r, t);
    guess(r, SAM.id, { text: 'grapefruit' }, t);
    expect(r.played.map((c) => c.outcome)).toEqual(['passed', 'wrong', 'discarded']);
    expect(toWire(r, SAM.id, t).cards[2]).toMatchObject({ index: 2, outcome: 'discarded', word: EASY[2] });
    next(r, t);
    expect(r.card!.index).toBe(3);
    expect(r.card!.word).toBe(EASY[3]);
    expect(r.score).toBe(0);
  });

  it('a wrong guess on the last card takes back a card already won', () => {
    const r = room();
    const t = dealt(r);
    for (let i = 0; i < CARDS - 1; i++) {
      toGuessing(r, t);
      guess(r, r.card!.guesserId, { text: r.card!.word }, t);
      next(r, t);
    }
    expect(r.card!.index).toBe(CARDS - 1);
    expect(r.score).toBe(CARDS - 1);
    toGuessing(r, t);
    guess(r, r.card!.guesserId, { text: 'nothing like it' }, t);
    expect(r.score).toBe(CARDS - 2);
    expect(toWire(r, JOHN.id, t).tookBack).toBe(true);
    next(r, t);
    expect(r.phase).toBe('finished');
  });
});

describe('the clock', () => {
  it('a stalled table never freezes: empty clues, a closed review, a passing guesser, the next card', () => {
    const r = room();
    const t = dealt(r);
    clue(r, SAM.id, { text: 'Fruit' }, t);
    clue(r, KIM.id, { text: 'Tree' }, t);
    // Robin never writes; the clue clock runs out and the review opens.
    let now = t + CLUE_MS.easy + GRACE_MS;
    advance(r, now, first);
    expect(r.phase).toBe('review');
    expect(judge(r, r.card!).find((c) => c.playerId === ROBIN.id)?.status).toBe('empty');
    now += REVIEW_MS;
    advance(r, now, first);
    expect(r.phase).toBe('guess');
    now += GUESS_MS + GRACE_MS;
    advance(r, now, first);
    expect(r.phase).toBe('reveal');
    expect(r.played[0].outcome).toBe('timeout');
    now += REVEAL_MS;
    advance(r, now, first);
    expect(r.phase).toBe('clues');
    expect(r.card!.index).toBe(1);
  });

  it('a room nobody touches plays itself out in one catch-up, and closes', () => {
    const r = room();
    dealt(r);
    advance(r, T0 + 24 * 3_600_000, first);
    expect(r.phase).toBe('closed');
    expect(r.played).toHaveLength(CARDS);
    expect(r.played.every((c) => c.outcome === 'timeout')).toBe(true);
  });
});

describe('leaving', () => {
  it('the guesser leaving loses the card and the next guesser carries on', () => {
    const r = room();
    const t = dealt(r);
    clue(r, SAM.id, { text: 'Fruit' }, t);
    leave(r, JOHN.id, t);
    expect(r.phase).toBe('reveal');
    expect(r.played[0].outcome).toBe('left');
    expect(r.hostId).toBe(SAM.id);
    next(r, t);
    expect(r.card!.guesserId).toBe(SAM.id);
    expect(r.card!.givers).toEqual([KIM.id, ROBIN.id]);
  });

  it('a clue-giver leaving stops the table waiting on them', () => {
    const r = room();
    const t = dealt(r);
    clue(r, SAM.id, { text: 'Fruit' }, t);
    clue(r, KIM.id, { text: 'Tree' }, t);
    leave(r, ROBIN.id, t);
    expect(r.phase).toBe('review');
    done(r, SAM.id, t);
    leave(r, KIM.id, t);
    // Two left (John guessing, Sam): Sam was the last undecided — on to the guess.
    expect(r.phase).toBe('guess');
  });

  it('down to one, the game ends with the score so far', () => {
    const r = room([SAM, KIM]);
    const t = dealt(r);
    toGuessing(r, t);
    guess(r, JOHN.id, { text: 'apple' }, t);
    next(r, t);
    leave(r, KIM.id, t);
    expect(r.phase).toBe('clues');
    leave(r, JOHN.id, t);
    expect(r.phase).toBe('finished');
    expect(standings(r)).toEqual([{ id: SAM.id, name: 'Sam', score: 1, guessed: 0, clues: 1 }]);
  });
});

describe('finishing', () => {
  it('everyone shares the team score; nobody wins; the recorder ranks them all first', () => {
    const r = room();
    const t = dealt(r);
    for (let i = 0; i < CARDS; i++) {
      toGuessing(r, t);
      if (i % 2 === 0) guess(r, r.card!.guesserId, { text: r.card!.word }, t);
      else pass(r, r.card!.guesserId, t);
      next(r, t);
    }
    expect(r.phase).toBe('finished');
    const w = toWire(r, SAM.id, t);
    expect(w.standings?.map((s) => s.score)).toEqual([5, 5, 5, 5]);
    expect(w.winnerIds).toEqual([]);
    expect(w.verdict).toBe('Not bad at all.');
    const rows = roundRows(r, GAMES['one-clue'], 1, t);
    expect(rows.map((x) => [x.score, x.rank, x.won])).toEqual([
      [5, 1, false],
      [5, 1, false],
      [5, 1, false],
      [5, 1, false],
    ]);
  });

  it('plays again with fresh words', () => {
    const r = room();
    const t = dealt(r);
    while (r.phase !== 'finished') advance(r, deadline(r)!, first);
    const words = r.deck.slice();
    again(r, JOHN.id, t);
    expect(r.phase).toBe('lobby');
    start(r, JOHN.id, t);
    advance(r, t + COUNTDOWN_MS, first);
    expect(r.deck.some((w) => words.includes(w))).toBe(false);
    expect(r.score).toBe(0);
  });
});

describe('the wire never leaks', () => {
  /** Plays card one to `phase` and returns everyone's wire as JSON, by player. */
  function at(phase: 'clues' | 'review' | 'guess') {
    const r = room();
    const t = dealt(r); // apple; John guesses
    if (phase !== 'clues') {
      clue(r, SAM.id, { text: 'Crunchy' }, t);
      clue(r, KIM.id, { text: 'Pie' }, t);
      clue(r, ROBIN.id, { text: 'apples' }, t); // too close: cancelled
    } else {
      clue(r, SAM.id, { text: 'Crunchy' }, t);
      clue(r, KIM.id, { text: 'Pie' }, t);
    }
    if (phase === 'guess') for (const id of [SAM.id, KIM.id, ROBIN.id]) done(r, id, t);
    expect(r.phase).toBe(phase);
    return { r, t };
  }

  it('the rest of the deck is never on anybody\'s wire', () => {
    const { r, t } = at('clues');
    for (const p of r.players) {
      const text = json(r, p.id, t);
      for (const w of r.deck.slice(1)) expect(text).not.toMatch(new RegExp(`"${w}"`));
    }
  });

  it('while writing: the guesser has no word and no clue; each clue-giver has only their own', () => {
    const { r, t } = at('clues');
    const guesser = json(r, JOHN.id, t);
    expect(guesser).not.toContain('apple');
    expect(guesser).not.toContain('Crunchy');
    expect(guesser).not.toContain('Pie');
    const sam = json(r, SAM.id, t);
    expect(sam).toContain('Crunchy');
    expect(sam).not.toContain('Pie');
    const kim = json(r, KIM.id, t);
    expect(kim).toContain('Pie');
    expect(kim).not.toContain('Crunchy');
    // Everyone may see who has written one.
    expect(toWire(r, JOHN.id, t).players.filter((p) => p.submitted).map((p) => p.id)).toEqual([SAM.id, KIM.id]);
  });

  it('in the review: the guesser has no word and no clue, cancelled or not', () => {
    const { r, t } = at('review');
    const guesser = json(r, JOHN.id, t);
    for (const s of ['apple', 'Crunchy', 'Pie']) expect(guesser).not.toContain(s);
    const sam = json(r, SAM.id, t);
    for (const s of ['apple', 'Crunchy', 'Pie', 'apples']) expect(sam).toContain(s);
  });

  it('while guessing: the guesser has the survivors only — never the word or a cancelled clue', () => {
    const { r, t } = at('guess');
    const guesser = json(r, JOHN.id, t);
    expect(guesser).toContain('Crunchy');
    expect(guesser).toContain('Pie');
    expect(guesser).not.toContain('apple'); // neither the word nor Robin's "apples"
    expect(toWire(r, JOHN.id, t).cancelledCount).toBe(1);
    expect(json(r, SAM.id, t)).toContain('apples');
  });

  it('a player who left before the reveal gets no word and no clues', () => {
    const { r, t } = at('review');
    leave(r, ROBIN.id, t);
    const robin = json(r, ROBIN.id, t);
    for (const s of ['apple', 'Crunchy', 'Pie']) expect(robin).not.toContain(s);
  });

  it('from the reveal, everybody sees the word and every clue', () => {
    const { r, t } = at('guess');
    pass(r, JOHN.id, t);
    for (const p of r.players) {
      const text = json(r, p.id, t);
      for (const s of ['apple', 'Crunchy', 'Pie', 'apples']) expect(text).toContain(s);
    }
  });
});
