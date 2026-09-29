// Categories — the rules, as pure functions over a room.
//
// Same shape as Boggle (`boggle.ts`): every function takes `now` (epoch ms)
// and, where it deals, a `rng`, so a whole game plays in a test without a
// clock. The live registry owns timers and fan-out; nothing here knows about
// either. No model is called: the cards are a curated list and the checking is
// a letter test plus the family's own vetoes.
//
// Everyone gets the same letter and the same card of categories — 6, 8 or 10,
// with 90 s, 2 or 3 minutes on the clock, picked by the host. Each player
// writes one answer per category that starts with the letter. While it runs a
// phone sees its own answers and only how many slots everyone else has filled.
//
// When time is up there is a review: every answer is revealed, and anyone may
// veto someone else's answer. An answer is struck once half the OTHER players
// still in (rounded up) have vetoed it — with two players, the other one's
// veto is enough. The review ends on its own clock, or as soon as everyone
// still in says they are done. Then the finish: a point for each answer with
// the right letter that nobody else also wrote for that category (solo: never
// shared) and that was not struck.
//
// The lobby (join / decline / leave / start / again) behaves exactly as
// Boggle's does, re-stated for the same reason Wordle Race gives.

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
import { CATEGORIES } from "./words/categories";

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

export type Phase =
  "lobby" | "countdown" | "playing" | "review" | "finished" | "closed";

export const COUNTS = [6, 8, 10] as const;
export type Count = (typeof COUNTS)[number];
export const SECONDS = [90, 120, 180] as const;
export type Seconds = (typeof SECONDS)[number];

export const DEFAULT_COUNT: Count = 8;
export const DEFAULT_SECONDS: Seconds = 120;

/** Longest answer kept, in characters; the rest is cut off. */
export const MAX_ANSWER = 40;
/** After the time limit, how long an answer already in flight may still land. */
export const GRACE_MS = 1_000;
/** How long everyone has to read the answers and veto, unless all say done first. */
export const REVIEW_MS = 60_000;

/**
 * The letters each difficulty deals from. Easy keeps to letters plenty of
 * everyday words start with; medium adds the awkward vowels and a few
 * trickier consonants; hard is everything but X and Z, which leave most
 * cards blank.
 */
export const LETTERS: Record<Difficulty, readonly string[]> = {
  easy: [..."abcdefghlmnprstw"],
  medium: [..."abcdefghijklmnoprstuvw"],
  hard: [..."abcdefghijklmnopqrstuvwy"],
};

export type AnswerStatus =
  "ok" | "shared" | "wrong-letter" | "struck" | "empty";

export function isCount(v: unknown): v is Count {
  return typeof v === "number" && (COUNTS as readonly number[]).includes(v);
}
export function isSeconds(v: unknown): v is Seconds {
  return typeof v === "number" && (SECONDS as readonly number[]).includes(v);
}

// ---- Dealing ---------------------------------------------------------------

/** A letter from the difficulty's pool, never the one just played. */
export function dealLetter(
  difficulty: Difficulty,
  rng: Rng,
  previous: string | null,
): string {
  const pool = LETTERS[difficulty].filter((l) => l !== previous);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * `count` different categories, in a random order. The last card's are kept
 * off this one while the list has enough left over, so "again" feels new.
 */
export function dealCard(
  count: number,
  rng: Rng,
  previous: readonly string[] = [],
): string[] {
  const fresh = CATEGORIES.filter((c) => !previous.includes(c));
  const pool = (fresh.length >= count ? fresh : CATEGORIES).slice();
  // A partial Fisher–Yates: the first `count` places are the card.
  for (let i = 0; i < count && i < pool.length; i++) {
    const j =
      i + Math.min(pool.length - 1 - i, Math.floor(rng() * (pool.length - i)));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// ---- Checking --------------------------------------------------------------

/**
 * An answer as the checks read it: lower case, accents off, punctuation gone,
 * spaces single, and a leading "a", "an" or "the" dropped — "The Beatles" is a
 * B, "an Owl" is an O. A bare article is left as it is.
 */
export function normalise(text: string): string {
  const plain = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const bare = plain.replace(/^(a|an|the) /, "");
  return bare || plain;
}

/** Whether an answer starts with the round's letter, once normalised. */
export function startsWith(text: string, letter: string): boolean {
  const n = normalise(text);
  return n.length > 0 && n[0] === letter.toLowerCase();
}

/** What two answers must share to be "the same answer": spaces don't count. */
function sameKey(text: string): string {
  return normalise(text).replace(/ /g, "");
}

// ---- The room --------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** One per category on the card; "" is unanswered. Empty before the deal. */
  answers: string[];
  /** Review: this player has seen enough. */
  done: boolean;
}

export interface Room {
  id: string;
  game: "categories";
  difficulty: Difficulty;
  count: Count;
  seconds: Seconds;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** The round's letter, lower case; dealt when play starts. */
  letter: string | null;
  /** The card, dealt with the letter. */
  categories: string[] | null;
  /** The last game's letter and card, kept off the next deal. */
  lastLetter: string | null;
  lastCategories: string[];
  /**
   * Vetoes, keyed `${playerId}:${index}` (the answer's owner and its slot),
   * each a list of who vetoed it.
   */
  vetoes: Record<string, string[]>;
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, time limit, review end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, answers: [], done: false };
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
  count: Count;
  seconds: Seconds;
} {
  const o = options ?? {};
  return {
    count: isCount(o.categoryCount) ? o.categoryCount : DEFAULT_COUNT,
    seconds: isSeconds(o.seconds) ? o.seconds : DEFAULT_SECONDS,
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
    game: "categories",
    difficulty: input.difficulty,
    ...roundOptions(input.options),
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    letter: null,
    categories: null,
    lastLetter: null,
    lastCategories: [],
    vetoes: {},
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function timeLabel(seconds: Seconds): string {
  return seconds < 120 ? `${seconds} seconds` : `${seconds / 60} minutes`;
}

/** The invite banner's line: "8 categories · 2 minutes". */
export function about(room: Room): string {
  return `${room.count} categories · ${timeLabel(room.seconds)}`;
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
 * clock, so nobody leaving ends it early; a leaver's answers still count at the
 * finish, for them and against anyone who wrote the same. A leaver's vetoes
 * stop counting, and the bar for striking drops with them — so a review whose
 * last undecided player leaves ends there.
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
  if (room.phase === "review" && rest.every((q) => q.done)) finish(room, now);
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

/**
 * The host plays again — same round settings, a fresh letter and card — with
 * whoever is still here; everyone else is asked again.
 */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start another.");
  if (room.phase !== "finished")
    throw new GameError(409, "This game is still going.");
  for (const p of room.players) {
    p.status = p.status === "joined" ? "joined" : "invited";
    p.answers = [];
    p.done = false;
  }
  room.lastLetter = room.letter;
  room.lastCategories = room.categories ?? [];
  room.phase = "lobby";
  room.letter = null;
  room.categories = null;
  room.vetoes = {};
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/** A slot index from the wire: a whole number on the card, or a 400. */
function slot(room: Room, index: unknown): number {
  const count = room.categories?.length ?? 0;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  )
    throw new GameError(400, "That isn't one of the categories.");
  return index;
}

/**
 * One answer from one player, for one category — written over whatever was
 * there, and cleared by an empty one. Trimmed, spaces single, cut to
 * MAX_ANSWER. It is judged at the finish, not here: a wrong letter is kept
 * (the review shows it) and scores nothing. 409 outside play, or after the
 * time limit and its grace.
 */
export function answer(
  room: Room,
  playerId: string,
  input: { index: unknown; text: unknown },
  now: number,
): void {
  const p = find(room, playerId);
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "playing" || room.categories === null) {
    throw new GameError(
      409,
      room.phase === "review" || room.phase === "finished"
        ? "Time's up."
        : "The game has not started.",
    );
  }
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS)
    throw new GameError(409, "Time's up.");
  const i = slot(room, input.index);
  if (
    input.text !== null &&
    input.text !== undefined &&
    typeof input.text !== "string"
  )
    throw new GameError(400, "An answer is some text.");
  const text = (typeof input.text === "string" ? input.text : "")
    // Control characters and line breaks out; one space wherever there was any.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ANSWER)
    .trim();
  p.answers[i] = text;
  room.updatedAt = now;
}

const vetoKey = (ownerId: string, index: number) => `${ownerId}:${index}`;

/**
 * During the review, vetoing someone else's answer — or taking a veto back.
 * Nobody vetoes their own, or an empty slot. Idempotent both ways.
 */
export function veto(
  room: Room,
  playerId: string,
  input: { playerId: unknown; index: unknown },
  now: number,
  on = true,
): void {
  const me = find(room, playerId);
  if (me.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "review")
    throw new GameError(
      409,
      room.phase === "finished"
        ? "That game is over."
        : "Vetoes come after the clock.",
    );
  if (typeof input.playerId !== "string")
    throw new GameError(400, "Whose answer?");
  if (input.playerId === playerId)
    throw new GameError(400, "You can't veto your own answer.");
  const owner = room.players.find((x) => x.id === input.playerId);
  if (!owner) throw new GameError(400, "They are not in this game.");
  const i = slot(room, input.index);
  if (!(owner.answers[i] ?? ""))
    throw new GameError(400, "There is nothing there to veto.");
  const key = vetoKey(owner.id, i);
  const by = (room.vetoes[key] ?? []).filter((id) => id !== playerId);
  if (on) by.push(playerId);
  if (by.length) room.vetoes[key] = by;
  else delete room.vetoes[key];
  room.updatedAt = now;
}

export function unveto(
  room: Room,
  playerId: string,
  input: { playerId: unknown; index: unknown },
  now: number,
): void {
  veto(room, playerId, input, now, false);
}

/** During the review, this player has seen enough; when everyone still in has, it ends. */
export function done(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "review")
    throw new GameError(
      409,
      room.phase === "finished" ? "That game is over." : "Not yet.",
    );
  p.done = true;
  room.updatedAt = now;
  if (joined(room).every((q) => q.done)) finish(room, now);
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
        room.letter = dealLetter(room.difficulty, rng, room.lastLetter);
        room.categories = dealCard(room.count, rng, room.lastCategories);
        for (const p of room.players) p.answers = room.categories.map(() => "");
        room.phase = "playing";
        room.startedAt = due;
        room.phaseEndsAt = due + room.seconds * 1000;
        room.updatedAt = due;
        break;
      }
      case "playing":
        // Alone there is nobody to veto: straight to the finish.
        if (joined(room).length < 2) {
          finish(room, due);
        } else {
          room.phase = "review";
          room.phaseEndsAt = due + REVIEW_MS;
          room.updatedAt = due;
        }
        break;
      case "review":
        finish(room, due);
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === "closed" || room.phaseEndsAt === null) return null;
  // The phone shows the limit; an answer sent just before it still lands.
  if (room.phase === "playing") return room.phaseEndsAt + GRACE_MS;
  return room.phaseEndsAt;
}

// ---- Scoring ---------------------------------------------------------------

/** Who took part in the result: everyone still in, and anyone who left having answered. */
function contenders(room: Room): Player[] {
  return room.players.filter(
    (p) => p.status === "joined" || p.answers.some((a) => a !== ""),
  );
}

/** How many vetoes strike one of this player's answers: half the others still in, rounded up. */
export function strikeAt(room: Room, ownerId: string): number {
  const others = joined(room).filter((p) => p.id !== ownerId).length;
  return Math.ceil(others / 2);
}

/** The vetoes on one answer that still count — from players still in. */
function vetoesOn(room: Room, ownerId: string, index: number): string[] {
  const inRoom = new Set(joined(room).map((p) => p.id));
  return (room.vetoes[vetoKey(ownerId, index)] ?? []).filter((id) =>
    inRoom.has(id),
  );
}

/** For each category, how many contenders wrote each answer (right letter only). */
function tallies(room: Room): Map<string, number>[] {
  const count = room.categories?.length ?? 0;
  const by = Array.from({ length: count }, () => new Map<string, number>());
  const letter = room.letter ?? "";
  for (const p of contenders(room))
    for (let i = 0; i < count; i++) {
      const text = p.answers[i] ?? "";
      if (!text || !startsWith(text, letter)) continue;
      const key = sameKey(text);
      by[i].set(key, (by[i].get(key) ?? 0) + 1);
    }
  return by;
}

export interface Checked {
  index: number;
  text: string;
  status: AnswerStatus;
  points: number;
  /** Vetoes that count against it, and how many strike it. */
  vetoes: number;
  strikeAt: number;
  /** Whether the phone looking at it has vetoed it. */
  vetoed: boolean;
}

/**
 * A player's answers as judged, one per category. Empty and wrong-letter come
 * first — a veto cannot make them worse — then struck, then shared (only when
 * more than one contender wrote it), and what is left is a point.
 */
export function checked(
  room: Room,
  p: Player,
  meId: string,
  by = tallies(room),
): Checked[] {
  const letter = room.letter ?? "";
  const bar = strikeAt(room, p.id);
  return (room.categories ?? []).map((_, index) => {
    const text = p.answers[index] ?? "";
    const against = vetoesOn(room, p.id, index);
    const status: AnswerStatus = !text
      ? "empty"
      : !startsWith(text, letter)
        ? "wrong-letter"
        : bar > 0 && against.length >= bar
          ? "struck"
          : (by[index].get(sameKey(text)) ?? 0) > 1
            ? "shared"
            : "ok";
    return {
      index,
      text,
      status,
      points: status === "ok" ? 1 : 0,
      vetoes: against.length,
      strikeAt: bar,
      vetoed: against.includes(meId),
    };
  });
}

export function score(room: Room, p: Player, by = tallies(room)): number {
  return checked(room, p, "", by).reduce((sum, a) => sum + a.points, 0);
}

const filledOf = (p: Player) => p.answers.filter((a) => a !== "").length;

export interface Standing {
  id: string;
  name: string;
  score: number;
  /** Categories answered, right or wrong. */
  filled: number;
}

/** Highest score first; then more categories answered. */
export function standings(room: Room): Standing[] {
  const by = tallies(room);
  return contenders(room)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: score(room, p, by),
      filled: filledOf(p),
    }))
    .sort((a, b) => b.score - a.score || b.filled - a.filled);
}

/** Nobody wins alone, and nobody wins on nothing. Top score wins; ties share. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score <= 0) return [];
  const top = list[0].score;
  return list.filter((s) => s.score === top).map((s) => s.id);
}

/**
 * The room as one player's phone sees it. The letter and card once dealt. My
 * own answers as I wrote them while playing; everyone else's are a count until
 * the review, when every contender's is shown judged, with its vetoes.
 */
export function toWire(room: Room, meId: string, now: number) {
  const revealed = room.phase === "review" || room.phase === "finished";
  const finished = room.phase === "finished";
  const by = revealed ? tallies(room) : null;
  const shown = new Set(contenders(room).map((p) => p.id));
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    categoryCount: room.count,
    timeLimitMs: room.seconds * 1000,
    reviewMs: REVIEW_MS,
    maxAnswer: MAX_ANSWER,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    letter: room.letter,
    categories: room.categories,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      filled: filledOf(p),
      done: p.done,
      score: by && shown.has(p.id) ? score(room, p, by) : 0,
      answers:
        by && shown.has(p.id)
          ? checked(room, p, meId, by)
          : p.id === meId && room.categories
            ? room.categories.map((_, index) => ({
                index,
                text: p.answers[index] ?? "",
                status: null,
                points: 0,
                vetoes: 0,
                strikeAt: 0,
                vetoed: false,
              }))
            : null,
    })),
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
