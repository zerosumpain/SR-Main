// Fake Artist — the rules, as pure functions over a room.
//
// Same shape as Draw & Guess (`draw-guess.ts`): every function takes `now`
// (epoch ms) and, where it deals, a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out.
//
// A round: the server picks a category and a secret word. Everyone sees the
// category; every ARTIST sees the word; one player, the FAKE, does not — and
// nobody but the fake knows who that is. Twice round the table, each player
// adds ONE continuous line (finger down to finger up) to a shared picture in
// their own colour, trying to show they know the word without giving it away.
// Then everyone votes for who they think the fake is. Unless the fake gets
// more votes than anyone else on their own, the fake wins the round; if they
// are caught they get one guess at the word, and a right guess still wins.
// The fake winning scores them 2; the artists winning scores each artist 1.
// Several rounds; the fake is dealt at random but never twice in a row.
//
// The picture streams as changes, exactly as Draw & Guess's does: a phone that
// says what it holds (`since`, a drawing revision) is sent only the line
// segments after it. Stroke ops have the same shape as Draw & Guess's, so the
// app reuses its canvas.
//
// Hidden information is the whole game: `toWire` is per viewer, and the word,
// the fake's identity and the votes are only ever in the wire of somebody
// allowed to know them (see the spec's "What each phone is told").

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';
import { CATEGORIES } from './words/fake-artist';
import { normalise, withinOne } from './draw-guess';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase =
  | 'lobby'
  | 'countdown'
  | 'reading'
  | 'drawing'
  | 'voting'
  | 'guessing'
  | 'reveal'
  | 'finished'
  | 'closed';

/** Four to start (three artists and the fake); the game carries on with three. */
export const MIN_PLAYERS = 4;
export const MIN_TO_CONTINUE = 3;
/** This game's own cap, above the registry's default of five (`GameRules.maxPlayers`). */
export const MAX_PLAYERS = 10;

export const ROUNDS = [3, 5] as const;
export type Rounds = (typeof ROUNDS)[number];
export const DEFAULT_ROUNDS: Rounds = 3;
/** Times round the table each round. */
export const LAPS = 2;

/** The card is up before the first line: time to read the word (or the bad news). */
export const READ_MS = 8_000;
/** One line's turn, by difficulty. A turn not drawn in time is skipped. */
export const TURN_MS: Record<Difficulty, number> = { easy: 30_000, medium: 20_000, hard: 15_000 };
export const VOTE_MS = 60_000;
export const GUESS_MS = 30_000;
export const REVEAL_MS = 10_000;

/** Points: the fake winning a round, and each artist when the artists win it. */
export const FAKE_POINTS = 2;
export const ARTIST_POINTS = 1;

/** The canvas is a square 0…CANVAS on both axes, as Draw & Guess's. */
export const CANVAS = 1000;
/** Every line is the same pen; only the colour says whose it is. */
export const WIDTH = 14;
/** Points one line may hold. */
export const MAX_LINE_POINTS = 1500;
/** Points one `stroke` post may carry. */
export const MAX_POST_POINTS = 300;
/** Drawing changes kept for phones asking `since`; an older cursor gets the whole picture. */
export const MAX_LOG = 400;
export const MAX_GUESS_LENGTH = 40;

/** Each seat's ink, in seat order. Ten players, ten colours that read on paper. */
export const COLORS = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'brown',
  'pink',
  'teal',
  'black',
  'gold',
] as const;
export type Color = (typeof COLORS)[number];

// ---- Words ---------------------------------------------------------------

/** The words a difficulty draws from: the common ones, then less common. */
export function wordsFor(difficulty: Difficulty, category: (typeof CATEGORIES)[number]): readonly string[] {
  if (difficulty === 'easy') return category.easy;
  if (difficulty === 'medium') return [...category.easy, ...category.medium];
  return [...category.medium, ...category.hard];
}

/** A category and word nobody has had this game (any, once those run dry). */
export function dealWord(
  difficulty: Difficulty,
  used: ReadonlySet<string>,
  rng: Rng,
): { category: string; word: string } {
  const pairs = CATEGORIES.flatMap((c) => wordsFor(difficulty, c).map((word) => ({ category: c.name, word })));
  let fresh = pairs.filter((p) => !used.has(p.word));
  if (!fresh.length) fresh = pairs;
  return fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
}

/**
 * Whether the fake's guess names the word: the same once case, accents,
 * punctuation, a leading article and a plural `s` are off (Draw & Guess's
 * `normalise`), spaces ignored, or one letter off for a word of five letters
 * or more — a typo is not a wrong answer, but "bat" is not "cat".
 */
export function guessMatches(guess: string, word: string): boolean {
  const said = normalise(guess).replace(/ /g, '');
  const target = normalise(word).replace(/ /g, '');
  if (!said) return false;
  if (said === target) return true;
  return target.length >= 5 && withinOne(said, target);
}

// ---- The drawing ---------------------------------------------------------

export interface Line {
  /** The turn's number in the round, from 1 — unique within a round's picture. */
  id: number;
  playerId: string;
  color: Color;
  width: number;
  points: [number, number][];
}

/** One change to the picture: points added to a line (Draw & Guess's stroke op). */
export interface DrawOp {
  seq: number;
  op: 'stroke';
  id: number;
  color: Color;
  width: number;
  points: [number, number][];
}

export interface Drawing {
  lines: Line[];
  /** Changes since `from`, oldest first, at most MAX_LOG. */
  log: DrawOp[];
  /** A cursor below this cannot be answered with changes. */
  from: number;
}

function emptyDrawing(from: number): Drawing {
  return { lines: [], log: [], from };
}

// ---- The room ------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  /** Seat colour, set at the start. */
  color: Color | null;
  /** Rounds dealt the fake, and rounds won as the fake. */
  timesFake: number;
  winsAsFake: number;
}

export type Outcome =
  /** Nobody had more votes than everyone else alone: the fake slipped by. */
  | 'escaped'
  /** Caught, and named the word. */
  | 'guessed'
  /** Caught, and missed the word (or ran out of time). */
  | 'caught'
  /** The fake left during the round. */
  | 'fake-left';

export interface Round {
  /** From 1. */
  number: number;
  category: string;
  word: string;
  fakeId: string;
  /** Everyone dealt into this round, seat order: artists and the fake. */
  seats: string[];
  /** Who draws when: `seats` from this round's first player, LAPS times round. */
  turns: string[];
  /** Position in `turns`. */
  turn: number;
  turnStartedAt: number | null;
  /** The current turn's line has been lifted (it is over). */
  lifted: boolean;
  /** Turns that ran out with no line at all. */
  skipped: number[];
  /** Voter → who they voted for. */
  votes: Record<string, string>;
  /** Who got the most votes on their own, if anyone did. */
  accusedId: string | null;
  guess: string | null;
  outcome: Outcome | null;
  /** Points handed out at the end of the round, by player. */
  awarded: Record<string, number>;
}

export interface Room {
  id: string;
  game: 'fake-artist';
  difficulty: Difficulty;
  rounds: Rounds;
  hostId: string;
  phase: Phase;
  players: Player[];
  round: Round | null;
  /** Rounds already played this game, for the history the phones show. */
  history: { number: number; category: string; word: string; fakeId: string; outcome: Outcome }[];
  /** Words dealt this game, never dealt again. */
  used: string[];
  drawing: Drawing;
  /** Bumped on every change to the picture, and when a new one starts; never reset. */
  revision: number;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0, color: null, timesFake: 0, winsAsFake: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function isJoined(room: Room, id: string): boolean {
  return room.players.some((p) => p.id === id && p.status === 'joined');
}

export function isRounds(v: unknown): v is Rounds {
  return typeof v === 'number' && (ROUNDS as readonly number[]).includes(v);
}

/** The game's choices from a create request; anything missing or unknown is the default. */
export function roundOptions(options: Record<string, unknown> | undefined): { rounds: Rounds } {
  const o = options ?? {};
  return { rounds: isRounds(o.rounds) ? o.rounds : DEFAULT_ROUNDS };
}

export function turnMs(room: Room): number {
  return TURN_MS[room.difficulty];
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter(
    (p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  return {
    id: input.id,
    game: 'fake-artist',
    difficulty: input.difficulty,
    ...roundOptions(input.options),
    hostId: input.host.id,
    phase: 'lobby',
    players: [
      player(input.host.id, input.host.name, 'joined'),
      ...invited.map((p) => player(p.id, p.name, 'invited')),
    ],
    round: null,
    history: [],
    used: [],
    drawing: emptyDrawing(0),
    revision: 0,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line: "3 rounds · 20 s a line". */
export function about(room: Room): string {
  return `${room.rounds} rounds · ${turnMs(room) / 1000} s a line`;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  p.status = 'joined';
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'invited') return;
  p.status = 'declined';
  room.updatedAt = now;
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

function finish(room: Room, now: number): void {
  room.phase = 'finished';
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * Leaving the lobby as host cancels the game; the last one out closes the room.
 * In play: the fake leaving ends the round for the artists (they score it);
 * an artist leaving loses their turns (the one in hand passes on) and their
 * vote; fewer than three left ends the game. The host role passes on.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  room.updatedAt = now;
  if (room.phase === 'lobby' && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = rest[0].id;
  if (room.phase === 'lobby' || room.phase === 'finished' || room.phase === 'countdown') {
    if (room.phase === 'countdown' && rest.length < MIN_TO_CONTINUE) finish(room, now);
    return;
  }
  const round = room.round;
  if (!round || room.phase === 'reveal') {
    if (rest.length < MIN_TO_CONTINUE) finish(room, now);
    return;
  }
  if (round.fakeId === playerId) {
    endRound(room, now, 'fake-left');
    return;
  }
  if (rest.length < MIN_TO_CONTINUE) {
    finish(room, now);
    return;
  }
  // Their vote, and any votes for them, no longer count.
  delete round.votes[playerId];
  for (const [voter, target] of Object.entries(round.votes)) if (target === playerId) delete round.votes[voter];
  if (room.phase === 'drawing' && round.turns[round.turn] === playerId) nextTurn(room, now);
  else if (room.phase === 'voting' && everyoneVoted(room)) tally(room, now);
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < MIN_PLAYERS) throw new GameError(409, 'Fake Artist needs at least four players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  joined(room).forEach((p, i) => {
    p.color = COLORS[i % COLORS.length];
  });
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same settings, fresh words — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.score = 0;
    p.color = null;
    p.timesFake = 0;
    p.winsAsFake = 0;
  }
  room.phase = 'lobby';
  room.round = null;
  room.history = [];
  room.used = [];
  room.revision += 1;
  room.drawing = emptyDrawing(room.revision);
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/**
 * Deal round `number`: a word, a fake (at random among those here, never the
 * last round's fake while anyone else could be), the order (seat order, from
 * a first player that moves on one seat each round), and a fresh picture.
 */
function beginRound(room: Room, number: number, now: number, rng: Rng): void {
  const here = joined(room);
  if (here.length < MIN_TO_CONTINUE || number > room.rounds) {
    finish(room, now);
    return;
  }
  const seats = here.map((p) => p.id);
  const lastFake = room.history.length ? room.history[room.history.length - 1].fakeId : null;
  const candidates = seats.length > 1 ? seats.filter((id) => id !== lastFake) : seats;
  const fakeId = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  const { category, word } = dealWord(room.difficulty, new Set(room.used), rng);
  room.used.push(word);
  const first = (number - 1) % seats.length;
  const lap = [...seats.slice(first), ...seats.slice(0, first)];
  const fake = room.players.find((p) => p.id === fakeId);
  if (fake) fake.timesFake += 1;
  room.round = {
    number,
    category,
    word,
    fakeId,
    seats,
    turns: Array.from({ length: LAPS }, () => lap).flat(),
    turn: 0,
    turnStartedAt: null,
    lifted: false,
    skipped: [],
    votes: {},
    accusedId: null,
    guess: null,
    outcome: null,
    awarded: {},
  };
  room.revision += 1;
  room.drawing = emptyDrawing(room.revision);
  room.phase = 'reading';
  room.phaseEndsAt = now + READ_MS;
  room.updatedAt = now;
}

/** Start turn `index`, skipping anybody no longer here — or, past the last, the vote. */
function beginTurn(room: Room, index: number, now: number): void {
  const round = room.round!;
  let k = index;
  while (k < round.turns.length && !isJoined(room, round.turns[k])) k++;
  if (k >= round.turns.length) {
    beginVote(room, now);
    return;
  }
  round.turn = k;
  round.turnStartedAt = now;
  round.lifted = false;
  room.phase = 'drawing';
  room.phaseEndsAt = now + turnMs(room);
  room.updatedAt = now;
}

function lineOf(room: Room, round: Round, k: number): Line | undefined {
  return room.drawing.lines.find((l) => l.id === k + 1);
}

/** The turn in hand is over (lifted, out of time, or its artist left): the next one. */
function nextTurn(room: Room, now: number): void {
  const round = room.round!;
  if (!lineOf(room, round, round.turn)) round.skipped.push(round.turn);
  beginTurn(room, round.turn + 1, now);
}

function beginVote(room: Room, now: number): void {
  room.phase = 'voting';
  room.phaseEndsAt = now + VOTE_MS;
  room.updatedAt = now;
}

function everyoneVoted(room: Room): boolean {
  const round = room.round;
  if (!round) return false;
  return joined(room)
    .filter((p) => round.seats.includes(p.id))
    .every((p) => round.votes[p.id] !== undefined);
}

/** Votes each player holds, counting only voters and targets still here. */
export function voteCounts(room: Room): Record<string, number> {
  const round = room.round;
  const out: Record<string, number> = {};
  if (!round) return out;
  for (const [voter, target] of Object.entries(round.votes)) {
    if (!isJoined(room, voter) || !isJoined(room, target)) continue;
    out[target] = (out[target] ?? 0) + 1;
  }
  return out;
}

/** The player with more votes than every other player, or null on a tie or no votes. */
export function accused(counts: Record<string, number>): string | null {
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] <= 0) return null;
  if (ranked.length > 1 && ranked[1][1] === ranked[0][1]) return null;
  return ranked[0][0];
}

/** The vote is in (everyone, or the clock): caught means a guess; otherwise the fake escaped. */
function tally(room: Room, now: number): void {
  const round = room.round!;
  round.accusedId = accused(voteCounts(room));
  if (round.accusedId === round.fakeId) {
    room.phase = 'guessing';
    room.phaseEndsAt = now + GUESS_MS;
    room.updatedAt = now;
    return;
  }
  endRound(room, now, 'escaped');
}

/** Settle the round's points and show everything. */
function endRound(room: Room, now: number, outcome: Outcome): void {
  const round = room.round!;
  round.outcome = outcome;
  const fakeWins = outcome === 'escaped' || outcome === 'guessed';
  round.awarded = {};
  for (const p of room.players) {
    if (p.status !== 'joined' || !round.seats.includes(p.id)) continue;
    const isFake = p.id === round.fakeId;
    const points = fakeWins ? (isFake ? FAKE_POINTS : 0) : isFake ? 0 : ARTIST_POINTS;
    if (points) {
      p.score += points;
      round.awarded[p.id] = points;
    }
    if (isFake && fakeWins) p.winsAsFake += 1;
  }
  room.history.push({
    number: round.number,
    category: round.category,
    word: round.word,
    fakeId: round.fakeId,
    outcome,
  });
  if (joined(room).length < MIN_TO_CONTINUE) {
    // Nobody left to play the next round: the reveal is the finish.
    finish(room, now);
    return;
  }
  room.phase = 'reveal';
  room.phaseEndsAt = now + REVEAL_MS;
  room.updatedAt = now;
}

// ---- Moves ---------------------------------------------------------------

function inRound(room: Room, playerId: string): { p: Player; round: Round } {
  const p = find(room, playerId);
  const round = room.round;
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  if (!round || !round.seats.includes(playerId)) throw new GameError(403, 'You are not in this round.');
  return { p, round };
}

/** Quantise a posted point onto the canvas, or null if it is not a pair of numbers. */
function toPoint(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, y] = v;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const q = (n: number) => Math.min(CANVAS, Math.max(0, Math.round(n)));
  return [q(x), q(y)];
}

function record(room: Room, op: DrawOp): void {
  const d = room.drawing;
  d.log.push(op);
  if (d.log.length > MAX_LOG) {
    const dropped = d.log.splice(0, d.log.length - MAX_LOG);
    d.from = Math.max(d.from, dropped[dropped.length - 1].seq);
  }
}

/**
 * Part of the artist-in-turn's one line. The posts of a turn all extend the
 * same line (the server numbers it; any `id` posted is ignored), so a line
 * streams in as it is drawn; `end: true` is the finger lifting, which ends
 * the turn. A post may be `end` alone, with no points, if there is a line.
 */
export function stroke(
  room: Room,
  playerId: string,
  input: { points?: unknown; end?: unknown },
  now: number,
): void {
  const { p, round } = inRound(room, playerId);
  if (room.phase !== 'drawing') throw new GameError(409, 'Nobody is drawing right now.');
  if (round.turns[round.turn] !== playerId) throw new GameError(409, "It's not your turn to draw.");
  if (round.lifted) throw new GameError(409, 'You have drawn your line.');
  const end = input.end === true;
  const raw = input.points;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new GameError(400, 'Points are [x, y] pairs.');
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_POST_POINTS) throw new GameError(400, `Up to ${MAX_POST_POINTS} points at a time.`);
  const pts: [number, number][] = [];
  for (const v of list) {
    const pt = toPoint(v);
    if (!pt) throw new GameError(400, 'Points are [x, y] pairs.');
    pts.push(pt);
  }
  let line = lineOf(room, round, round.turn);
  if (!pts.length && !(end && line)) throw new GameError(400, 'A line needs points.');
  if (pts.length) {
    if ((line?.points.length ?? 0) + pts.length > MAX_LINE_POINTS)
      throw new GameError(409, 'That line is long enough — lift your finger.');
    if (!line) {
      line = { id: round.turn + 1, playerId, color: p.color ?? 'black', width: WIDTH, points: [] };
      room.drawing.lines.push(line);
    }
    line.points.push(...pts);
    room.revision += 1;
    record(room, { seq: room.revision, op: 'stroke', id: line.id, color: line.color, width: line.width, points: pts });
  }
  room.updatedAt = now;
  if (end) {
    round.lifted = true;
    nextTurn(room, now);
  }
}

/** A vote for who the fake is: anybody else still in the round. May be changed until everyone has voted. */
export function vote(room: Room, playerId: string, input: { playerId: unknown }, now: number): void {
  const { round } = inRound(room, playerId);
  if (room.phase !== 'voting') throw new GameError(409, 'It is not time to vote.');
  const target = input.playerId;
  if (typeof target !== 'string' || !round.seats.includes(target) || !isJoined(room, target))
    throw new GameError(400, 'Vote for somebody still playing.');
  if (target === playerId) throw new GameError(400, "You can't vote for yourself.");
  round.votes[playerId] = target;
  room.updatedAt = now;
  if (everyoneVoted(room)) tally(room, now);
}

/** The caught fake's one guess at the word. */
export function guess(room: Room, playerId: string, input: { text: unknown }, now: number): void {
  const { round } = inRound(room, playerId);
  if (room.phase !== 'guessing') throw new GameError(409, 'It is not time to guess.');
  if (round.fakeId !== playerId) throw new GameError(403, 'Only the fake guesses the word.');
  const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
  if (!text || text.length > MAX_GUESS_LENGTH) throw new GameError(400, 'Type a guess.');
  round.guess = text;
  endRound(room, now, guessMatches(text, round.word) ? 'guessed' : 'caught');
}

// ---- The clock -----------------------------------------------------------

/**
 * Move a room along the clock by ONE step: whatever is due, act on it, and time
 * the next phase from `now`. A registry that slept through several deadlines is
 * caught up one step per call. Returns whether anything changed.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case 'lobby':
    case 'finished':
      close(room, now);
      break;
    case 'countdown':
      beginRound(room, 1, now, rng);
      break;
    case 'reading':
      beginTurn(room, 0, now);
      break;
    case 'drawing':
      // Out of time: a line begun stays as far as it got; none at all is a skip.
      nextTurn(room, now);
      break;
    case 'voting':
      // Whoever has not voted abstains.
      tally(room, now);
      break;
    case 'guessing':
      endRound(room, now, 'caught');
      break;
    case 'reveal':
      beginRound(room, (room.round?.number ?? 0) + 1, now, rng);
      break;
    default:
      return false;
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Scoring -------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  score: number;
  timesFake: number;
  winsAsFake: number;
}

/** Everyone still in, and anyone who left having scored; highest first, ties in seat order. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.score > 0)
    .map((p) => ({ id: p.id, name: p.name, score: p.score, timesFake: p.timesFake, winsAsFake: p.winsAsFake }))
    .sort((a, b) => b.score - a.score);
}

/** Top score wins; ties share; nobody wins alone or on nothing. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score <= 0) return [];
  const top = list[0].score;
  return list.filter((s) => s.score === top).map((s) => s.id);
}

// ---- The wire ------------------------------------------------------------

/** The drawing revision a phone holds after this room's wire — what it sends back as `since`. */
export function revision(room: Room): number {
  return room.revision;
}

/** The picture for a phone that holds it up to `since`: the changes after it, or the whole. */
function drawingWire(room: Room, since: number | null | undefined) {
  const d = room.drawing;
  const delta =
    typeof since === 'number' && Number.isInteger(since) && since >= d.from && since <= room.revision;
  const strokes = () => d.lines.map((l) => ({ id: l.id, color: l.color, width: l.width, points: l.points }));
  return delta
    ? { revision: room.revision, since, strokes: null, ops: d.log.filter((op) => op.seq > since) }
    : { revision: room.revision, since: null, strokes: strokes(), ops: null };
}

/**
 * The room as one player's phone sees it.
 *
 * - The WORD goes to the round's artists (never the fake, never anybody not
 *   dealt in) until the reveal, then to everyone.
 * - WHO IS THE FAKE goes only to the fake (`role: 'fake'`) until the vote
 *   catches them (`accusedId` in the guess) or the reveal.
 * - VOTES: while voting, everyone sees who has voted, and only their own
 *   choice; the tally comes with the reveal.
 */
export function toWire(room: Room, meId: string, now: number, since?: number | null) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  const round = room.round;
  const live = round && room.phase !== 'lobby' && room.phase !== 'countdown';
  const open = room.phase === 'reveal' || finished;
  const dealt = !!round && round.seats.includes(meId);
  const amFake = dealt && round!.fakeId === meId;
  const role: 'artist' | 'fake' | 'watching' = !live || !dealt ? 'watching' : amFake ? 'fake' : 'artist';
  const counts = open && round ? voteCounts(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rounds: room.rounds,
    laps: LAPS,
    turnMs: turnMs(room),
    readMs: READ_MS,
    voteMs: VOTE_MS,
    guessMs: GUESS_MS,
    revealMs: REVEAL_MS,
    phaseEndsAt: room.phaseEndsAt,
    current: live
      ? {
          number: round.number,
          category: round.category,
          role,
          word: open || role === 'artist' ? round.word : null,
          fakeId: open || amFake || room.phase === 'guessing' ? round.fakeId : null,
          turns: round.turns,
          turn: room.phase === 'drawing' ? round.turn : null,
          artistId: room.phase === 'drawing' ? round.turns[round.turn] : null,
          turnStartedAt: room.phase === 'drawing' ? round.turnStartedAt : null,
          skipped: round.skipped,
          voted: round.seats.filter((id) => round.votes[id] !== undefined),
          myVote: round.votes[meId] ?? null,
          votes: open ? { ...round.votes } : null,
          counts,
          accusedId: room.phase === 'guessing' || open ? round.accusedId : null,
          guess: open ? round.guess : null,
          outcome: open ? round.outcome : null,
          awarded: open ? round.awarded : null,
        }
      : null,
    history: room.history.map((h) => ({ ...h })),
    drawing: live ? drawingWire(room, since) : null,
    palette: COLORS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      score: p.score,
      color: p.color,
      isDrawing: room.phase === 'drawing' && round ? round.turns[round.turn] === p.id : false,
    })),
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
