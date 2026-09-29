// Boggle — the rules, as pure functions over a room.
//
// Same shape as Anagram Blitz (`anagram-blitz.ts`): every function takes `now`
// (epoch ms) and, where it deals, a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out; nothing here
// knows about either.
//
// Everyone gets the same roll of letter dice — 4×4, 5×5 or 6×6, picked by the
// host with the time limit and the scoring — and traces words through touching
// tiles (any of the eight directions, each tile once per word). The board is
// solved when it is dealt, so a dud roll is rerolled, easy rerolls until it is
// rich, and the finish can show what everybody missed and what it held.
//
// While it runs, a phone sees its own words and everyone else's COUNT and raw
// score only. At the finish everything is revealed; under classic scoring a
// word two or more players found is crossed out for all of them (solo: never).
//
// The lobby (join / decline / leave / start / again) behaves exactly as Anagram
// Blitz's does, re-stated for the same reason Wordle Race gives.

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
} from "./tap-duel";
import { COMMON_WORDS, RARE_WORDS } from "./words/anagram";
import { LONG_COMMON, LONG_RARE } from "./words/boggle";

export {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
};
export type { Difficulty, PlayerStatus, Rng };

export type Phase = "lobby" | "countdown" | "playing" | "finished" | "closed";

export const SIZES = [4, 5, 6] as const;
export type Size = (typeof SIZES)[number];
export const SECONDS = [30, 90, 120, 180] as const;
export type Seconds = (typeof SECONDS)[number];
export const SCORINGS = ["classic", "every"] as const;
export type Scoring = (typeof SCORINGS)[number];

export const DEFAULT_SIZE: Size = 4;
export const DEFAULT_SECONDS: Seconds = 120;
export const DEFAULT_SCORING: Scoring = "classic";

export const MAX_LENGTH = 16;
/**
 * Points by length in letters: a point a letter past two, so 3 → 1, 4 → 2,
 * 5 → 3 and on up to the longest word a board allows. Sent whole on the wire
 * so a phone never has to know the rule.
 */
export const POINTS: Readonly<Record<number, number>> = Object.fromEntries(
  Array.from({ length: MAX_LENGTH - 2 }, (_, i) => [i + 3, i + 1]),
);
/** After the time limit, how long a word already in flight may still land. */
export const GRACE_MS = 1_000;
/** How many of the best words nobody found are shown at the finish. */
export const MISSED_SHOWN = 10;
/** Rolls tried for a board that meets its floor before the last roll is taken anyway. */
const MAX_ROLLS = 40;

/** Shortest word, and how many common words a roll must hold, by difficulty and size. */
interface Tuning {
  minLength: number;
  floor: Record<Size, number>;
}

export const TUNING: Record<Difficulty, Tuning> = {
  // Measured over 200 random rolls a size: easy asks for about the richest
  // quarter, medium turns away the poorest quarter, hard only the poorest tenth.
  easy: { minLength: 3, floor: { 4: 70, 5: 170, 6: 245 } },
  medium: { minLength: 3, floor: { 4: 40, 5: 110, 6: 175 } },
  hard: { minLength: 4, floor: { 4: 12, 5: 45, 6: 75 } },
};

// The dice. A die is six faces; a face is one letter, or two (`qu` wherever the
// box has a Q, and the 6×6 set's an/er/he/in/th). 4×4 is the 1987 set, 5×5 Big
// Boggle's, 6×6 Super Big Boggle's with its blank faces made vowels — a blank
// tile is a rule a phone game does not need.
const die = (spec: string): string[] => spec.split(" ");
const DICE: Record<Size, string[][]> = {
  4: [
    "a a e e g n",
    "a b b j o o",
    "a c h o p s",
    "a f f k p s",
    "a o o t t w",
    "c i m o t u",
    "d e i l r x",
    "d e l r v y",
    "d i s t t y",
    "e e g h n w",
    "e e i n s u",
    "e h r t v w",
    "e i o s s t",
    "e l r t t y",
    "h i m n qu u",
    "h l n n r z",
  ].map(die),
  5: [
    "a a a f r s",
    "a a e e e e",
    "a a f i r s",
    "a d e n n n",
    "a e e e e m",
    "a e e g m u",
    "a e g m n n",
    "a f i r s y",
    "b j k qu x z",
    "c c e n s t",
    "c e i i l t",
    "c e i l p t",
    "c e i p s t",
    "d d h n o t",
    "d h h l o r",
    "d h l n o r",
    "d h l n o r",
    "e i i i t t",
    "e m o t t t",
    "e n s s s u",
    "f i p r s y",
    "g o r r v w",
    "i p r r r y",
    "n o o t u w",
    "o o o t t u",
  ].map(die),
  6: [
    "a a a f r s",
    "a a e e e e",
    "a a e e o o",
    "a a f i r s",
    "a b d e i o",
    "a d e n n n",
    "a e e e e m",
    "a e e g m u",
    "a e g m n n",
    "a e i l m n",
    "a e i n o u",
    "a f i r s y",
    "an er he in qu th",
    "b b j k x z",
    "c c e n s t",
    "c d d l n n",
    "c e i i t t",
    "c e i p s t",
    "c f g n u y",
    "d d h n o t",
    "d h h l o r",
    "d h h n o w",
    "d h l n o r",
    "e h i l r s",
    "e i i l s t",
    "e i l p s t",
    "e i o e i u",
    "e m t t t o",
    "e n s s s u",
    "g o r r v w",
    "h i r s t v",
    "h o p r s t",
    "i p r s y y",
    "j k qu w x z",
    "n o o t u w",
    "o o o t t u",
  ].map(die),
};

// ---- The dictionary ------------------------------------------------------
// Built on first use, not at import: the registry imports every game.

let dict: { sorted: string[]; valid: Set<string>; common: Set<string> } | null =
  null;

function dictionary() {
  if (!dict) {
    const common = new Set([...COMMON_WORDS, ...LONG_COMMON]);
    const valid = new Set([...common, ...RARE_WORDS, ...LONG_RARE]);
    const sorted = [...valid].sort();
    dict = { sorted, valid, common };
  }
  return dict;
}

export function isWord(word: string): boolean {
  return dictionary().valid.has(word);
}

/** Whether any word starts with `prefix` — binary search over the sorted list. */
function hasPrefix(prefix: string): boolean {
  const { sorted } = dictionary();
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo].startsWith(prefix);
}

// ---- The board -----------------------------------------------------------

export function isSize(v: unknown): v is Size {
  return typeof v === "number" && (SIZES as readonly number[]).includes(v);
}
export function isSeconds(v: unknown): v is Seconds {
  return typeof v === "number" && (SECONDS as readonly number[]).includes(v);
}
export function isScoring(v: unknown): v is Scoring {
  return typeof v === "string" && (SCORINGS as readonly string[]).includes(v);
}

/** The tiles touching `i` on a `size`×`size` board, diagonals included. */
export function neighbours(i: number, size: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size)
        out.push(rr * size + cc);
    }
  }
  return out;
}

/** Roll every die into a random place and a random face (Fisher–Yates). */
export function roll(size: Size, rng: Rng): string[] {
  const dice = DICE[size].slice();
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  return dice.map(
    (faces) =>
      faces[Math.min(faces.length - 1, Math.floor(rng() * faces.length))],
  );
}

/** A word and one way to trace it. */
export interface Traced {
  word: string;
  path: number[];
}

/**
 * Every dictionary word of `minLength` letters or more on this board, each with
 * the first path found for it, longest first then alphabetical.
 */
export function solve(grid: readonly string[], minLength: number): Traced[] {
  const size = Math.round(Math.sqrt(grid.length));
  const adj = grid.map((_, i) => neighbours(i, size));
  const { valid } = dictionary();
  const out = new Map<string, number[]>();
  const used = new Array<boolean>(grid.length).fill(false);
  const path: number[] = [];
  const walk = (i: number, sofar: string) => {
    const word = sofar + grid[i];
    if (word.length > MAX_LENGTH || !hasPrefix(word)) return;
    used[i] = true;
    path.push(i);
    if (word.length >= minLength && valid.has(word) && !out.has(word))
      out.set(word, path.slice());
    for (const n of adj[i]) if (!used[n]) walk(n, word);
    path.pop();
    used[i] = false;
  };
  for (let i = 0; i < grid.length; i++) walk(i, "");
  return [...out]
    .map(([word, p]) => ({ word, path: p }))
    .sort((a, b) => byLengthThenAlpha(a.word, b.word));
}

/** Whether `path` is a real trace on this board that spells `word`. */
export function spells(
  grid: readonly string[],
  path: readonly number[],
  word: string,
): boolean {
  const size = Math.round(Math.sqrt(grid.length));
  const seen = new Set<number>();
  let spelled = "";
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= grid.length || seen.has(i))
      return false;
    if (k > 0 && !neighbours(path[k - 1], size).includes(i)) return false;
    seen.add(i);
    spelled += grid[i];
  }
  return spelled === word;
}

/** One path that spells `word` on this board, or null. */
export function trace(grid: readonly string[], word: string): number[] | null {
  const size = Math.round(Math.sqrt(grid.length));
  const used = new Array<boolean>(grid.length).fill(false);
  const path: number[] = [];
  const walk = (i: number, at: number): boolean => {
    const face = grid[i];
    if (!word.startsWith(face, at)) return false;
    used[i] = true;
    path.push(i);
    if (at + face.length === word.length) return true;
    for (const n of neighbours(i, size))
      if (!used[n] && walk(n, at + face.length)) return true;
    path.pop();
    used[i] = false;
    return false;
  };
  for (let i = 0; i < grid.length; i++) if (walk(i, 0)) return path;
  return null;
}

/**
 * Roll until the board holds the difficulty's floor of common words, keeping
 * the richest roll seen if none does — so a deal always ends.
 */
export function deal(
  size: Size,
  difficulty: Difficulty,
  rng: Rng,
): { grid: string[]; solution: Traced[] } {
  const { minLength, floor } = TUNING[difficulty];
  const { common } = dictionary();
  let best: { grid: string[]; solution: Traced[]; rich: number } | null = null;
  for (let n = 0; n < MAX_ROLLS; n++) {
    const grid = roll(size, rng);
    const solution = solve(grid, minLength);
    const rich = solution.filter((t) => common.has(t.word)).length;
    if (!best || rich > best.rich) best = { grid, solution, rich };
    if (rich >= floor[size]) break;
  }
  return { grid: best!.grid, solution: best!.solution };
}

export function points(word: string): number {
  return Math.max(0, word.length - 2);
}

// ---- The room ------------------------------------------------------------

export interface Found {
  word: string;
  path: number[];
  at: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  words: Found[];
}

export interface Room {
  id: string;
  game: "boggle";
  difficulty: Difficulty;
  size: Size;
  seconds: Seconds;
  scoring: Scoring;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** The rolled faces, row-major; dealt when play starts. */
  grid: string[] | null;
  /** Every word the board holds, solved at the deal; never on the wire until finished. */
  solution: Traced[] | null;
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, time limit, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, words: [] };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === "joined");
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, "You are not in this game.");
  return p;
}

/** The round's choices from a create request; anything missing or unknown is the default. */
export function roundOptions(options: Record<string, unknown> | undefined): {
  size: Size;
  seconds: Seconds;
  scoring: Scoring;
} {
  const o = options ?? {};
  return {
    size: isSize(o.size) ? o.size : DEFAULT_SIZE,
    seconds: isSeconds(o.seconds) ? o.seconds : DEFAULT_SECONDS,
    scoring: isScoring(o.scoring) ? o.scoring : DEFAULT_SCORING,
  };
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
    (p, i, all) =>
      p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > MAX_PLAYERS - 1)
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  return {
    id: input.id,
    game: "boggle",
    difficulty: input.difficulty,
    ...roundOptions(input.options),
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    grid: null,
    solution: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function timeLabel(seconds: Seconds): string {
  return seconds < 120 ? `${seconds} seconds` : `${seconds / 60} minutes`;
}

/** The invite banner's line: "5×5 · 2 minutes", "· every word counts" when it does. */
export function about(room: Room): string {
  const base = `${room.size}×${room.size} · ${timeLabel(room.seconds)}`;
  return room.scoring === "every" ? `${base} · every word counts` : base;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === "joined") return;
  if (room.phase !== "lobby")
    throw new GameError(409, "That game has already started.");
  p.status = "joined";
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "invited") return;
  p.status = "declined";
  room.updatedAt = now;
}

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host role
 * to the next player, and the last one out closes the room. Play runs to the
 * clock, so nobody leaving ends it early; a leaver's words still count at the
 * finish, for them and against everyone else's under classic scoring.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "joined") return;
  p.status = "left";
  room.updatedAt = now;
  if (room.phase === "lobby" && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = rest[0].id;
}

function close(room: Room, now: number): void {
  room.phase = "closed";
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start.");
  if (room.phase !== "lobby")
    throw new GameError(409, "That game has already started.");
  for (const p of room.players)
    if (p.status === "invited") p.status = "declined";
  room.phase = "countdown";
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same round settings, a fresh roll — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start another.");
  if (room.phase !== "finished")
    throw new GameError(409, "This game is still going.");
  for (const p of room.players) {
    p.status = p.status === "joined" ? "joined" : "invited";
    p.words = [];
  }
  room.phase = "lobby";
  room.grid = null;
  room.solution = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/**
 * One word from one player, with the tiles the phone traced. A path that
 * spells it is kept as sent; otherwise the board is searched, so a typed word
 * works too. Too short, not on the board or not a word is refused (400) with a
 * sentence for the player and costs nothing; a repeat is 409, as is anything
 * after the time limit and its grace.
 */
export function word(
  room: Room,
  playerId: string,
  input: { word: unknown; path?: unknown },
  now: number,
): void {
  const p = find(room, playerId);
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (
    room.phase !== "playing" ||
    room.grid === null ||
    room.startedAt === null
  ) {
    throw new GameError(
      409,
      room.phase === "finished"
        ? "That game is over."
        : "The game has not started.",
    );
  }
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS)
    throw new GameError(409, "Time's up.");

  const w =
    typeof input.word === "string" ? input.word.trim().toLowerCase() : "";
  const min = TUNING[room.difficulty].minLength;
  if (w.length < min) {
    throw new GameError(
      400,
      min > 3
        ? `Words need at least ${min} letters on hard.`
        : `Words need at least ${min} letters.`,
    );
  }
  const sent = Array.isArray(input.path) ? (input.path as unknown[]) : null;
  const path =
    sent &&
    sent.every((n) => typeof n === "number") &&
    spells(room.grid, sent as number[], w)
      ? (sent as number[])
      : /^[a-z]+$/.test(w) && w.length <= MAX_LENGTH
        ? trace(room.grid, w)
        : null;
  if (!path) throw new GameError(400, "That word isn't on the board.");
  if (p.words.some((f) => f.word === w))
    throw new GameError(409, "You already have that one.");
  if (!isWord(w)) throw new GameError(400, "Not in the word list.");

  p.words.push({ word: w, path: [...path], at: now });
  room.updatedAt = now;
}

function finish(room: Room, now: number): void {
  room.phase = "finished";
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
      case "lobby":
      case "finished":
        close(room, due);
        break;
      case "countdown": {
        const { grid, solution } = deal(room.size, room.difficulty, rng);
        room.phase = "playing";
        room.grid = grid;
        room.solution = solution;
        room.startedAt = due;
        room.phaseEndsAt = due + room.seconds * 1000;
        room.updatedAt = due;
        break;
      }
      case "playing":
        finish(room, due);
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === "closed" || room.phaseEndsAt === null) return null;
  // The phone shows the limit; a word sent just before it still lands.
  if (room.phase === "playing") return room.phaseEndsAt + GRACE_MS;
  return room.phaseEndsAt;
}

// ---- Scoring -------------------------------------------------------------

/** Who took part in the result: everyone still in, and anyone who left having found something. */
function contenders(room: Room): Player[] {
  return room.players.filter(
    (p) => p.status === "joined" || p.words.length > 0,
  );
}

/** Which contenders found each word. */
function finders(room: Room): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const p of contenders(room))
    for (const f of p.words) by.set(f.word, [...(by.get(f.word) ?? []), p.id]);
  return by;
}

/** Whether a word is crossed out: classic scoring, a finished game, more than one contender found it. */
function crossedOut(
  room: Room,
  by: Map<string, string[]>,
  word: string,
): boolean {
  return room.scoring === "classic" && (by.get(word)?.length ?? 0) > 1;
}

export interface Scored {
  word: string;
  points: number;
  /** Finished only: somebody else found it too (null while playing). */
  shared: boolean | null;
  path: number[];
}

/**
 * A player's words as scored. While playing, each is its length's points. At the
 * finish, under classic scoring, a word another contender also found scores
 * nothing — with one contender nobody else can have found it.
 */
export function scored(room: Room, p: Player): Scored[] {
  if (room.phase !== "finished") {
    return p.words.map((f) => ({
      word: f.word,
      points: points(f.word),
      shared: null,
      path: f.path,
    }));
  }
  const by = finders(room);
  return p.words.map((f) => {
    const shared = (by.get(f.word)?.length ?? 0) > 1;
    return {
      word: f.word,
      points: crossedOut(room, by, f.word) ? 0 : points(f.word),
      shared,
      path: f.path,
    };
  });
}

export function score(room: Room, p: Player): number {
  return scored(room, p).reduce((sum, s) => sum + s.points, 0);
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  words: number;
  /** The longest word found (first found, on a tie); null if none. */
  longest: string | null;
}

function longestOf(p: Player): string | null {
  let best: string | null = null;
  for (const f of p.words)
    if (best === null || f.word.length > best.length) best = f.word;
  return best;
}

/** Highest score first; then more words; then the longer longest word. */
export function standings(room: Room): Standing[] {
  return contenders(room)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: score(room, p),
      words: p.words.length,
      longest: longestOf(p),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.words - a.words ||
        (b.longest?.length ?? 0) - (a.longest?.length ?? 0),
    );
}

/** Nobody wins alone, and nobody wins on nothing. Top score wins; ties share. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score <= 0) return [];
  const top = list[0].score;
  return list.filter((s) => s.score === top).map((s) => s.id);
}

const byLengthThenAlpha = (a: string, b: string) =>
  b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The best common words the board held that nobody found — most points, then
 * longest, then alphabetical. Rare words are accepted in play but never held up
 * as something you should have seen.
 */
export function missedWords(room: Room): Traced[] {
  if (!room.solution) return [];
  const { common } = dictionary();
  const found = new Set(
    room.players.flatMap((p) => p.words.map((f) => f.word)),
  );
  return room.solution
    .filter((t) => common.has(t.word) && !found.has(t.word))
    .sort(
      (a, b) =>
        points(b.word) - points(a.word) || byLengthThenAlpha(a.word, b.word),
    )
    .slice(0, MISSED_SHOWN);
}

/**
 * The room as one player's phone sees it. My own words come with their points
 * and paths; everyone else's are a count and a score until the game is
 * finished, and what the board held is null until then too.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === "finished";
  const table = finished ? standings(room) : null;
  const by = finished ? finders(room) : null;
  const pathOf = new Map<string, number[]>();
  if (by)
    for (const p of contenders(room))
      for (const f of p.words)
        if (!pathOf.has(f.word)) pathOf.set(f.word, f.path);
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    size: room.size,
    scoring: room.scoring,
    minLength: TUNING[room.difficulty].minLength,
    points: POINTS,
    timeLimitMs: room.seconds * 1000,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    grid: room.grid,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      wordCount: p.words.length,
      score: score(room, p),
      words: p.id === meId || finished ? scored(room, p) : null,
    })),
    found: by
      ? [...by.keys()].sort(byLengthThenAlpha).map((w) => ({
          word: w,
          points: crossedOut(room, by, w) ? 0 : points(w),
          finderIds: by.get(w)!,
          shared: by.get(w)!.length > 1,
          path: pathOf.get(w)!,
        }))
      : null,
    missed: finished
      ? missedWords(room).map((t) => ({
          word: t.word,
          points: points(t.word),
          path: t.path,
        }))
      : null,
    possible:
      finished && room.solution
        ? {
            words: room.solution.length,
            points: room.solution.reduce((s, t) => s + points(t.word), 0),
          }
        : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
