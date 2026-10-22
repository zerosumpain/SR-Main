// One Clue — the rules, as pure functions over a room.
//
// A co-operative word game in the shape of Categories (`categories.ts`): every
// function takes `now` (epoch ms) and, where it deals, a `rng`, so a whole game
// plays in a test without a clock. No model is called: the words are a curated
// list (`words/one-clue.ts`) and the checking is string work plus the family's
// own vetoes.
//
// Ten cards a game, three to seven players. On each card one player guesses —
// the guesser goes round the table — and everyone else is shown the secret
// word and writes ONE one-word clue, without seeing anybody else's. Then the
// server checks the clues: an empty one, one of more than one word, the word
// itself (or its stem, or a word containing it), and any two clues that are the
// same once normalised (case, accents, punctuation, a simple plural/stem) are
// cancelled. A short review follows in which the clue-givers may veto a clue
// that is too close in some way the checks cannot see (a sound-alike, a
// translation): a clue is struck once half the OTHER clue-givers still in
// (rounded up) have vetoed it — with two clue-givers, the other one's veto is
// enough, and with more, no single mischievous veto can wipe a good clue. The
// guesser then sees only the clues that survived, and guesses or passes.
//
// Right: +1. Pass (or the guess clock running out): the card is lost. Wrong:
// the card is lost AND the next card is discarded unplayed — on the last card,
// where there is no next one, a card already won is taken back instead. The
// team's score out of ten is everyone's result on the leaderboard.
//
// What a phone may see is the point of `toWire`: the guesser never gets the
// word, any clue, or a cancelled clue before the reveal; a clue-giver sees only
// their own clue while writing; nobody ever gets the rest of the deck.

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
} from "./tap-duel";
import { WORDS } from "./words/one-clue";

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase =
  | "lobby"
  | "countdown"
  | "clues"
  | "review"
  | "guess"
  | "reveal"
  | "finished"
  | "closed";

/** One Clue seats more than the site's usual five: a bigger table means more clues to cancel. */
export const MAX_PLAYERS = 7;
export const MIN_PLAYERS = 3;
/** Cards in a game — the team's score is out of this. */
export const CARDS = 10;
/** Longest clue kept, in characters; the rest is cut off. */
export const MAX_CLUE = 30;
/** Longest guess kept. */
export const MAX_GUESS = 40;

/** How long the clue-givers have to write, by difficulty. */
export const CLUE_MS: Record<Difficulty, number> = {
  easy: 90_000,
  medium: 75_000,
  hard: 60_000,
};
/** How long the clue-givers have to veto, unless all say done first. */
export const REVIEW_MS = 30_000;
/** How long the guesser has. A stalled guesser passes. */
export const GUESS_MS = 60_000;
/** How long everyone sees the answer, unless all say done first. */
export const REVEAL_MS = 12_000;
/** After a time limit, how long a clue or guess already in flight may still land. */
export const GRACE_MS = 1_000;

export type ClueStatus =
  | "ok"
  | "duplicate"
  | "too-close"
  | "not-one-word"
  | "vetoed"
  | "empty";

export type Outcome =
  | "correct"
  | "passed"
  | "wrong"
  | "timeout"
  | "left"
  | "discarded";

// ---- Words -----------------------------------------------------------------

/**
 * Text as the checks read it: lower case, accents off, apostrophes dropped,
 * anything else that is not a letter or digit a space, spaces single, and a
 * leading "a", "an" or "the" dropped ("the moon" is one word).
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

/**
 * A light stem: plurals off, then "-ing" / "-ed", then a final "e" and a
 * doubled last consonant — so bake, bakes, baked and baking are all "bak", and
 * run, runs and running are all "run". Deliberately simple: it only has to
 * catch the family's own near-copies, not be a linguist.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  let ending = false;
  if (w.length > 5 && w.endsWith("ing")) [w, ending] = [w.slice(0, -3), true];
  else if (w.length > 4 && w.endsWith("ed")) [w, ending] = [w.slice(0, -2), true];
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  // running → runn → run; but glass stays glass.
  if (ending && w.length > 2 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Edits (insert, delete, change, swap two neighbours) between two words. */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** The typos a guess may have and still be right: none under five letters, one to eight, two from nine. */
function typosAllowed(word: string): number {
  return word.length < 5 ? 0 : word.length < 9 ? 1 : 2;
}

/** Every secret word: a guess that is one of them is a different guess, never a typo (horse is not house). */
const KNOWN = new Set<string>([...WORDS.easy, ...WORDS.medium, ...WORDS.hard]);

/**
 * Whether a guess is the secret word, forgiving case, accents, an article, a
 * plural or other simple ending, spaces ("tooth brush"), and a trivial typo —
 * one that keeps the first letter and does not make another word on the lists.
 */
export function guessMatches(guess: string, word: string): boolean {
  const g = normalise(guess).replace(/ /g, "");
  const w = normalise(word).replace(/ /g, "");
  if (!g || !w) return false;
  if (g === w || stem(g) === stem(w)) return true;
  if (g[0] !== w[0] || KNOWN.has(g) || KNOWN.has(stem(g))) return false;
  return distance(g, w) <= typosAllowed(w);
}

/**
 * What the automatic checks make of one clue, before the duplicate count and
 * the vetoes: empty, more than one word, too close to the word, or fine.
 */
export function checkClue(text: string | undefined, word: string): "ok" | "empty" | "not-one-word" | "too-close" {
  if (text === undefined || text.trim() === "") return "empty";
  const c = normalise(text);
  if (!c || c.includes(" ")) return "not-one-word";
  const w = normalise(word).replace(/ /g, "");
  if (c === w || stem(c) === stem(w)) return "too-close";
  // Part of the word ("sun" for sunset) or the word inside it ("snowman" for snow).
  if (c.length >= 3 && w.includes(c)) return "too-close";
  if (w.length >= 3 && c.includes(w)) return "too-close";
  // A misspelling of the word is left to the review: horse is a fair clue for house.
  return "ok";
}

/** What two clues must share to be "the same clue". */
export function clueKey(text: string): string {
  return stem(normalise(text));
}

// ---- The room --------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Review: seen enough. Reveal: ready for the next card. */
  done: boolean;
}

/** One clue as judged. Frozen onto the card when the guesser is shown them. */
export interface JudgedClue {
  playerId: string;
  text: string;
  status: ClueStatus;
  /** Vetoes that count against it, and how many strike it. */
  vetoes: number;
  strikeAt: number;
}

export interface Card {
  /** Where it sits in the game's ten, 0 first. */
  index: number;
  word: string;
  guesserId: string;
  /** Everyone else in when the card was dealt. */
  givers: string[];
  /** Each clue-giver's clue as they last wrote it; absent is not written. */
  clues: Record<string, string>;
  /** Vetoes by the clue's author: who has vetoed it. */
  vetoes: Record<string, string[]>;
  /** The clues as judged when the review closed; null before. */
  judged: JudgedClue[] | null;
  guess: string | null;
  outcome: Outcome | null;
  /** A wrong guess on the last card took back a card already won. */
  tookBack: boolean;
}

export interface Room {
  id: string;
  game: "one-clue";
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** The game's ten words. SECRET: never on the wire. */
  deck: string[];
  /** The guessing order, fixed at the deal. */
  seats: string[];
  /** The card in play (or just revealed); null before the deal. */
  card: Card | null;
  /** Every card settled so far, in order — the discarded ones too. */
  played: Card[];
  /** The team's score. */
  score: number;
  /** The last game's words, kept off the next deal. */
  lastWords: string[];
  startedAt: number | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, done: false };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === "joined");
}

const isIn = (room: Room, id: string) => room.players.some((p) => p.id === id && p.status === "joined");

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, "You are not in this game.");
  return p;
}

function playing(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (p.status !== "joined") throw new GameError(403, "You are not playing this game.");
  return p;
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
    game: "one-clue",
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    deck: [],
    seats: [],
    card: null,
    played: [],
    score: 0,
    lastWords: [],
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line. */
export function about(_room: Room): string {
  return `${CARDS} cards · a team game`;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === "joined") return;
  if (room.phase !== "lobby") throw new GameError(409, "That game has already started.");
  p.status = "joined";
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "invited") return;
  p.status = "declined";
  room.updatedAt = now;
}

const inPlay = (phase: Phase) => phase === "clues" || phase === "review" || phase === "guess" || phase === "reveal";

/**
 * Leaving the lobby as host cancels the game; later, the host role passes on
 * and the last one out closes the room. In play:
 * - fewer than two left: the game ends where it stands (the score so far);
 * - the guesser leaving a card still in play loses that card (no penalty);
 * - a clue-giver leaving stops the table waiting on them: their clue, if
 *   written, still counts; their vetoes stop counting, and the strike bar
 *   drops with them.
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
  if (room.phase === "countdown" && rest.length < 2) {
    close(room, now);
    return;
  }
  if (!inPlay(room.phase) || !room.card) return;
  if (rest.length < 2) {
    if (room.phase !== "reveal") settleCard(room, "left", null, now);
    finish(room, now);
    return;
  }
  const card = room.card;
  if (playerId === card.guesserId && room.phase !== "reveal") {
    settleCard(room, "left", null, now);
    return;
  }
  if (room.phase === "clues" && allClued(room)) toReview(room, now);
  else if (room.phase === "review" && givers(room).every((q) => q.done)) toGuess(room, now);
  else if (room.phase === "reveal" && rest.every((q) => q.done)) nextCard(room, now);
}

function close(room: Room, now: number): void {
  room.phase = "closed";
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, "Only the host can start.");
  if (room.phase !== "lobby") throw new GameError(409, "That game has already started.");
  if (joined(room).length < MIN_PLAYERS)
    throw new GameError(409, `One Clue needs at least ${MIN_PLAYERS} players.`);
  for (const p of room.players) if (p.status === "invited") p.status = "declined";
  room.phase = "countdown";
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — fresh words — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, "Only the host can start another.");
  if (room.phase !== "finished") throw new GameError(409, "This game is still going.");
  for (const p of room.players) {
    p.status = p.status === "joined" ? "joined" : "invited";
    p.done = false;
  }
  room.lastWords = room.deck;
  room.phase = "lobby";
  room.deck = [];
  room.seats = [];
  room.card = null;
  room.played = [];
  room.score = 0;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Dealing ---------------------------------------------------------------

/** `CARDS` different words for the difficulty, the last game's kept off while there are enough. */
export function dealWords(difficulty: Difficulty, rng: Rng, previous: readonly string[] = []): string[] {
  const all = WORDS[difficulty];
  const fresh = all.filter((w) => !previous.includes(w));
  const pool = (fresh.length >= CARDS ? fresh : all).slice();
  for (let i = 0; i < CARDS && i < pool.length; i++) {
    const j = i + Math.min(pool.length - 1 - i, Math.floor(rng() * (pool.length - i)));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, CARDS);
}

/** The clue-givers still in, for the card in play. */
function givers(room: Room): Player[] {
  const ids = new Set(room.card?.givers ?? []);
  return joined(room).filter((p) => ids.has(p.id));
}

function allClued(room: Room): boolean {
  const card = room.card;
  if (!card) return false;
  const left = givers(room);
  return left.length > 0 && left.every((p) => (card.clues[p.id] ?? "").trim() !== "");
}

function resetDone(room: Room): void {
  for (const p of room.players) p.done = false;
}

function startCard(room: Room, index: number, guesserId: string, now: number): void {
  room.card = {
    index,
    word: room.deck[index],
    guesserId,
    givers: joined(room)
      .filter((p) => p.id !== guesserId)
      .map((p) => p.id),
    clues: {},
    vetoes: {},
    judged: null,
    guess: null,
    outcome: null,
    tookBack: false,
  };
  resetDone(room);
  room.phase = "clues";
  room.phaseEndsAt = now + CLUE_MS[room.difficulty];
  room.updatedAt = now;
}

/** The next guesser round the table after `after`, skipping anyone who has left. */
function nextGuesser(room: Room, after: string | null): string | null {
  const seats = room.seats;
  const from = after === null ? -1 : seats.indexOf(after);
  for (let step = 1; step <= seats.length; step++) {
    const id = seats[(from + step + seats.length) % seats.length];
    if (isIn(room, id)) return id;
  }
  return null;
}

function nextCard(room: Room, now: number): void {
  const index = room.played.length;
  const guesser = nextGuesser(room, room.card?.guesserId ?? null);
  if (index >= CARDS || guesser === null || joined(room).length < 2) {
    finish(room, now);
    return;
  }
  startCard(room, index, guesser, now);
}

// ---- Judging ---------------------------------------------------------------

/** How many vetoes strike a clue: half the OTHER clue-givers still in, rounded up. */
export function strikeAt(room: Room, ownerId: string): number {
  return Math.ceil(givers(room).filter((p) => p.id !== ownerId).length / 2);
}

function vetoesOn(room: Room, card: Card, ownerId: string): string[] {
  return (card.vetoes[ownerId] ?? []).filter((id) => id !== ownerId && isIn(room, id) && card.givers.includes(id));
}

/**
 * Every clue-giver's clue on the card, judged as it stands: the automatic
 * checks first, then duplicates (every copy goes), then the vetoes.
 */
export function judge(room: Room, card: Card): JudgedClue[] {
  const auto = card.givers.map((id) => ({ id, text: (card.clues[id] ?? "").trim(), status: checkClue(card.clues[id], card.word) }));
  const counts = new Map<string, number>();
  for (const c of auto) {
    if (c.status === "ok" || c.status === "too-close") {
      const key = clueKey(c.text);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return auto.map((c) => {
    const against = vetoesOn(room, card, c.id);
    const bar = strikeAt(room, c.id);
    let status: ClueStatus = c.status;
    if (status === "ok" && (counts.get(clueKey(c.text)) ?? 0) > 1) status = "duplicate";
    else if (status === "ok" && bar > 0 && against.length >= bar) status = "vetoed";
    return { playerId: c.id, text: c.text, status, vetoes: against.length, strikeAt: bar };
  });
}

/** Whether a clue passed the automatic checks and is unique — the only clues a veto can touch. */
function vetoable(room: Room, card: Card, ownerId: string): boolean {
  const status = judge(room, card).find((j) => j.playerId === ownerId)?.status;
  return status === "ok" || status === "vetoed";
}

function toReview(room: Room, now: number): void {
  const card = room.card!;
  const left = givers(room);
  const live = judge(room, card).filter((c) => c.status === "ok");
  // Nobody to veto anybody (one clue-giver), or nothing left to veto: straight on.
  if (left.length < 2 || live.length === 0) {
    toGuess(room, now);
    return;
  }
  resetDone(room);
  room.phase = "review";
  room.phaseEndsAt = now + REVIEW_MS;
  room.updatedAt = now;
}

function toGuess(room: Room, now: number): void {
  const card = room.card!;
  card.judged = judge(room, card);
  room.phase = "guess";
  room.phaseEndsAt = now + GUESS_MS;
  room.updatedAt = now;
}

/**
 * The card is over: score it, apply the wrong-guess penalty, and show
 * everyone the answer.
 */
function settleCard(room: Room, outcome: Outcome, guess: string | null, now: number): void {
  const card = room.card!;
  if (!card.judged) card.judged = judge(room, card);
  card.outcome = outcome;
  card.guess = guess;
  room.played.push(card);
  if (outcome === "correct") room.score += 1;
  if (outcome === "wrong") {
    const next = card.index + 1;
    if (next < CARDS) {
      room.played.push({
        index: next,
        word: room.deck[next],
        guesserId: "",
        givers: [],
        clues: {},
        vetoes: {},
        judged: [],
        guess: null,
        outcome: "discarded",
        tookBack: false,
      });
    } else if (room.score > 0) {
      room.score -= 1;
      card.tookBack = true;
    }
  }
  resetDone(room);
  room.phase = "reveal";
  room.phaseEndsAt = now + REVEAL_MS;
  room.updatedAt = now;
}

function finish(room: Room, now: number): void {
  room.phase = "finished";
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

// ---- Moves -----------------------------------------------------------------

function cleanText(input: unknown, max: number, what: string): string {
  if (input !== null && input !== undefined && typeof input !== "string")
    throw new GameError(400, `A ${what} is some text.`);
  return (typeof input === "string" ? input : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * A clue-giver's one clue for the card — written over whatever was there, and
 * cleared by an empty one. It is checked at the review, not here: a clue of two
 * words is kept and cancelled, so the table sees why. When every clue-giver
 * still in has written one, the review opens at once.
 */
export function clue(room: Room, playerId: string, input: { text: unknown }, now: number): void {
  playing(room, playerId);
  const card = room.card;
  if (room.phase !== "clues" || !card) throw new GameError(409, "It isn't time for clues.");
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS) throw new GameError(409, "Time's up.");
  if (playerId === card.guesserId) throw new GameError(403, "You are guessing this one.");
  if (!card.givers.includes(playerId)) throw new GameError(403, "You are not giving a clue on this card.");
  const text = cleanText(input.text, MAX_CLUE, "clue");
  if (text) card.clues[playerId] = text;
  else delete card.clues[playerId];
  room.updatedAt = now;
  if (allClued(room)) toReview(room, now);
}

/** During the review, a clue-giver vetoes somebody else's clue — or takes it back. Idempotent both ways. */
export function veto(room: Room, playerId: string, input: { playerId: unknown }, now: number, on = true): void {
  playing(room, playerId);
  const card = room.card;
  if (room.phase !== "review" || !card) throw new GameError(409, "Vetoes come after the clues.");
  if (!card.givers.includes(playerId)) throw new GameError(403, "Only the clue-givers veto.");
  if (typeof input.playerId !== "string") throw new GameError(400, "Whose clue?");
  if (input.playerId === playerId) throw new GameError(400, "You can't veto your own clue.");
  if (!card.givers.includes(input.playerId)) throw new GameError(400, "They gave no clue on this card.");
  if (on && !vetoable(room, card, input.playerId))
    throw new GameError(400, "That clue is already out.");
  const by = (card.vetoes[input.playerId] ?? []).filter((id) => id !== playerId);
  if (on) by.push(playerId);
  if (by.length) card.vetoes[input.playerId] = by;
  else delete card.vetoes[input.playerId];
  room.updatedAt = now;
}

export function unveto(room: Room, playerId: string, input: { playerId: unknown }, now: number): void {
  veto(room, playerId, input, now, false);
}

/**
 * Review: this clue-giver has seen enough — when all have, the guesser is
 * shown the clues. Reveal: this player is ready — when everyone is, the next
 * card is dealt.
 */
export function done(room: Room, playerId: string, now: number): void {
  const p = playing(room, playerId);
  const card = room.card;
  if (room.phase === "review" && card) {
    if (!card.givers.includes(playerId)) throw new GameError(403, "Only the clue-givers review.");
    p.done = true;
    room.updatedAt = now;
    if (givers(room).every((q) => q.done)) toGuess(room, now);
    return;
  }
  if (room.phase === "reveal") {
    p.done = true;
    room.updatedAt = now;
    if (joined(room).every((q) => q.done)) nextCard(room, now);
    return;
  }
  throw new GameError(409, room.phase === "finished" ? "That game is over." : "Not yet.");
}

function guesserOnly(room: Room, playerId: string, now: number): Card {
  playing(room, playerId);
  const card = room.card;
  if (room.phase !== "guess" || !card) throw new GameError(409, "It isn't time to guess.");
  if (now > (room.phaseEndsAt ?? Infinity) + GRACE_MS) throw new GameError(409, "Time's up.");
  if (playerId !== card.guesserId) throw new GameError(403, "Only the guesser guesses.");
  return card;
}

/** The guesser's one guess: right scores, wrong also costs the next card. */
export function guess(room: Room, playerId: string, input: { text: unknown }, now: number): void {
  const card = guesserOnly(room, playerId, now);
  const text = cleanText(input.text, MAX_GUESS, "guess");
  if (!text) throw new GameError(400, "Type a guess, or pass.");
  settleCard(room, guessMatches(text, card.word) ? "correct" : "wrong", text, now);
}

/** The guesser passes: the card is lost, and nothing else. */
export function pass(room: Room, playerId: string, now: number): void {
  guesserOnly(room, playerId, now);
  settleCard(room, "passed", null, now);
}

// ---- The clock -------------------------------------------------------------

/**
 * Move a room along the clock: whatever deadline has passed, act on it. Loops,
 * so a registry that slept through two deadlines lands where it should.
 * Nobody's silence freezes the table: unwritten clues are empty, an unfinished
 * review closes, a guesser who never answers passes.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 40; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case "lobby":
      case "finished":
        close(room, due);
        break;
      case "countdown": {
        room.deck = dealWords(room.difficulty, rng, room.lastWords);
        room.seats = joined(room).map((p) => p.id);
        room.played = [];
        room.score = 0;
        room.startedAt = due;
        const first = room.seats[Math.min(room.seats.length - 1, Math.floor(rng() * room.seats.length))];
        startCard(room, 0, first, due);
        break;
      }
      case "clues":
        toReview(room, due);
        break;
      case "review":
        toGuess(room, due);
        break;
      case "guess":
        settleCard(room, "timeout", null, due);
        break;
      case "reveal":
        nextCard(room, due);
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === "closed" || room.phaseEndsAt === null) return null;
  if (room.phase === "clues" || room.phase === "guess") return room.phaseEndsAt + GRACE_MS;
  return room.phaseEndsAt;
}

// ---- Results ---------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  /** The TEAM's score — the same for everyone. */
  score: number;
  /** Cards this player guessed right. */
  guessed: number;
  /** This player's clues that reached the guesser. */
  clues: number;
}

/** Everyone still in at the end, each with the team's score. */
export function standings(room: Room): Standing[] {
  return joined(room)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: room.score,
      guessed: room.played.filter((c) => c.guesserId === p.id && c.outcome === "correct").length,
      clues: room.played.reduce(
        (n, c) => n + (c.judged ?? []).filter((j) => j.playerId === p.id && j.status === "ok").length,
        0,
      ),
    }))
    .sort((a, b) => b.guessed - a.guessed || b.clues - a.clues);
}

/** A sentence for the team's score out of ten. */
export function verdict(score: number): string {
  if (score >= 10) return "Perfect: ten out of ten!";
  if (score >= 8) return "Brilliant teamwork.";
  if (score >= 6) return "A good game.";
  if (score >= 4) return "Not bad at all.";
  return "Tricky words — try again!";
}

// ---- The wire --------------------------------------------------------------

const publicCard = (c: Card) => ({
  index: c.index,
  word: c.word,
  guesserId: c.guesserId || null,
  outcome: c.outcome,
  guess: c.guess,
  tookBack: c.tookBack,
  clues: (c.judged ?? []).map((j) => ({ playerId: j.playerId, text: j.text, status: j.status })),
});

/**
 * The room as one player's phone sees it.
 *
 * - The deck never leaves the server; settled cards (`cards`) are public.
 * - `word`: the clue-givers still in, from the deal; everyone from the reveal.
 *   Never the guesser, a leaver or a watcher before the reveal.
 * - `clues` while writing: nobody's but my own (`myClue`); everyone sees only
 *   who has written one (`players[].submitted`).
 * - In the review the clue-givers see every clue judged, with its vetoes; the
 *   guesser sees nothing.
 * - While guessing the guesser sees only the clues that survived, and how many
 *   were cancelled — never their text; the clue-givers see them all.
 * - From the reveal, everyone sees everything about the card.
 */
export function toWire(room: Room, meId: string, now: number) {
  const card = room.card;
  const me = room.players.find((p) => p.id === meId);
  const iAmIn = me?.status === "joined";
  const live = room.phase === "clues" || room.phase === "review" || room.phase === "guess";
  const shown = room.phase === "reveal" || room.phase === "finished";
  const amGuesser = !!card && card.guesserId === meId;
  const amGiver = !!card && iAmIn && card.givers.includes(meId);
  const role = !card || !inPlay(room.phase) ? null : amGuesser ? "guesser" : amGiver ? "clue" : "watching";

  let word: string | null = null;
  if (card && (shown || (live && amGiver))) word = card.word;

  type WireClue = { playerId: string; text: string; status: ClueStatus; vetoes: number; strikeAt: number; vetoed: boolean };
  let clues: WireClue[] | null = null;
  let cancelled: number | null = null;
  if (card && room.phase === "review" && amGiver) {
    clues = judge(room, card).map((j) => ({ ...j, vetoed: (card.vetoes[j.playerId] ?? []).includes(meId) }));
  } else if (card && room.phase === "guess" && card.judged) {
    if (amGiver) clues = card.judged.map((j) => ({ ...j, vetoed: (card.vetoes[j.playerId] ?? []).includes(meId) }));
    else if (amGuesser) {
      clues = card.judged
        .filter((j) => j.status === "ok")
        .map((j) => ({ playerId: j.playerId, text: j.text, status: j.status, vetoes: 0, strikeAt: 0, vetoed: false }));
      cancelled = card.judged.filter((j) => j.status !== "ok" && j.status !== "empty").length;
    }
  } else if (card && shown && card.judged) {
    clues = card.judged.map((j) => ({ ...j, vetoed: (card.vetoes[j.playerId] ?? []).includes(meId) }));
  }

  const finished = room.phase === "finished";
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    cardCount: CARDS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    clueMs: CLUE_MS[room.difficulty],
    reviewMs: REVIEW_MS,
    guessMs: GUESS_MS,
    revealMs: REVEAL_MS,
    maxClue: MAX_CLUE,
    maxGuess: MAX_GUESS,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    score: room.score,
    /** The card in play, 0-based; null before the deal. */
    cardIndex: card && inPlay(room.phase) ? card.index : null,
    guesserId: card && inPlay(room.phase) ? card.guesserId : null,
    role,
    word,
    myClue: card && room.phase === "clues" && amGiver ? (card.clues[meId] ?? "") : null,
    clues,
    cancelledCount: cancelled,
    guess: card && shown && inPlay(room.phase) ? card.guess : null,
    outcome: card && room.phase === "reveal" ? card.outcome : null,
    tookBack: card && room.phase === "reveal" ? card.tookBack : false,
    cards: room.played.map(publicCard),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      role:
        !card || !inPlay(room.phase)
          ? null
          : p.id === card.guesserId
            ? "guesser"
            : card.givers.includes(p.id)
              ? "clue"
              : null,
      submitted: !!card && room.phase === "clues" && (card.clues[p.id] ?? "") !== "",
      done: p.done,
    })),
    standings: table,
    verdict: finished ? verdict(room.score) : null,
    // Co-operative: nobody beats anybody. The team's score is everyone's result.
    winnerIds: [] as string[],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
