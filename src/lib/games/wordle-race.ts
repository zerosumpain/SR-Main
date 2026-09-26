// Family Wordle Race — the rules, as pure functions over a room.
//
// Same shape as Tap Duel (`tap-duel.ts`): every function takes `now` (epoch ms)
// and, where it deals, a `rng`, so a whole game plays in a test without a clock.
// The live registry owns timers and fan-out; nothing here knows about either.
//
// Everyone gets the same secret and six guesses, and guesses at the same time.
// The game ends when everyone has solved or run out, or at the time limit.
// Fewest guesses wins; a tie on guesses goes to the faster solve. While it runs,
// a phone sees its own rows in full and everyone else's as colours only — the
// point of racing a family is watching their greens arrive — and the secret is
// sent to nobody until the game is over.
//
// The lobby (join / decline / leave / start / again) behaves exactly as Tap
// Duel's does. It is re-stated rather than imported because those functions are
// typed to Tap Duel's room; generalising them is a later change to both.

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';
import { ALLOWED } from './words/allowed';
import { ANSWERS } from './words/answers';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, MAX_PLAYERS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';
export type Mark = 'correct' | 'present' | 'absent';

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
/** After the time limit, how long a guess already in flight may still land. */
export const GRACE_MS = 1_000;

interface Tuning {
  /** Secrets are drawn from the first `pool` words of ANSWERS (commonest first). */
  pool: number;
  timeLimitMs: number;
  /** Revealed hints must be used: greens stay put, found letters stay in. */
  hardMode: boolean;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { pool: 500, timeLimitMs: 5 * 60_000, hardMode: false },
  medium: { pool: 1_000, timeLimitMs: 4 * 60_000, hardMode: false },
  hard: { pool: ANSWERS.length, timeLimitMs: 3 * 60_000, hardMode: true },
};

const VALID = new Set(ALLOWED);

export interface Guess {
  word: string;
  marks: Mark[];
  at: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  guesses: Guess[];
  /** Milliseconds from the start of play to the solving guess; null until solved. */
  solveMs: number | null;
}

export interface Room {
  id: string;
  game: 'wordle-race';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** Dealt when play starts; never on the wire until the game is finished. */
  secret: string | null;
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, time limit, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, guesses: [], solveMs: null };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function solved(p: Player): boolean {
  return p.solveMs !== null;
}

/** Solved, or all six guesses spent: nothing left to play. */
export function isDone(p: Player): boolean {
  return solved(p) || p.guesses.length >= MAX_GUESSES;
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) {
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  }
  return {
    id: input.id,
    game: 'wordle-race',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    secret: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
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

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host role
 * to the next player, and the last one out closes the room. A player who walks
 * out of play may be the one everyone else was waiting on, so play can end here.
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
  if (room.phase === 'playing') finishIfDone(room, now);
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.guesses = [];
    p.solveMs = null;
  }
  room.phase = 'lobby';
  room.secret = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

export function dealSecret(difficulty: Difficulty, rng: Rng): string {
  const pool = Math.min(TUNING[difficulty].pool, ANSWERS.length);
  return ANSWERS[Math.min(pool - 1, Math.floor(rng() * pool))];
}

/**
 * Standard Wordle marking. Greens first; then each remaining letter is yellow
 * only while the secret still has an unmatched copy of it, left to right — so a
 * guess with three Bs against a secret with two lights at most two.
 */
export function mark(secret: string, guess: string): Mark[] {
  const marks: Mark[] = Array.from({ length: guess.length }, () => 'absent');
  const left = new Map<string, number>();
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) marks[i] = 'correct';
    else left.set(secret[i], (left.get(secret[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === 'correct') continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      marks[i] = 'present';
      left.set(guess[i], n - 1);
    }
  }
  return marks;
}

export function isWord(word: string): boolean {
  return VALID.has(word);
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];

/**
 * Hard mode: a green must stay where it was found, and a letter found (green or
 * yellow) must be in every later guess — as many copies as any one earlier row
 * proved the secret holds. Returns the first rule broken, as a sentence, or null.
 */
export function hardModeViolation(previous: Guess[], word: string): string | null {
  for (const g of previous) {
    for (let i = 0; i < g.word.length; i++) {
      if (g.marks[i] === 'correct' && word[i] !== g.word[i]) {
        return `${ORDINAL[i]} letter must be ${g.word[i].toUpperCase()}.`;
      }
    }
  }
  const need = new Map<string, number>();
  for (const g of previous) {
    const found = new Map<string, number>();
    g.marks.forEach((m, i) => {
      if (m !== 'absent') found.set(g.word[i], (found.get(g.word[i]) ?? 0) + 1);
    });
    for (const [ch, n] of found) need.set(ch, Math.max(need.get(ch) ?? 0, n));
  }
  for (const [ch, n] of need) {
    const have = [...word].filter((c) => c === ch).length;
    if (have < n) {
      return n === 1 ? `Guess must contain ${ch.toUpperCase()}.` : `Guess must contain ${n} ${ch.toUpperCase()}s.`;
    }
  }
  return null;
}

/**
 * One guess from one player. A word that isn't a word, or that breaks hard
 * mode, is refused (400) and costs nothing; a guess from someone who has already
 * solved or run out is refused (409).
 */
export function guess(room: Room, playerId: string, input: { word: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing' || room.secret === null || room.startedAt === null) {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  }
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS) throw new GameError(409, "Time's up.");
  if (solved(p)) throw new GameError(409, 'You have already solved it.');
  if (p.guesses.length >= MAX_GUESSES) throw new GameError(409, 'You are out of guesses.');

  const word = typeof input.word === 'string' ? input.word.trim().toLowerCase() : '';
  if (!/^[a-z]+$/.test(word) || word.length !== WORD_LENGTH) {
    throw new GameError(400, `Guesses are ${WORD_LENGTH} letters.`);
  }
  if (!isWord(word)) throw new GameError(400, 'Not in the word list.');
  if (TUNING[room.difficulty].hardMode) {
    const broken = hardModeViolation(p.guesses, word);
    if (broken) throw new GameError(400, broken);
  }

  p.guesses.push({ word, marks: mark(room.secret, word), at: now });
  if (word === room.secret) p.solveMs = Math.max(0, now - room.startedAt);
  room.updatedAt = now;
  finishIfDone(room, now);
}

function finishIfDone(room: Room, now: number): void {
  if (joined(room).every(isDone)) finish(room, now);
}

function finish(room: Room, now: number): void {
  room.phase = 'finished';
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it. Loops,
 * so a registry that slept through two deadlines lands where it should.
 * Returns whether anything changed.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 20; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        room.phase = 'playing';
        room.secret = dealSecret(room.difficulty, rng);
        room.startedAt = due;
        room.phaseEndsAt = due + TUNING[room.difficulty].timeLimitMs;
        room.updatedAt = due;
        break;
      case 'playing':
        finish(room, due);
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  // The phone shows the limit; a guess sent just before it still lands.
  if (room.phase === 'playing') return room.phaseEndsAt + GRACE_MS;
  return room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  solved: boolean;
  guesses: number;
  solveMs: number | null;
}

/** Solvers first, fewest guesses, then fastest. Those who didn't solve share last place. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.guesses.length > 0)
    .map((p) => ({ id: p.id, name: p.name, solved: solved(p), guesses: p.guesses.length, solveMs: p.solveMs }))
    .sort(
      (a, b) =>
        Number(b.solved) - Number(a.solved) ||
        (a.solved ? a.guesses - b.guesses || a.solveMs! - b.solveMs! : 0),
    );
}

/** Nobody wins alone, and nobody wins without solving. Exact ties share. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || !list[0].solved) return [];
  const top = list[0];
  return list.filter((s) => s.solved && s.guesses === top.guesses && s.solveMs === top.solveMs).map((s) => s.id);
}

const RANK: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };

/** The best mark each letter has earned across these rows — the on-screen keyboard's colours. */
export function keyboard(guesses: Guess[]): Record<string, Mark> {
  const keys: Record<string, Mark> = {};
  for (const g of guesses) {
    g.marks.forEach((m, i) => {
      const ch = g.word[i];
      if (!keys[ch] || RANK[m] > RANK[keys[ch]]) keys[ch] = m;
    });
  }
  return keys;
}

/**
 * The room as one player's phone sees it. Your own rows come with their
 * letters; everyone else's are colours only until the game is finished, and the
 * secret is null until then too.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  const tuning = TUNING[room.difficulty];
  const me = room.players.find((p) => p.id === meId);
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    wordLength: WORD_LENGTH,
    maxGuesses: MAX_GUESSES,
    timeLimitMs: tuning.timeLimitMs,
    hardMode: tuning.hardMode,
    startedAt: room.startedAt,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      guessCount: p.guesses.length,
      solved: solved(p),
      done: isDone(p),
      solveMs: p.solveMs,
      rows: p.guesses.map((g) => ({
        word: p.id === meId || finished ? g.word : null,
        marks: g.marks,
      })),
    })),
    keyboard: me ? keyboard(me.guesses) : {},
    phaseEndsAt: room.phaseEndsAt,
    secret: finished ? room.secret : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
