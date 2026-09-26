// Quick Maths Sprint — the rules, as pure functions over a room.
//
// Same shape as Tap Duel (`tap-duel.ts`) and Wordle Race: every function takes
// `now` (epoch ms) and, where it deals, a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out.
//
// Sixty seconds of mental arithmetic. When the countdown ends the server deals
// ONE sequence of problems that everyone works through at their own pace — same
// problems, same order — so it is a fair race. A right answer scores a point and
// moves you on; a wrong one scores nothing and leaves the same problem in front
// of you, so guessing costs time. Every fifth right answer in a row is a bonus.
//
// Answers never travel while the game runs: a phone gets the text of its own
// current problem and nothing else. At the finish each player's last few
// problems come back with their answers.
//
// The lobby (join / decline / leave / start / again) behaves exactly as Tap
// Duel's and Wordle Race's do.

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

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, MAX_PLAYERS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';

export const TIME_LIMIT_MS = 60_000;
/** After the time limit, how long an answer already in flight may still land. */
export const GRACE_MS = 750;
/** More than anyone gets through in a minute; running out ends your game. */
export const PROBLEM_COUNT = 200;
/** Problems harden over the first RAMP of the sequence, then hold at the band's top. */
export const RAMP = 80;
/** Every STREAK_BONUS right answers in a row scores one extra point. */
export const STREAK_BONUS = 5;
/** How many of each player's last problems the finish reveals. */
export const RECENT = 5;

export type Kind = 'add' | 'sub' | 'mul' | 'div' | 'two-step';

export interface Problem {
  text: string;
  answer: number;
  kind: Kind;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** The problem in front of them — also how many they have answered right. */
  index: number;
  score: number;
  misses: number;
  streak: number;
  bestStreak: number;
  /** Wrong tries per problem index, for the finish's recap. */
  wrong: Record<number, number>;
}

export interface Room {
  id: string;
  game: 'maths-sprint';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** Dealt when play starts; answers never on the wire while it runs. */
  problems: Problem[] | null;
  startedAt: number | null;
  /** Lobby expiry, countdown end, time limit, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, index: 0, score: 0, misses: 0, streak: 0, bestStreak: 0, wrong: {} };
}

function reset(p: Player): void {
  p.index = 0;
  p.score = 0;
  p.misses = 0;
  p.streak = 0;
  p.bestStreak = 0;
  p.wrong = {};
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

/** Worked through the whole sequence: nothing left to play. */
export function isDone(room: Room, p: Player): boolean {
  return room.problems !== null && p.index >= room.problems.length;
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) {
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  }
  return {
    id: input.id,
    game: 'maths-sprint',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    problems: null,
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
    reset(p);
  }
  room.phase = 'lobby';
  room.problems = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ── Problems ────────────────────────────────────────────────────────────────

/** A whole number in [lo, hi], inclusive. */
function int(rng: Rng, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1)));
}

/** Linear from `a` at level 0 to `b` at level 1, rounded. */
function ramp(level: number, a: number, b: number): number {
  return Math.round(a + (b - a) * level);
}

function pick<T>(rng: Rng, weighted: [T, number][]): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [v, w] of weighted) {
    x -= w;
    if (x < 0) return v;
  }
  return weighted[weighted.length - 1][0];
}

function add(rng: Rng, max: number): Problem {
  const sum = int(rng, Math.max(2, Math.floor(max / 3)), max);
  const a = int(rng, 1, sum - 1);
  return { text: `${a} + ${sum - a}`, answer: sum, kind: 'add' };
}

/** Never negative: the second number is at most the first. */
function sub(rng: Rng, max: number): Problem {
  const a = int(rng, Math.max(2, Math.floor(max / 3)), max);
  const b = int(rng, 1, a);
  return { text: `${a} − ${b}`, answer: a - b, kind: 'sub' };
}

function mul(rng: Rng, hi: number): Problem {
  const a = int(rng, 2, hi);
  const b = int(rng, 2, hi);
  return { text: `${a} × ${b}`, answer: a * b, kind: 'mul' };
}

/** Exact: the dividend is built as divisor × quotient. */
function div(rng: Rng, hi: number): Problem {
  const b = int(rng, 2, hi);
  const q = int(rng, 2, hi);
  return { text: `${b * q} ÷ ${b}`, answer: q, kind: 'div' };
}

/** `a × b + c` or `a × b − c`, never below zero; × binds first as a child is taught. */
function twoStep(rng: Rng, hi: number, cMax: number): Problem {
  const a = int(rng, 2, hi);
  const b = int(rng, 2, hi);
  const product = a * b;
  if (rng() < 0.5) {
    const c = int(rng, 1, cMax);
    return { text: `${a} × ${b} + ${c}`, answer: product + c, kind: 'two-step' };
  }
  const c = int(rng, 1, Math.min(cMax, product));
  return { text: `${a} × ${b} − ${c}`, answer: product - c, kind: 'two-step' };
}

/** How far through the ramp problem `index` is, 0..1. */
export function level(index: number): number {
  return Math.min(1, Math.max(0, index / RAMP));
}

/** One problem at a point in the sequence. Every band's answer is a whole number ≥ 0. */
export function makeProblem(difficulty: Difficulty, index: number, rng: Rng): Problem {
  const l = level(index);
  switch (difficulty) {
    case 'easy': {
      const max = ramp(l, 10, 20);
      return pick(rng, [['add', 1], ['sub', 1]]) === 'add' ? add(rng, max) : sub(rng, max);
    }
    case 'medium': {
      const max = ramp(l, 30, 100);
      const hi = ramp(l, 5, 10);
      const k = pick<Kind>(rng, [['add', 1], ['sub', 1], ['mul', 1]]);
      return k === 'add' ? add(rng, max) : k === 'sub' ? sub(rng, max) : mul(rng, hi);
    }
    case 'hard': {
      const max = ramp(l, 200, 1000);
      const hi = ramp(l, 8, 12);
      const k = pick<Kind>(rng, [
        ['add', 2],
        ['sub', 2],
        ['mul', 2],
        ['div', 2],
        ['two-step', 1 + 2 * l],
      ]);
      if (k === 'add') return add(rng, max);
      if (k === 'sub') return sub(rng, max);
      if (k === 'mul') return mul(rng, hi);
      if (k === 'div') return div(rng, hi);
      return twoStep(rng, hi, ramp(l, 20, 100));
    }
  }
}

/** The one sequence everyone races through. The same problem never comes twice running. */
export function dealProblems(difficulty: Difficulty, rng: Rng, count = PROBLEM_COUNT): Problem[] {
  const out: Problem[] = [];
  for (let i = 0; i < count; i++) {
    let p = makeProblem(difficulty, i, rng);
    for (let tries = 0; tries < 3 && out.length && p.text === out[out.length - 1].text; tries++) {
      p = makeProblem(difficulty, i, rng);
    }
    out.push(p);
  }
  return out;
}

// ── Play ────────────────────────────────────────────────────────────────────

/**
 * One answer to one problem. `index` must be the problem in front of the player
 * — anything else is a stale double-submit (409) and changes nothing. A value
 * that is not a whole number is refused (400) and costs nothing.
 */
export function answer(room: Room, playerId: string, input: { index: unknown; value: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing' || room.problems === null || room.startedAt === null) {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  }
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS) throw new GameError(409, "Time's up.");
  if (isDone(room, p)) throw new GameError(409, 'You have answered them all.');
  if (typeof input.index !== 'number' || input.index !== p.index) {
    throw new GameError(409, 'That problem has already been answered.');
  }
  if (typeof input.value !== 'number' || !Number.isInteger(input.value)) {
    throw new GameError(400, 'Answers are whole numbers.');
  }

  const problem = room.problems[p.index];
  if (input.value === problem.answer) {
    p.index++;
    p.score++;
    p.streak++;
    if (p.streak % STREAK_BONUS === 0) p.score++;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
  } else {
    p.misses++;
    p.streak = 0;
    p.wrong[p.index] = (p.wrong[p.index] ?? 0) + 1;
  }
  room.updatedAt = now;
  finishIfDone(room, now);
}

function finishIfDone(room: Room, now: number): void {
  if (joined(room).every((p) => isDone(room, p))) finish(room, now);
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
        room.problems = dealProblems(room.difficulty, rng);
        room.startedAt = due;
        room.phaseEndsAt = due + TIME_LIMIT_MS;
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
  // The phone shows the limit; an answer sent just before it still lands.
  if (room.phase === 'playing') return room.phaseEndsAt + GRACE_MS;
  return room.phaseEndsAt;
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface Standing {
  id: string;
  name: string;
  score: number;
  correct: number;
  misses: number;
  bestStreak: number;
}

/** Most points first; a tie on points goes to fewer misses. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.index > 0 || p.misses > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      correct: p.index,
      misses: p.misses,
      bestStreak: p.bestStreak,
    }))
    .sort((a, b) => b.score - a.score || a.misses - b.misses);
}

/** Nobody wins alone, and nobody wins with nothing. Exact ties share. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score === 0) return [];
  const top = list[0];
  return list.filter((s) => s.score === top.score && s.misses === top.misses).map((s) => s.id);
}

export interface RecapRow {
  index: number;
  text: string;
  answer: number;
  /** False for the one they were stuck on when time ran out. */
  solved: boolean;
  wrongTries: number;
}

/** A player's last few problems, ending with the one they were on if unsolved. */
export function recap(room: Room, p: Player): RecapRow[] {
  const problems = room.problems ?? [];
  const reached = Math.min(p.index, problems.length - 1);
  if (reached < 0) return [];
  const rows: RecapRow[] = [];
  for (let i = Math.max(0, reached - RECENT + 1); i <= reached; i++) {
    rows.push({
      index: i,
      text: problems[i].text,
      answer: problems[i].answer,
      solved: i < p.index,
      wrongTries: p.wrong[i] ?? 0,
    });
  }
  // A current problem nobody has touched is not worth showing; the recap is what they did.
  const last = rows[rows.length - 1];
  if (last && !last.solved && last.wrongTries === 0) rows.pop();
  return rows;
}

/**
 * The room as one player's phone sees it. My current problem as text — never
 * its answer — and my own misses and streak; everyone else is a score and a
 * count. At the finish: standings, winners, and each player's recap with answers.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  const me = room.players.find((p) => p.id === meId);
  const current =
    room.phase === 'playing' && me && me.status === 'joined' && room.problems && !isDone(room, me)
      ? { index: me.index, text: room.problems[me.index].text }
      : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    timeLimitMs: TIME_LIMIT_MS,
    problemCount: PROBLEM_COUNT,
    streakBonus: STREAK_BONUS,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      score: p.score,
      answered: p.index,
    })),
    me: me
      ? { problem: current, score: me.score, correct: me.index, misses: me.misses, streak: me.streak, bestStreak: me.bestStreak }
      : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    recaps: finished
      ? room.players
          .filter((p) => table!.some((s) => s.id === p.id))
          .map((p) => ({ playerId: p.id, problems: recap(room, p) }))
      : null,
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
