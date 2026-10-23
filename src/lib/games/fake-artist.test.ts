import { describe, expect, it } from 'vitest';
import {
  about,
  accused,
  advance,
  again,
  createRoom,
  decline,
  dealWord,
  deadline,
  guess,
  guessMatches,
  join,
  leave,
  player,
  start,
  stroke,
  toWire,
  vote,
  voteCounts,
  wordsFor,
  ARTIST_POINTS,
  COLORS,
  COUNTDOWN_MS,
  FAKE_POINTS,
  GUESS_MS,
  LAPS,
  MAX_LINE_POINTS,
  MAX_LOG,
  MAX_PLAYERS,
  MAX_POST_POINTS,
  READ_MS,
  REVEAL_MS,
  TURN_MS,
  VOTE_MS,
  type Room,
} from './fake-artist';
import { ALL_WORDS, CATEGORIES } from './words/fake-artist';

const T0 = 1_790_000_000_000;
const first = () => 0;

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };
const ada = { id: 'p_ada', name: 'Ada' };
const bo = { id: 'p_bo', name: 'Bo' };

/** The secret word every hidden-information test forces, so a search for it means something. */
const SECRET = 'kaleidoscope';

/**
 * John (host), Sam, Kim and Ada, started and counted down with `rng` (the
 * first candidate: John is the first round's fake). `extra` are invited and
 * left unanswered, so they are declined at the start.
 */
function reading(options: Record<string, unknown> = {}, extra: { id: string; name: string }[] = []): Room {
  const people = [sam, kim, ada];
  const room = createRoom({ id: 'g_1', host: john, invite: [...people, ...extra], difficulty: 'medium', options, now: T0 });
  for (const p of people) join(room, p.id, T0);
  start(room, john.id, T0);
  advance(room, T0 + COUNTDOWN_MS, first);
  room.round!.word = SECRET;
  return room;
}

/** …and the card has been read: the first turn is open. */
function drawingRoom(options: Record<string, unknown> = {}): Room {
  const room = reading(options);
  advance(room, T0 + COUNTDOWN_MS + READ_MS, first);
  return room;
}

const nowOf = (room: Room) => room.updatedAt;

/** Everyone draws a short line in turn until the vote opens. */
function drawAll(room: Room): void {
  while (room.phase === 'drawing') {
    const who = room.round!.turns[room.round!.turn];
    stroke(room, who, { points: [[100, 100], [200, 200]], end: true }, nowOf(room) + 1_000);
  }
}

const json = (room: Room, me: string) => JSON.stringify(toWire(room, me, nowOf(room)));

describe('the word list', () => {
  it('has categories of distinct, plain lowercase words in three tiers', () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(12);
    for (const c of CATEGORIES) {
      const all = [...c.easy, ...c.medium, ...c.hard];
      expect(new Set(all).size, c.name).toBe(all.length);
      expect(c.easy.length).toBeGreaterThanOrEqual(6);
      expect(c.medium.length).toBeGreaterThanOrEqual(6);
      expect(c.hard.length).toBeGreaterThanOrEqual(6);
      for (const w of all) expect(w).toMatch(/^[a-z]+( [a-z]+)*$/);
    }
    expect(ALL_WORDS.length).toBeGreaterThan(250);
  });

  it('deals no trademarked toy or brand names', () => {
    const brands = ['slinky', 'lego', 'frisbee', 'play doh', 'playdoh', 'barbie', 'rubik', 'hula hoop', 'jenga', 'monopoly'];
    for (const b of brands) expect(ALL_WORDS, b).not.toContain(b);
  });

  it('draws easy from the common words and hard from the less common', () => {
    const animals = CATEGORIES[0];
    expect(wordsFor('easy', animals)).toEqual(animals.easy);
    expect(wordsFor('medium', animals)).toEqual([...animals.easy, ...animals.medium]);
    expect(wordsFor('hard', animals)).toEqual([...animals.medium, ...animals.hard]);
  });

  it('never deals a word already used this game, until they run out', () => {
    const used = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { word } = dealWord('easy', used, () => (i * 0.37) % 1);
      expect(used.has(word)).toBe(false);
      used.add(word);
    }
    const everything = new Set(CATEGORIES.flatMap((c) => c.easy));
    expect(dealWord('easy', everything, first).word).toBeTruthy();
  });
});

describe("the fake's guess", () => {
  it('forgives case, articles, plurals, spaces and one typo on a longer word', () => {
    expect(guessMatches('The Kaleidoscope', 'kaleidoscope')).toBe(true);
    expect(guessMatches('kaleidoscopes', 'kaleidoscope')).toBe(true);
    expect(guessMatches('kalidoscope', 'kaleidoscope')).toBe(true);
    expect(guessMatches('hotairballoon', 'hot air balloon')).toBe(true);
    expect(guessMatches('hot-air balloon', 'hot air balloon')).toBe(true);
    expect(guessMatches('bat', 'cat')).toBe(false);
    expect(guessMatches('telescope', 'kaleidoscope')).toBe(false);
    expect(guessMatches('   ', 'cat')).toBe(false);
  });
});

describe('lobby', () => {
  it('takes the rounds option, defaulting what is unknown, and says so on the invite', () => {
    const r = (options: Record<string, unknown>) =>
      createRoom({ id: 'g', host: john, invite: [], difficulty: 'hard', options, now: T0 });
    expect(r({ rounds: 5 }).rounds).toBe(5);
    expect(r({ rounds: 4 }).rounds).toBe(3);
    expect(r({}).rounds).toBe(3);
    expect(about(r({ rounds: 5 }))).toBe('5 rounds · 15 s a line');
  });

  it('needs four to start, and holds up to ten', () => {
    const room = createRoom({ id: 'g', host: john, invite: [sam, kim, ada], difficulty: 'easy', now: T0 });
    join(room, sam.id, T0);
    join(room, kim.id, T0);
    expect(() => start(room, john.id, T0)).toThrow(/at least four/);
    join(room, ada.id, T0);
    expect(() => start(room, sam.id, T0)).toThrow(/Only the host/);
    start(room, john.id, T0);
    expect(room.phase).toBe('countdown');
    expect(room.players.map((p) => p.color)).toEqual(COLORS.slice(0, 4));

    const many = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    expect(createRoom({ id: 'g', host: john, invite: many, difficulty: 'easy', now: T0 }).players).toHaveLength(10);
    expect(() =>
      createRoom({ id: 'g', host: john, invite: [...many, { id: 'p_x', name: 'X' }], difficulty: 'easy', now: T0 }),
    ).toThrow(/Up to 10/);
  });

  it('play again never takes the table past the cap, so no two players share a colour', () => {
    const many = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    const room = createRoom({ id: 'g', host: john, invite: many, difficulty: 'easy', now: T0 });
    for (const p of many.slice(0, 6)) join(room, p.id, T0);
    for (const p of many.slice(6)) decline(room, p.id, T0);
    // As `inviteTo` would: three newcomers fill the seats the decliners left.
    for (let i = 0; i < 3; i++) room.players.push(player(`p_new${i}`, `N${i}`, 'invited'));
    for (let i = 0; i < 3; i++) join(room, `p_new${i}`, T0);
    expect(room.players).toHaveLength(13);
    room.phase = 'finished';
    leave(room, 'p_0', T0);
    again(room, john.id, T0);
    const inPlay = room.players.filter((p) => p.status === 'joined' || p.status === 'invited');
    expect(inPlay).toHaveLength(MAX_PLAYERS);
    // The one who played last game is asked back before those who declined.
    expect(room.players.find((p) => p.id === 'p_0')!.status).toBe('invited');
    expect(room.players.filter((p) => p.status === 'declined')).toHaveLength(3);
    for (const p of room.players) if (p.status === 'invited') join(room, p.id, T0);
    start(room, john.id, T0);
    const colours = room.players.filter((p) => p.status === 'joined').map((p) => p.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('start refuses more than the cap', () => {
    const many = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ id: `p_${i}`, name: `P${i}` }));
    const room = createRoom({ id: 'g', host: john, invite: many, difficulty: 'easy', now: T0 });
    room.players.push(player('p_x', 'X', 'invited'));
    for (const p of room.players) join(room, p.id, T0);
    expect(() => start(room, john.id, T0)).toThrow(/Up to 10/);
  });

  it('a host leaving the lobby cancels it', () => {
    const room = createRoom({ id: 'g', host: john, invite: [sam], difficulty: 'easy', now: T0 });
    leave(room, john.id, T0);
    expect(room.phase).toBe('closed');
  });
});

describe('a round', () => {
  it('deals a category, a word and a fake, then each player draws twice in turn', () => {
    const room = reading();
    expect(room.phase).toBe('reading');
    expect(room.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + READ_MS);
    const round = room.round!;
    expect(round.fakeId).toBe(john.id);
    expect(round.turns).toEqual([john.id, sam.id, kim.id, ada.id, john.id, sam.id, kim.id, ada.id]);
    expect(round.turns).toHaveLength(4 * LAPS);
    advance(room, T0 + COUNTDOWN_MS + READ_MS, first);
    expect(room.phase).toBe('drawing');
    expect(room.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + READ_MS + TURN_MS.medium);
  });

  it('takes one continuous line from the artist in turn, numbered by the server, in their colour', () => {
    const room = drawingRoom();
    const t = nowOf(room);
    expect(() => stroke(room, sam.id, { points: [[1, 1]] }, t)).toThrow(/not your turn/);
    // An id or colour the phone sends is ignored: the server numbers and inks the line.
    const posted = { id: 99, color: 'pink', points: [[10, 10], [20, 20]] };
    stroke(room, john.id, posted, t + 100);
    stroke(room, john.id, { points: [[30, 30.6], [-5, 2000]] }, t + 200);
    expect(room.drawing.lines).toEqual([
      { id: 1, playerId: john.id, color: 'red', width: 14, points: [[10, 10], [20, 20], [30, 31], [0, 1000]] },
    ]);
    expect(room.round!.turn).toBe(0);
    stroke(room, john.id, { end: true }, t + 300);
    expect(room.round!.turn).toBe(1);
    expect(() => stroke(room, john.id, { points: [[1, 1]] }, t + 400)).toThrow(/not your turn/);
    expect(() => stroke(room, sam.id, { end: true }, t + 400)).toThrow(/needs points/);
    expect(() => stroke(room, sam.id, { points: 'no' }, t + 400)).toThrow(/pairs/);
    expect(() => stroke(room, sam.id, { points: [[1, Number.NaN]] }, t + 400)).toThrow(/pairs/);
    const tooMany = Array.from({ length: MAX_POST_POINTS + 1 }, () => [1, 1]);
    expect(() => stroke(room, sam.id, { points: tooMany }, t + 400)).toThrow(/Up to/);
    for (let i = 0; i < MAX_LINE_POINTS / MAX_POST_POINTS; i++) {
      stroke(room, sam.id, { points: Array.from({ length: MAX_POST_POINTS }, () => [5, 5]) }, t + 500);
    }
    // A full line lifts itself: the turn moves on without waiting for `end`.
    expect(room.round!.turn).toBe(2);
    expect(() => stroke(room, sam.id, { points: [[1, 1]] }, t + 600)).toThrow(/not your turn/);
    expect(room.drawing.lines.map((l) => [l.id, l.color])).toEqual([
      [1, 'red'],
      [2, 'blue'],
    ]);
  });

  it('drops points past the line cap and still honours the lift, never refusing the post', () => {
    const room = drawingRoom();
    const t = nowOf(room);
    const post = () => Array.from({ length: MAX_POST_POINTS }, () => [5, 5]);
    for (let i = 0; i < MAX_LINE_POINTS / MAX_POST_POINTS - 1; i++) stroke(room, john.id, { points: post() }, t + 100);
    stroke(room, john.id, { points: Array.from({ length: 100 }, () => [6, 6]) }, t + 200);
    expect(room.round!.turn).toBe(0);
    // 1300 drawn; this post of 300 with the lift crosses the cap: 200 kept, the lift kept.
    stroke(room, john.id, { points: post(), end: true }, t + 300);
    expect(room.drawing.lines[0].points).toHaveLength(MAX_LINE_POINTS);
    expect(room.round!.turn).toBe(1);
    expect(room.round!.skipped).toEqual([]);
  });

  it('skips a turn nobody drew, and keeps a line cut short by the clock', () => {
    const room = drawingRoom();
    const t = nowOf(room);
    advance(room, t + TURN_MS.medium, first);
    expect(room.round!.skipped).toEqual([0]);
    expect(room.round!.turn).toBe(1);
    stroke(room, sam.id, { points: [[1, 1], [2, 2]] }, t + TURN_MS.medium + 100);
    advance(room, t + 2 * TURN_MS.medium, first);
    expect(room.round!.skipped).toEqual([0]);
    expect(room.round!.turn).toBe(2);
    expect(room.drawing.lines).toHaveLength(1);
  });

  it('goes to the vote after the last line', () => {
    const room = drawingRoom();
    drawAll(room);
    expect(room.phase).toBe('voting');
    expect(room.drawing.lines).toHaveLength(8);
    expect(room.phaseEndsAt).toBe(nowOf(room) + VOTE_MS);
  });
});

describe('never leaking the secret', () => {
  it("keeps the word out of the fake's wire, and the fake out of every artist's, in every phase until the reveal", () => {
    const room = reading({}, [bo]);
    const fake = room.round!.fakeId;
    const everyone = [john.id, sam.id, kim.id, ada.id];
    const check = () => {
      for (const me of everyone) {
        const wire = json(room, me);
        if (me === fake) {
          expect(wire, `${room.phase}: the fake sees the word`).not.toContain(SECRET);
          expect(wire).toContain('"role":"fake"');
        } else {
          expect(wire, `${room.phase}: an artist is told who the fake is`).not.toContain(`"fakeId":"${fake}"`);
          expect(wire).not.toContain('"role":"fake"');
          expect(wire).toContain(SECRET);
        }
      }
      // Bo declined: not dealt in, told nothing.
      const watching = json(room, bo.id);
      expect(watching).not.toContain(SECRET);
      expect(watching).not.toContain(`"fakeId":"${fake}"`);
    };
    check();
    advance(room, T0 + COUNTDOWN_MS + READ_MS, first);
    check();
    drawAll(room);
    expect(room.phase).toBe('voting');
    check();
  });

  it('shows each voter only their own vote until the reveal', () => {
    const room = drawingRoom();
    drawAll(room);
    const t = nowOf(room);
    vote(room, sam.id, { playerId: kim.id }, t);
    vote(room, kim.id, { playerId: ada.id }, t);
    for (const me of [john.id, ada.id]) {
      const w = toWire(room, me, t);
      expect(w.current!.votes).toBeNull();
      expect(w.current!.counts).toBeNull();
      expect(w.current!.myVote).toBeNull();
      expect(w.current!.voted).toEqual([sam.id, kim.id]);
      const s = JSON.stringify(w);
      expect(s).not.toContain(`"${sam.id}":"${kim.id}"`);
      expect(s).not.toContain(`"${kim.id}":"${ada.id}"`);
    }
    expect(toWire(room, sam.id, t).current!.myVote).toBe(kim.id);
    // Sam changes their mind before the vote closes.
    vote(room, sam.id, { playerId: ada.id }, t + 1);
    expect(toWire(room, sam.id, t).current!.myVote).toBe(ada.id);
  });

  it('opens everything at the reveal', () => {
    const room = drawingRoom();
    drawAll(room);
    advance(room, nowOf(room) + VOTE_MS, first);
    expect(room.phase).toBe('reveal');
    for (const me of [john.id, sam.id]) {
      const w = toWire(room, me, nowOf(room));
      expect(w.current!.word).toBe(SECRET);
      expect(w.current!.fakeId).toBe(john.id);
      expect(w.current!.votes).toEqual({});
    }
  });
});

describe('the vote', () => {
  function voting(): Room {
    const room = drawingRoom();
    drawAll(room);
    return room;
  }

  it('refuses a vote for yourself, for nobody, or outside the vote', () => {
    const room = drawingRoom();
    expect(() => vote(room, sam.id, { playerId: john.id }, nowOf(room))).toThrow(/not time/);
    drawAll(room);
    expect(() => vote(room, sam.id, { playerId: sam.id }, nowOf(room))).toThrow(/yourself/);
    expect(() => vote(room, sam.id, { playerId: 'p_nobody' }, nowOf(room))).toThrow(/still playing/);
  });

  it('needs a strict plurality alone: a tie lets the fake escape and score', () => {
    expect(accused({ a: 2, b: 2 })).toBeNull();
    expect(accused({ a: 2, b: 1 })).toBe('a');
    expect(accused({})).toBeNull();
    const room = voting();
    const t = nowOf(room);
    vote(room, john.id, { playerId: sam.id }, t);
    vote(room, sam.id, { playerId: john.id }, t);
    vote(room, kim.id, { playerId: john.id }, t);
    vote(room, ada.id, { playerId: sam.id }, t);
    expect(room.phase).toBe('reveal');
    expect(room.round!.outcome).toBe('escaped');
    expect(room.round!.accusedId).toBeNull();
    expect(room.players.find((p) => p.id === john.id)!.score).toBe(FAKE_POINTS);
    expect(room.players.filter((p) => p.id !== john.id).every((p) => p.score === 0)).toBe(true);
  });

  it('an artist accused alone lets the fake escape', () => {
    const room = voting();
    advance(room, nowOf(room), first);
    const t = nowOf(room);
    vote(room, sam.id, { playerId: kim.id }, t);
    advance(room, t + VOTE_MS, first);
    expect(room.round!.accusedId).toBe(kim.id);
    expect(room.round!.outcome).toBe('escaped');
  });

  it('a caught fake gets one guess: right still wins', () => {
    const room = voting();
    const t = nowOf(room);
    for (const p of [sam, kim, ada]) vote(room, p.id, { playerId: john.id }, t);
    vote(room, john.id, { playerId: sam.id }, t);
    expect(room.phase).toBe('guessing');
    expect(toWire(room, sam.id, t).current!.fakeId).toBe(john.id);
    // Still no word for the fake while they guess.
    expect(json(room, john.id)).not.toContain(SECRET);
    expect(() => guess(room, sam.id, { text: SECRET }, t)).toThrow(/Only the fake/);
    guess(room, john.id, { text: 'Kaleidoscopes' }, t + 1);
    expect(room.round!.outcome).toBe('guessed');
    expect(room.players.find((p) => p.id === john.id)!.score).toBe(FAKE_POINTS);
    expect(toWire(room, kim.id, t).current!.guess).toBe('Kaleidoscopes');
  });

  it('a caught fake who guesses wrong, or not at all, loses: each artist scores', () => {
    const wrong = voting();
    for (const p of [sam, kim, ada]) vote(wrong, p.id, { playerId: john.id }, nowOf(wrong));
    vote(wrong, john.id, { playerId: sam.id }, nowOf(wrong));
    guess(wrong, john.id, { text: 'telescope' }, nowOf(wrong));
    expect(wrong.round!.outcome).toBe('caught');
    expect(wrong.round!.awarded).toEqual({ p_sam: ARTIST_POINTS, p_kim: ARTIST_POINTS, p_ada: ARTIST_POINTS });

    const silent = voting();
    for (const p of [sam, kim, ada]) vote(silent, p.id, { playerId: john.id }, nowOf(silent));
    advance(silent, nowOf(silent) + VOTE_MS, first);
    expect(silent.phase).toBe('guessing');
    advance(silent, nowOf(silent) + GUESS_MS, first);
    expect(silent.round!.outcome).toBe('caught');
    expect(silent.players.find((p) => p.id === sam.id)!.score).toBe(1);
  });
});

describe('leaving', () => {
  it('the fake leaving ends the round for the artists', () => {
    const room = drawingRoom();
    leave(room, john.id, nowOf(room) + 1);
    expect(room.phase).toBe('reveal');
    expect(room.round!.outcome).toBe('fake-left');
    expect(room.round!.awarded).toEqual({ p_sam: 1, p_kim: 1, p_ada: 1 });
    expect(room.hostId).toBe(sam.id);
  });

  it('an artist leaving in their turn passes it on, and loses their later turns and vote', () => {
    const room = drawingRoom();
    stroke(room, john.id, { points: [[1, 1]], end: true }, nowOf(room));
    expect(room.round!.turns[room.round!.turn]).toBe(sam.id);
    leave(room, sam.id, nowOf(room) + 1);
    expect(room.round!.turns[room.round!.turn]).toBe(kim.id);
    drawAll(room);
    expect(room.drawing.lines.map((l) => l.playerId)).not.toContain(sam.id);
    expect(room.phase).toBe('voting');
    // Three left: the vote closes when those three have voted.
    vote(room, john.id, { playerId: kim.id }, nowOf(room));
    vote(room, kim.id, { playerId: ada.id }, nowOf(room));
    vote(room, ada.id, { playerId: kim.id }, nowOf(room));
    expect(room.phase).toBe('reveal');
  });

  it('a vote for somebody who then leaves no longer counts', () => {
    const room = drawingRoom();
    drawAll(room);
    vote(room, kim.id, { playerId: ada.id }, nowOf(room));
    leave(room, ada.id, nowOf(room));
    expect(voteCounts(room)).toEqual({});
  });

  it('a leaver does not reveal who had voted for them', () => {
    const room = createRoom({ id: 'g_1', host: john, invite: [sam, kim, ada, bo], difficulty: 'medium', now: T0 });
    for (const p of [sam, kim, ada, bo]) join(room, p.id, T0);
    start(room, john.id, T0);
    advance(room, T0 + COUNTDOWN_MS, first);
    advance(room, T0 + COUNTDOWN_MS + READ_MS, first);
    drawAll(room);
    // John is the fake; Sam votes for Kim, Ada votes for John.
    vote(room, sam.id, { playerId: kim.id }, nowOf(room));
    vote(room, ada.id, { playerId: john.id }, nowOf(room));
    const votedFor = (me: string) => toWire(room, me, nowOf(room)).current!.voted;
    expect(votedFor(john.id)).toEqual([sam.id, ada.id]);
    leave(room, kim.id, nowOf(room));
    expect(room.phase).toBe('voting');
    expect(votedFor(john.id)).toEqual([sam.id, ada.id]);
    expect(voteCounts(room)).toEqual({ [john.id]: 1 });
    // Sam may still change the vote that no longer counts.
    vote(room, sam.id, { playerId: john.id }, nowOf(room));
    expect(voteCounts(room)).toEqual({ [john.id]: 2 });
  });

  it('fewer than three left finishes the game', () => {
    const room = drawingRoom();
    leave(room, sam.id, nowOf(room));
    expect(room.phase).toBe('drawing');
    leave(room, kim.id, nowOf(room));
    expect(room.phase).toBe('finished');
  });
});

describe('the clock', () => {
  it('ignores a clock that is not a number', () => {
    const room = drawingRoom();
    const before = JSON.stringify(room);
    expect(advance(room, Number.NaN, first)).toBe(false);
    expect(advance(room, Number.POSITIVE_INFINITY, first)).toBe(false);
    expect(JSON.stringify(room)).toBe(before);
  });

  it('takes one step per call on a stale clock', () => {
    const room = drawingRoom();
    const late = nowOf(room) + 10 * 60_000;
    expect(advance(room, late, first)).toBe(true);
    expect(room.round!.turn).toBe(1);
    expect(room.phaseEndsAt).toBe(late + TURN_MS.medium);
    expect(deadline(room)).toBe(late + TURN_MS.medium);
  });
});

describe('the drawing as changes', () => {
  it('sends only the segments after `since`, the whole picture for an old cursor, and a fresh one each round', () => {
    const room = drawingRoom();
    const t = nowOf(room);
    stroke(room, john.id, { points: [[1, 1], [2, 2]] }, t);
    const held = room.revision;
    stroke(room, john.id, { points: [[3, 3]] }, t);
    const delta = toWire(room, sam.id, t, held).drawing!;
    expect(delta.strokes).toBeNull();
    expect(delta.ops).toEqual([{ seq: held + 1, op: 'stroke', id: 1, color: 'red', width: 14, points: [[3, 3]] }]);
    const whole = toWire(room, sam.id, t, null).drawing!;
    expect(whole.ops).toBeNull();
    expect(whole.strokes).toEqual([{ id: 1, color: 'red', width: 14, points: [[1, 1], [2, 2], [3, 3]] }]);
    // Past the log's reach: the whole picture.
    for (let i = 0; i < MAX_LOG + 5; i++) stroke(room, john.id, { points: [[4, 4]] }, t);
    expect(toWire(room, sam.id, t, held).drawing!.strokes).not.toBeNull();
  });

  it('starts each round on a new revision with an empty picture', () => {
    const room = drawingRoom();
    drawAll(room);
    advance(room, nowOf(room) + VOTE_MS, first);
    const old = room.revision;
    advance(room, nowOf(room) + REVEAL_MS, first);
    expect(room.phase).toBe('reading');
    expect(room.round!.number).toBe(2);
    expect(room.revision).toBe(old + 1);
    const w = toWire(room, sam.id, nowOf(room), old).drawing!;
    expect(w.strokes).toEqual([]);
  });
});

describe('a whole game', () => {
  it('plays every round with a new fake each time, then finishes with standings', () => {
    let k = 0;
    const rng = () => [0.99, 0.5, 0.2, 0.7, 0.1][k++ % 5];
    const room = createRoom({ id: 'g', host: john, invite: [sam, kim, ada, bo], difficulty: 'easy', options: { rounds: 5 }, now: T0 });
    for (const p of [sam, kim, ada, bo]) join(room, p.id, T0);
    start(room, john.id, T0);
    advance(room, T0 + COUNTDOWN_MS, rng);
    const fakes: string[] = [];
    while (room.phase !== 'finished') {
      expect(room.phase).toBe('reading');
      fakes.push(room.round!.fakeId);
      advance(room, nowOf(room) + READ_MS, rng);
      drawAll(room);
      advance(room, nowOf(room) + VOTE_MS, rng);
      expect(room.phase).toBe('reveal');
      advance(room, nowOf(room) + REVEAL_MS, rng);
    }
    expect(fakes).toHaveLength(5);
    for (let i = 1; i < fakes.length; i++) expect(fakes[i]).not.toBe(fakes[i - 1]);
    expect(room.history).toHaveLength(5);
    expect(new Set(room.history.map((h) => h.word)).size).toBe(5);
    const w = toWire(room, kim.id, nowOf(room));
    // Nobody voted: every fake escaped with 2.
    const total = w.standings!.reduce((n, s) => n + s.score, 0);
    expect(total).toBe(5 * FAKE_POINTS);
    expect(w.standings![0].score).toBeGreaterThanOrEqual(w.standings![w.standings!.length - 1].score);
    expect(w.winnerIds.length).toBeGreaterThan(0);
    expect(w.standings!.reduce((n, s) => n + s.timesFake, 0)).toBe(5);

    again(room, john.id, nowOf(room));
    expect(room.phase).toBe('lobby');
    expect(room.players.every((p) => p.score === 0 && p.color === null)).toBe(true);
    expect(room.history).toEqual([]);
  });
});
