// Codenames rules: the deal, the teams, clues and their checks, guessing and
// the turn, the ends, co-op, the clock, leaving, and what the wire hides.

import { describe, expect, it } from 'vitest';
import {
  CARDS,
  CLUE_MS,
  COUNTDOWN_MS,
  FIRST_AGENTS,
  GRACE_MS,
  GUESS_MS,
  NEUTRALS,
  advance,
  agentsLeft,
  again,
  clueProblem,
  createRoom,
  giveClue,
  guess,
  join,
  leave,
  pass,
  pickTeam,
  resume,
  spymasterOf,
  standings,
  start,
  toScreen,
  toWire,
  waitingOn,
  winners,
  type Kind,
  type Room,
  type Team,
} from './codenames';
import { WORDS } from './words/codenames';

const T0 = 1_800_000_000_000;
const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };
const ali = { id: 'p_ali', name: 'Ali' };
const bo = { id: 'p_bo', name: 'Bo' };

function lobby(invite = [sam, kim, ali], seed = 7): Room {
  const room = createRoom({ id: 'g_cn', host: john, invite, difficulty: 'medium', options: { seed }, now: T0 });
  for (const p of invite) join(room, p.id, T0);
  return room;
}

function playing(invite = [sam, kim, ali], seed = 7, before?: (room: Room) => void): Room {
  const room = lobby(invite, seed);
  before?.(room);
  start(room, john.id, T0);
  advance(room, T0 + COUNTDOWN_MS);
  return room;
}

const at = T0 + COUNTDOWN_MS;
const spy = (room: Room, team: Team = room.turnTeam) => spymasterOf(room, team)!;
const operative = (room: Room, team: Team = room.turnTeam) => room.players.find((p) => p.status === 'joined' && p.team === team && !p.spymaster)!;
const cardOf = (room: Room, kind: Kind, skip = 0) => room.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === kind && c.by === null)[skip].i;
/** A clue word that is not on this board. */
const freeWord = (room: Room) => ['zephyr', 'quasar', 'mango', 'velvet'].find((w) => !room.cards.some((c) => c.word === w))!;

describe('the words', () => {
  it('are single lower-case words with no repeats, and plenty of them', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(300);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });
});

describe('the deal', () => {
  it('lays 25 cards: 9 for the starting team, 8 for the other, 7 bystanders and the assassin', () => {
    const room = playing();
    expect(room.phase).toBe('clue');
    expect(room.cards).toHaveLength(CARDS);
    const count = (k: Kind) => room.cards.filter((c) => c.kind === k).length;
    const second: Team = room.starting === 'red' ? 'blue' : 'red';
    expect(count(room.starting)).toBe(FIRST_AGENTS);
    expect(count(second)).toBe(FIRST_AGENTS - 1);
    expect(count('neutral')).toBe(NEUTRALS);
    expect(count('assassin')).toBe(1);
    expect(new Set(room.cards.map((c) => c.word)).size).toBe(CARDS);
    expect(room.turnTeam).toBe(room.starting);
  });

  it('deals the same board from the same seed', () => {
    expect(playing().cards).toEqual(playing().cards);
    expect(playing(undefined, 8).cards).not.toEqual(playing().cards);
  });
});

describe('the teams', () => {
  it('splits four into two and two, one spymaster each', () => {
    const room = playing();
    expect(room.mode).toBe('teams');
    for (const t of ['red', 'blue'] as Team[]) {
      const team = room.players.filter((p) => p.team === t);
      expect(team).toHaveLength(2);
      expect(team.filter((p) => p.spymaster)).toHaveLength(1);
    }
  });

  it('keeps the teams and spymasters people picked', () => {
    const room = playing(undefined, 7, (r) => {
      pickTeam(r, john.id, { team: 'blue', spymaster: true }, T0);
      pickTeam(r, sam.id, { team: 'blue', spymaster: false }, T0);
      pickTeam(r, kim.id, { team: 'red', spymaster: false }, T0);
    });
    expect(room.players.find((p) => p.id === john.id)).toMatchObject({ team: 'blue', spymaster: true });
    expect(room.players.find((p) => p.id === sam.id)).toMatchObject({ team: 'blue', spymaster: false });
    expect(room.players.find((p) => p.id === ali.id)?.team).toBe('red');
    expect(spy(room, 'red').id).toBe(room.players.find((p) => p.team === 'red' && p.spymaster)!.id);
  });

  it('moves people over when everybody picks the same side', () => {
    const room = playing(undefined, 7, (r) => {
      for (const p of r.players) pickTeam(r, p.id, { team: 'red', spymaster: false }, T0);
    });
    expect(room.players.filter((p) => p.team === 'red')).toHaveLength(2);
    expect(room.players.filter((p) => p.team === 'blue')).toHaveLength(2);
  });

  it('refuses a team change once the game is under way', () => {
    const room = playing();
    expect(() => pickTeam(room, john.id, { team: 'red', spymaster: false }, at)).toThrow(/fixed/);
    expect(() => pickTeam(lobby(), john.id, { team: 'green', spymaster: false }, T0)).toThrow(/Red or blue/);
  });

  it('hands the clue-giving on when the host plays again', () => {
    const room = playing();
    const first = room.players.filter((p) => p.spymaster).map((p) => p.id).sort();
    room.phase = 'finished';
    again(room, room.hostId, at + 1);
    start(room, room.hostId, at + 2);
    advance(room, at + 2 + COUNTDOWN_MS);
    const second = room.players.filter((p) => p.spymaster).map((p) => p.id).sort();
    expect(second.some((id) => first.includes(id))).toBe(false);
  });
});

describe('clues', () => {
  it('refuses a board word, its root, or one that holds or sits in it', () => {
    const board = ['bank', 'snowman', 'running'];
    expect(clueProblem('Bank', board)).toMatch(/on the board/);
    expect(clueProblem('banks', board)).toMatch(/on the board/);
    expect(clueProblem('snow', board)).toMatch(/Too close to SNOWMAN/);
    expect(clueProblem('bankrupt', board)).toMatch(/Too close to BANK/);
    expect(clueProblem('run', board)).toMatch(/on the board/);
    expect(clueProblem('two words', board)).toMatch(/One word/);
    expect(clueProblem('r2d2', board)).toMatch(/One word/);
    expect(clueProblem('', board)).toMatch(/Type a clue/);
    expect(clueProblem('ocean', board)).toBeNull();
    expect(clueProblem('planet', ['net'])).toBeNull();
    expect(clueProblem('education', ['cat'])).toBeNull();
    expect(clueProblem('catfish', ['cat'])).toMatch(/Too close to CAT/);
    expect(clueProblem('man', board)).toMatch(/Too close to SNOWMAN/);
    expect(clueProblem("o'clock", board)).toBeNull();
  });

  it('allows a word that was on the board once it is turned over', () => {
    expect(clueProblem('bank', ['snowman'])).toBeNull();
  });

  it('is given only by the spymaster whose turn it is, and opens the guessing', () => {
    const room = playing();
    const word = freeWord(room);
    expect(() => giveClue(room, operative(room).id, { word, count: 2 }, at)).toThrow(/Only the spymaster/);
    expect(() => giveClue(room, spy(room, room.turnTeam === 'red' ? 'blue' : 'red').id, { word, count: 2 }, at)).toThrow(/Only the spymaster/);
    expect(() => giveClue(room, spy(room).id, { word, count: 0 }, at)).toThrow(/number from 1/);
    giveClue(room, spy(room).id, { word, count: 2 }, at);
    expect(room.phase).toBe('guess');
    expect(room.clue).toMatchObject({ word: word.toUpperCase(), count: 2, cards: [] });
    expect(room.phaseEndsAt).toBe(at + GUESS_MS.medium);
  });
});

describe('guessing', () => {
  it('goes on after a right card, up to the number plus one', () => {
    const room = playing();
    const team = room.turnTeam;
    giveClue(room, spy(room).id, { word: freeWord(room), count: 1 }, at);
    guess(room, operative(room).id, { card: cardOf(room, team) }, at + 1);
    expect(room.phase).toBe('guess');
    expect(agentsLeft(room, team)).toBe(FIRST_AGENTS - 1);
    guess(room, operative(room).id, { card: cardOf(room, team) }, at + 2);
    expect(room.phase).toBe('clue');
    expect(room.turnTeam).not.toBe(team);
  });

  it('ends the turn on a bystander, and on the other team’s agent (which counts for them)', () => {
    const room = playing();
    const team = room.turnTeam;
    const them: Team = team === 'red' ? 'blue' : 'red';
    giveClue(room, spy(room).id, { word: freeWord(room), count: 3 }, at);
    guess(room, operative(room).id, { card: cardOf(room, 'neutral') }, at + 1);
    expect(room.turnTeam).toBe(them);
    giveClue(room, spy(room).id, { word: freeWord(room), count: 3 }, at + 2);
    guess(room, operative(room).id, { card: cardOf(room, team) }, at + 3);
    expect(room.turnTeam).toBe(team);
    expect(agentsLeft(room, team)).toBe(FIRST_AGENTS - 1);
  });

  it('refuses the spymaster, the other team, a second touch of a card is nothing', () => {
    const room = playing();
    giveClue(room, spy(room).id, { word: freeWord(room), count: 2 }, at);
    const card = cardOf(room, room.turnTeam);
    expect(() => guess(room, spy(room).id, { card }, at)).toThrow(/spymaster cannot guess/);
    expect(() => guess(room, operative(room, room.turnTeam === 'red' ? 'blue' : 'red').id, { card }, at)).toThrow(/other team/);
    expect(() => guess(room, operative(room).id, { card: 25 }, at)).toThrow(/card on the board/);
    guess(room, operative(room).id, { card }, at);
    const before = structuredClone(room);
    guess(room, operative(room).id, { card }, at + 1);
    expect(room).toEqual(before);
  });

  it('lets them stop after one guess, not before', () => {
    const room = playing();
    const team = room.turnTeam;
    giveClue(room, spy(room).id, { word: freeWord(room), count: 3 }, at);
    expect(() => pass(room, operative(room).id, at)).toThrow(/at least one/);
    guess(room, operative(room).id, { card: cardOf(room, team) }, at + 1);
    pass(room, operative(room).id, at + 2);
    expect(room.phase).toBe('clue');
    expect(room.turnTeam).not.toBe(team);
  });
});

describe('the end', () => {
  it('loses on the assassin', () => {
    const room = playing();
    const team = room.turnTeam;
    giveClue(room, spy(room).id, { word: freeWord(room), count: 2 }, at);
    guess(room, operative(room).id, { card: cardOf(room, 'assassin') }, at + 1);
    expect(room.phase).toBe('finished');
    expect(room.result).toEqual({ winner: team === 'red' ? 'blue' : 'red', reason: 'assassin' });
    expect(winners(room).every((id) => room.players.find((p) => p.id === id)!.team !== team)).toBe(true);
    const table = standings(room);
    expect(table[0]).toMatchObject({ place: 1, result: 'won' });
    expect(table.at(-1)).toMatchObject({ place: 2, result: 'lost' });
  });

  it('wins when the last agent is found — even by the other team', () => {
    const room = playing();
    const team = room.turnTeam;
    const them: Team = team === 'red' ? 'blue' : 'red';
    for (const c of room.cards) if (c.kind === them) c.by = 'x';
    room.cards[cardOf(room, team)].by = null;
    room.cards.find((c) => c.kind === them)!.by = null;
    giveClue(room, spy(room).id, { word: freeWord(room), count: 1 }, at);
    guess(room, operative(room).id, { card: cardOf(room, them) }, at + 1);
    expect(room.result).toEqual({ winner: them, reason: 'agents' });
  });
});

describe('co-op', () => {
  it('seats two or three on red with one spymaster, and turns a blue over after each turn', () => {
    const room = playing([sam, kim]);
    expect(room.mode).toBe('coop');
    expect(room.players.every((p) => p.team === 'red')).toBe(true);
    expect(room.players.filter((p) => p.spymaster)).toHaveLength(1);
    expect(room.starting).toBe('red');
    giveClue(room, spy(room).id, { word: freeWord(room), count: 1 }, at);
    guess(room, operative(room).id, { card: cardOf(room, 'neutral') }, at + 1);
    expect(room.phase).toBe('clue');
    expect(room.turnTeam).toBe('red');
    expect(agentsLeft(room, 'blue')).toBe(FIRST_AGENTS - 2);
    expect(room.last).toMatchObject({ kind: 'blue', by: 'auto' });
  });

  it('loses when the blue agents run out, wins when red’s do', () => {
    const lost = playing([sam]);
    for (const c of lost.cards) if (c.kind === 'blue') c.by = 'auto';
    lost.cards.find((c) => c.kind === 'blue')!.by = null;
    giveClue(lost, spy(lost).id, { word: freeWord(lost), count: 1 }, at);
    guess(lost, operative(lost).id, { card: cardOf(lost, 'neutral') }, at + 1);
    expect(lost.result).toEqual({ winner: null, reason: 'agents' });
    expect(winners(lost)).toEqual([]);

    const won = playing([sam]);
    for (const c of won.cards) if (c.kind === 'red') c.by = 'x';
    won.cards.find((c) => c.kind === 'red')!.by = null;
    giveClue(won, spy(won).id, { word: freeWord(won), count: 1 }, at);
    guess(won, operative(won).id, { card: cardOf(won, 'red') }, at + 1);
    expect(won.result).toEqual({ winner: 'red', reason: 'agents' });
    expect(winners(won).sort()).toEqual([john.id, sam.id].sort());
  });
});

describe('the clock', () => {
  it('passes the turn when no clue comes, and ends guessing after its grace', () => {
    const room = playing();
    const team = room.turnTeam;
    advance(room, at + CLUE_MS.medium);
    expect(room.phase).toBe('clue');
    expect(room.turnTeam).not.toBe(team);
    const t1 = at + CLUE_MS.medium;
    giveClue(room, spy(room).id, { word: freeWord(room), count: 1 }, t1);
    expect(advance(room, t1 + GUESS_MS.medium)).toBe(false);
    advance(room, t1 + GUESS_MS.medium + GRACE_MS);
    expect(room.turnTeam).toBe(team);
  });

  it('gives a resumed room its full time again', () => {
    const room = playing();
    resume(room, at + 999, 5_000);
    expect(room.phaseEndsAt).toBe(at + 999 + CLUE_MS.medium);
  });
});

describe('leaving', () => {
  it('hands the spymaster role to a team-mate', () => {
    const room = playing();
    const s = spy(room);
    leave(room, s.id, at);
    expect(spy(room, s.team!)).toBeTruthy();
    expect(spy(room, s.team!).id).not.toBe(s.id);
  });

  it('loses the game for a team with nobody left', () => {
    const room = playing();
    const team: Team = 'red';
    for (const p of room.players.filter((x) => x.team === team)) leave(room, p.id, at);
    expect(room.result).toEqual({ winner: 'blue', reason: 'left' });
  });

  it('lets a lone spymaster guess for their team', () => {
    const room = playing([sam, kim, ali, bo]);
    const team = room.turnTeam;
    const ops = room.players.filter((p) => p.team === team && !p.spymaster);
    for (const p of ops) leave(room, p.id, at);
    giveClue(room, spy(room).id, { word: freeWord(room), count: 1 }, at);
    guess(room, spy(room).id, { card: cardOf(room, team) }, at + 1);
    expect(agentsLeft(room, team)).toBe(FIRST_AGENTS - 1);
  });
});

describe('the wire', () => {
  it('sends the key to the spymasters only, and to everyone at the end', () => {
    const room = playing();
    const s = spy(room);
    const o = operative(room);
    expect(toWire(room, s.id, at).key).toHaveLength(CARDS);
    expect(toWire(room, o.id, at).key).toBeNull();
    expect(toScreen(room, at).key).toBeNull();
    expect(toScreen(room, at).cards.every((c) => c.kind === null)).toBe(true);
    expect(JSON.stringify(toScreen(room, at))).not.toContain('assassin');
    giveClue(room, s.id, { word: freeWord(room), count: 2 }, at);
    const card = cardOf(room, room.turnTeam);
    guess(room, o.id, { card }, at + 1);
    expect(toScreen(room, at + 1).cards[card].kind).toBe(room.cards[card].kind);
    expect(toScreen(room, at + 1).clue?.guessesLeft).toBe(2);
    guess(room, o.id, { card: cardOf(room, 'assassin') }, at + 2);
    expect(toScreen(room, at + 2).key).toHaveLength(CARDS);
  });

  it('says who may act', () => {
    const room = playing();
    expect(toWire(room, spy(room).id, at).canClue).toBe(true);
    expect(toWire(room, operative(room).id, at).canClue).toBe(false);
    expect(waitingOn(room)).toMatchObject({ ids: [spy(room).id] });
    giveClue(room, spy(room).id, { word: freeWord(room), count: 2 }, at);
    expect(toWire(room, operative(room).id, at).canGuess).toBe(true);
    expect(toWire(room, spy(room).id, at).canGuess).toBe(false);
    expect(waitingOn(room)?.ids).toEqual([operative(room).id]);
  });

  it('previews the mode in the lobby', () => {
    expect(toWire(lobby(), john.id, T0).mode).toBe('teams');
    expect(toWire(lobby([sam]), john.id, T0).mode).toBe('coop');
  });
});
