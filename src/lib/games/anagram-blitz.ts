// Anagram Blitz — the rules, as pure functions over a room.
//
// Same shape as Wordle Race (`wordle-race.ts`): every function takes `now`
// (epoch ms) and, where it deals, a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out; nothing here
// knows about either.
//
// Everyone gets the same seven letters — a common seven-letter word, shuffled,
// so a seven-letter answer always exists — and finds as many words in them as
// they can before the clock runs out. Longer words score more. While it runs, a
// phone sees its own words and everyone else's COUNT and score only — enough to
// feel the race without handing anyone a word. At the finish everything is
// revealed, and a word only one player found scores double (solo: no doubling).
//
// The lobby (join / decline / leave / start / again) behaves exactly as Wordle
// Race's does, re-stated for the same reason Wordle Race gives.

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
import { COMMON_WORDS, RARE_WORDS, SEEDS } from "./words/anagram";

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

export const LETTER_COUNT = 7;
export const MIN_LENGTH = 3;
/** Points by word length. */
export const POINTS: Readonly<Record<number, number>> = {
  3: 1,
  4: 2,
  5: 4,
  6: 6,
  7: 10,
};
/** After the time limit, how long a word already in flight may still land. */
export const GRACE_MS = 1_000;
/** How many of the longest words nobody found are shown at the finish. */
export const MISSED_SHOWN = 5;

interface Tuning {
  /** Seeds are drawn from the first `pool` words of SEEDS (commonest first). */
  pool: number;
  timeLimitMs: number;
  minLength: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { pool: 200, timeLimitMs: 150_000, minLength: 3 },
  medium: { pool: 400, timeLimitMs: 120_000, minLength: 3 },
  hard: { pool: SEEDS.length, timeLimitMs: 90_000, minLength: 4 },
};

const COMMON = new Set(COMMON_WORDS);
const VALID = new Set([...COMMON_WORDS, ...RARE_WORDS]);

export interface Found {
  word: string;
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
  game: "anagram-blitz";
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** The word the letters were dealt from; never on the wire until finished. */
  seed: string | null;
  /** The shuffled letters everyone plays with; dealt when play starts. */
  letters: string[] | null;
  /** The longest common words nobody found, worked out once at the finish. */
  missed: string[] | null;
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, time limit, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function player(id: string, name: string, status: PlayerStatus): Player {
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

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  now: number;
}): Room {
  const invited = input.invite.filter(
    (p, i, all) =>
      p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > MAX_PLAYERS - 1) {
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  }
  return {
    id: input.id,
    game: "anagram-blitz",
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    seed: null,
    letters: null,
    missed: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
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
 * finish, for them and against everyone else's uniqueness.
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

/** The host plays again with whoever is still here; everyone else is asked again. */
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
  room.seed = null;
  room.letters = null;
  room.missed = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/**
 * Pick a seed from the difficulty's pool and shuffle its letters (Fisher–Yates).
 * A shuffle that lands back on the seed itself is rotated one place, so the
 * answer is never sitting there spelled out (unless every rotation spells it,
 * which no seven-letter word does).
 */
export function deal(
  difficulty: Difficulty,
  rng: Rng,
): { seed: string; letters: string[] } {
  const pool = Math.min(TUNING[difficulty].pool, SEEDS.length);
  const seed = SEEDS[Math.min(pool - 1, Math.floor(rng() * pool))];
  const letters = [...seed];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  if (letters.join("") === seed) letters.push(letters.shift()!);
  return { seed, letters };
}

export function isWord(word: string): boolean {
  return VALID.has(word);
}

/** Every letter of `word` used no more often than it appears in `letters`. */
export function fits(word: string, letters: readonly string[]): boolean {
  const left = new Map<string, number>();
  for (const ch of letters) left.set(ch, (left.get(ch) ?? 0) + 1);
  for (const ch of word) {
    const n = left.get(ch) ?? 0;
    if (n === 0) return false;
    left.set(ch, n - 1);
  }
  return true;
}

export function points(word: string): number {
  return POINTS[word.length] ?? 0;
}

/**
 * One word from one player. Too short, wrong letters or not a word is refused
 * (400) with a sentence for the player and costs nothing; a repeat is 409, as is
 * anything after the time limit and its grace.
 */
export function word(
  room: Room,
  playerId: string,
  input: { word: unknown },
  now: number,
): void {
  const p = find(room, playerId);
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (
    room.phase !== "playing" ||
    room.letters === null ||
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
  if (w !== "" && (!/^[a-z]+$/.test(w) || !fits(w, room.letters))) {
    throw new GameError(400, "Use only the letters you have.");
  }
  if (w.length < min) {
    throw new GameError(
      400,
      min > MIN_LENGTH
        ? `Words need at least ${min} letters on hard.`
        : `Words need at least ${min} letters.`,
    );
  }
  if (p.words.some((f) => f.word === w))
    throw new GameError(409, "You already have that one.");
  if (!isWord(w)) throw new GameError(400, "Not in the word list.");

  p.words.push({ word: w, at: now });
  room.updatedAt = now;
}

function finish(room: Room, now: number): void {
  room.phase = "finished";
  room.missed = missedWords(room);
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * The longest common words these letters make that nobody found, longest first
 * then alphabetical — the seed leads whenever it was missed. Rare words are
 * accepted in play but never held up as something you should have seen.
 */
export function missedWords(room: Room): string[] {
  if (!room.letters) return [];
  const letters = room.letters;
  const min = TUNING[room.difficulty].minLength;
  const found = new Set(
    room.players.flatMap((p) => p.words.map((f) => f.word)),
  );
  const candidates = COMMON_WORDS.filter(
    (w) => w.length >= min && !found.has(w) && fits(w, letters),
  );
  if (room.seed && !found.has(room.seed) && !COMMON.has(room.seed))
    candidates.push(room.seed);
  return candidates
    .sort(
      (a, b) =>
        Number(b === room.seed) - Number(a === room.seed) ||
        b.length - a.length ||
        (a < b ? -1 : a > b ? 1 : 0),
    )
    .slice(0, MISSED_SHOWN);
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
        const { seed, letters } = deal(room.difficulty, rng);
        room.phase = "playing";
        room.seed = seed;
        room.letters = letters;
        room.startedAt = due;
        room.phaseEndsAt = due + TUNING[room.difficulty].timeLimitMs;
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

/** Who took part in the result: everyone still in, and anyone who left having found something. */
function contenders(room: Room): Player[] {
  return room.players.filter(
    (p) => p.status === "joined" || p.words.length > 0,
  );
}

/** How many contenders found each word. */
function finders(room: Room): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const p of contenders(room)) {
    for (const f of p.words) by.set(f.word, [...(by.get(f.word) ?? []), p.id]);
  }
  return by;
}

export interface Scored {
  word: string;
  points: number;
  /** Finished only: nobody else found it (always false solo). */
  unique: boolean | null;
}

/**
 * A player's words as scored. While playing, each is its length's points. At the
 * finish, a word no other contender found scores double — unless there was only
 * one contender, when there is nobody to be unique against.
 */
export function scored(room: Room, p: Player): Scored[] {
  if (room.phase !== "finished")
    return p.words.map((f) => ({
      word: f.word,
      points: points(f.word),
      unique: null,
    }));
  const by = finders(room);
  const solo = contenders(room).length < 2;
  return p.words.map((f) => {
    const unique = !solo && (by.get(f.word)?.length ?? 0) === 1;
    return { word: f.word, points: points(f.word) * (unique ? 2 : 1), unique };
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
 * The room as one player's phone sees it. My own words come with their points;
 * everyone else's are a count and a score until the game is finished, and the
 * seed and missed words are null until then too.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === "finished";
  const table = finished ? standings(room) : null;
  const tuning = TUNING[room.difficulty];
  const by = finished ? finders(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    letterCount: LETTER_COUNT,
    minLength: tuning.minLength,
    points: POINTS,
    timeLimitMs: tuning.timeLimitMs,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    letters: room.letters,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      wordCount: p.words.length,
      score: score(room, p),
      words: p.id === meId || finished ? scored(room, p) : null,
    })),
    seed: finished ? room.seed : null,
    found: by
      ? [...by.keys()].sort(byLengthThenAlpha).map((w) => ({
          word: w,
          points: points(w),
          finderIds: by.get(w)!,
          unique: by.get(w)!.length === 1 && (table?.length ?? 0) >= 2,
        }))
      : null,
    missed: finished ? (room.missed ?? []) : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
