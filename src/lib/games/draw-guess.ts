// Draw & Guess — the rules, as pure functions over a room.
//
// Same shape as Boggle (`boggle.ts`): every function takes `now` (epoch ms)
// and, where it deals, a `rng`, so a whole game plays in a test without a
// clock. The live registry owns timers and fan-out; nothing here knows about
// either.
//
// Everybody draws in turn, in seat order (once or twice round, the host's
// choice). The drawer is offered three words only they see and has ten seconds
// to pick one; then they draw it while everyone else guesses. A right guess
// scores by how early it came and is never shown to the others; a wrong one
// goes in the shared feed; a guess one letter off is told "close!" privately.
// Two letters of the word are given away as the clock runs down. After each
// drawing the word is revealed for a few seconds, then the next person draws.
//
// The drawing is the heavy part of the wire. A phone that says what it already
// holds (`since`, a drawing revision) is sent only the strokes after it — see
// `toWire` and the spec's "Why the drawing is sent as changes".
//
// The lobby (join / decline / leave / start / again) behaves as Boggle's does,
// except that a game needs two players, and a drawer leaving ends their turn.

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
import { EASY, HARD, MEDIUM } from "./words/draw-guess";

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
  | "lobby"
  | "countdown"
  | "picking"
  | "drawing"
  | "reveal"
  | "finished"
  | "closed";

export const MIN_PLAYERS = 2;
export const TURNS_EACH = [1, 2] as const;
export type TurnsEach = (typeof TURNS_EACH)[number];
export const SECONDS = [60, 80, 100] as const;
export type Seconds = (typeof SECONDS)[number];
export const DEFAULT_TURNS_EACH: TurnsEach = 1;
export const DEFAULT_SECONDS: Seconds = 80;

/** How long the drawer has to pick a word before the first is taken for them. */
export const PICK_MS = 10_000;
/** How long the word stays up between drawings. */
export const REVEAL_MS = 5_000;
/** Words offered to the drawer. */
export const CHOICES = 3;
/** Fractions of the drawing time at which a letter of the word is given away. */
export const HINTS_AT = [0.5, 0.75] as const;
/** A word this short (in letters) gives nothing away. */
export const NO_HINT_MAX = 3;

/** The canvas is a square 0…CANVAS on both axes; the phone scales it. */
export const CANVAS = 1000;
/** Points one drawing may hold (after undo / clear). */
export const MAX_POINTS = 5000;
/** Points one `stroke` post may carry. */
export const MAX_POST_POINTS = 300;
/** Drawing changes kept for phones asking `since`; an older cursor gets the whole drawing. */
export const MAX_LOG = 400;
/** A guesser's guesses are this far apart at least. */
export const GUESS_GAP_MS = 700;
export const MAX_GUESS_LENGTH = 40;
/** Feed entries kept per drawing. */
export const MAX_FEED = 60;

/** Points for guessers by the order they solved in: 1st, 2nd, 3rd, then everyone after. */
export const GUESS_POINTS = [5, 4, 3] as const;
export const LATE_GUESS_POINTS = 2;
/** The drawer's points per person who guessed it. */
export const DRAWER_POINTS = 2;

/** The palette, by name; `white` is the eraser. */
export const COLORS = [
  "black",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "brown",
  "white",
] as const;
export type Color = (typeof COLORS)[number];
/** Pen widths in canvas units. */
export const WIDTHS = [6, 14, 32] as const;
export type Width = (typeof WIDTHS)[number];

// ---- Words ---------------------------------------------------------------

const POOLS: Record<Difficulty, readonly string[]> = {
  easy: EASY,
  medium: [...EASY, ...MEDIUM],
  hard: [...MEDIUM, ...HARD],
};

/**
 * Lowercase, accents off, punctuation off, one space between words, no leading
 * a / an / the, and a trailing plural `s` dropped — so "The Apples" is "apple".
 */
export function normalise(text: string): string {
  let s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^(a|an|the) /, "");
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

/** Whether two strings are one insertion, deletion or substitution apart (or equal). */
export function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

/** Letter positions in a word (spaces and hyphens are not letters). */
function letterIndices(word: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) if (/[a-z]/.test(word[i])) out.push(i);
  return out;
}

/** The word as a guesser sees it: letters `_` unless given away, spaces kept. */
export function hintOf(word: string, shown: readonly number[]): string {
  return [...word]
    .map((ch, i) => (/[a-z]/.test(ch) && !shown.includes(i) ? "_" : ch))
    .join("");
}

export interface Choice {
  word: string;
  /** The letters given away, in order, if the drawer picks this one. */
  reveal: number[];
}

/** Three words nobody has had this game (any words, once the pool runs dry). */
export function dealChoices(
  difficulty: Difficulty,
  used: ReadonlySet<string>,
  rng: Rng,
): Choice[] {
  const pool = POOLS[difficulty];
  let fresh = pool.filter((w) => !used.has(w));
  if (fresh.length < CHOICES) fresh = pool.slice();
  const out: Choice[] = [];
  const bag = fresh.slice();
  while (out.length < CHOICES && bag.length) {
    const k = Math.min(bag.length - 1, Math.floor(rng() * bag.length));
    const word = bag.splice(k, 1)[0];
    const letters = letterIndices(word);
    const reveal: number[] = [];
    if (letters.length > NO_HINT_MAX) {
      while (reveal.length < HINTS_AT.length) {
        const at = letters.splice(
          Math.min(letters.length - 1, Math.floor(rng() * letters.length)),
          1,
        )[0];
        reveal.push(at);
      }
    }
    out.push({ word, reveal });
  }
  return out;
}

// ---- The drawing ---------------------------------------------------------

export interface Stroke {
  id: number;
  color: Color;
  width: Width;
  points: [number, number][];
}

/** One change to the drawing, numbered by the room's drawing revision. */
export type DrawOp =
  | {
      seq: number;
      op: "stroke";
      id: number;
      color: Color;
      width: Width;
      points: [number, number][];
    }
  | { seq: number; op: "undo" }
  | { seq: number; op: "clear" };

export interface Drawing {
  strokes: Stroke[];
  /** Changes since `from`, oldest first, at most MAX_LOG. */
  log: DrawOp[];
  /** A cursor below this cannot be answered with changes. */
  from: number;
}

function pointCount(d: Drawing): number {
  return d.strokes.reduce((n, s) => n + s.points.length, 0);
}

// ---- The room ------------------------------------------------------------

export interface Solver {
  id: string;
  points: number;
  at: number;
}

export interface FeedEntry {
  n: number;
  playerId: string;
  name: string;
  kind: "guess" | "solved" | "close";
  /** The guess as typed; null for "solved" (a right answer is never shown). */
  text: string | null;
  /** Only this player sees the entry (a "close!"); null for everyone. */
  to: string | null;
}

export interface Turn {
  /** Position in `order`. */
  index: number;
  drawerId: string;
  choices: Choice[];
  /** The picked word; null while picking. */
  word: string | null;
  reveal: number[];
  /** How many of `reveal` are shown now. */
  revealed: number;
  startedAt: number | null;
  solvers: Solver[];
  /** The drawer's points for this drawing, settled when it ends. */
  drawerPoints: number;
  /** Why it ended: the clock, everyone got it, or the drawer left. */
  ended: "time" | "solved" | "left" | null;
  feed: FeedEntry[];
  lastGuessAt: Record<string, number>;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
}

export interface Room {
  id: string;
  game: "draw-guess";
  difficulty: Difficulty;
  turnsEach: TurnsEach;
  seconds: Seconds;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** Who draws when: the joined players at the start, seat order, `turnsEach` times round. */
  order: string[];
  turn: Turn | null;
  /** Words dealt as the pick this game, never offered again. */
  used: string[];
  drawing: Drawing;
  /** Bumped on every change to the drawing, and when a new one starts; never reset. */
  revision: number;
  feedCount: number;
  /** Lobby expiry, countdown end, pick deadline, draw time, reveal end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === "joined");
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, "You are not in this game.");
  return p;
}

export function isTurnsEach(v: unknown): v is TurnsEach {
  return typeof v === "number" && (TURNS_EACH as readonly number[]).includes(v);
}
export function isSeconds(v: unknown): v is Seconds {
  return typeof v === "number" && (SECONDS as readonly number[]).includes(v);
}

/** The game's choices from a create request; anything missing or unknown is the default. */
export function roundOptions(options: Record<string, unknown> | undefined): {
  turnsEach: TurnsEach;
  seconds: Seconds;
} {
  const o = options ?? {};
  return {
    turnsEach: isTurnsEach(o.turnsEach) ? o.turnsEach : DEFAULT_TURNS_EACH,
    seconds: isSeconds(o.seconds) ? o.seconds : DEFAULT_SECONDS,
  };
}

function emptyDrawing(from: number): Drawing {
  return { strokes: [], log: [], from };
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
    game: "draw-guess",
    difficulty: input.difficulty,
    ...roundOptions(input.options),
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    order: [],
    turn: null,
    used: [],
    drawing: emptyDrawing(0),
    revision: 0,
    feedCount: 0,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line: "80 seconds a drawing · twice round". */
export function about(room: Room): string {
  const base = `${room.seconds} seconds a drawing`;
  return room.turnsEach === 2 ? `${base} · twice round` : base;
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
 * Leaving the lobby as host cancels the game; the last one out closes the room.
 * A drawer who leaves ends their turn (the word is revealed, they score nothing
 * for it); once fewer than two are left, the game is finished. Anyone else
 * leaving hands on the host role as Boggle does.
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
  if (room.phase === "lobby" || room.phase === "finished") return;
  if (rest.length < MIN_PLAYERS) {
    finish(room, now);
    return;
  }
  const turn = room.turn;
  if (!turn || (room.phase !== "picking" && room.phase !== "drawing")) return;
  if (turn.drawerId === playerId) endTurn(room, now, "left");
  else if (room.phase === "drawing" && everyoneSolved(room))
    endTurn(room, now, "solved");
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
  if (joined(room).length < MIN_PLAYERS)
    throw new GameError(409, "Draw & Guess needs at least two players.");
  for (const p of room.players)
    if (p.status === "invited") p.status = "declined";
  const seats = joined(room).map((p) => p.id);
  room.order = Array.from({ length: room.turnsEach }, () => seats).flat();
  room.phase = "countdown";
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same settings, fresh words — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start another.");
  if (room.phase !== "finished")
    throw new GameError(409, "This game is still going.");
  for (const p of room.players) {
    p.status = p.status === "joined" ? "joined" : "invited";
    p.score = 0;
  }
  room.phase = "lobby";
  room.order = [];
  room.turn = null;
  room.used = [];
  room.revision += 1;
  room.drawing = emptyDrawing(room.revision);
  room.feedCount = 0;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/** The next drawer from `index` on who is still here, and a fresh drawing — or the finish. */
function beginTurn(room: Room, index: number, now: number, rng: Rng): void {
  if (joined(room).length < MIN_PLAYERS) {
    finish(room, now);
    return;
  }
  let k = index;
  while (
    k < room.order.length &&
    room.players.find((p) => p.id === room.order[k])?.status !== "joined"
  )
    k++;
  if (k >= room.order.length) {
    finish(room, now);
    return;
  }
  const choices = dealChoices(room.difficulty, new Set(room.used), rng);
  room.turn = {
    index: k,
    drawerId: room.order[k],
    choices,
    word: null,
    reveal: [],
    revealed: 0,
    startedAt: null,
    solvers: [],
    drawerPoints: 0,
    ended: null,
    feed: [],
    lastGuessAt: {},
  };
  room.revision += 1;
  room.drawing = emptyDrawing(room.revision);
  room.phase = "picking";
  room.phaseEndsAt = now + PICK_MS;
  room.updatedAt = now;
}

function beginDrawing(
  room: Room,
  turn: Turn,
  choice: Choice,
  now: number,
): void {
  turn.word = choice.word;
  turn.reveal = choice.reveal;
  turn.startedAt = now;
  room.used.push(choice.word);
  room.phase = "drawing";
  room.phaseEndsAt = now + room.seconds * 1000;
  room.updatedAt = now;
}

/** The drawer picks one of the three words they were offered. */
export function pick(
  room: Room,
  playerId: string,
  input: { index: unknown },
  now: number,
): void {
  const turn = room.turn;
  if (room.phase !== "picking" || !turn)
    throw new GameError(409, "There is no word to pick now.");
  if (turn.drawerId !== playerId)
    throw new GameError(403, "It's not your turn to draw.");
  const i = input.index;
  if (
    typeof i !== "number" ||
    !Number.isInteger(i) ||
    i < 0 ||
    i >= turn.choices.length
  )
    throw new GameError(400, "Pick one of the three words.");
  beginDrawing(room, turn, turn.choices[i], now);
}

function drawerTurn(room: Room, playerId: string): Turn {
  const p = find(room, playerId);
  const turn = room.turn;
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "drawing" || !turn)
    throw new GameError(409, "Nobody is drawing right now.");
  if (turn.drawerId !== playerId)
    throw new GameError(403, "It's not your turn to draw.");
  return turn;
}

function record(room: Room, op: DrawOp): void {
  const d = room.drawing;
  d.log.push(op);
  if (d.log.length > MAX_LOG) {
    const dropped = d.log.splice(0, d.log.length - MAX_LOG);
    d.from = Math.max(d.from, dropped[dropped.length - 1].seq);
  }
}

/** Quantise a posted point onto the canvas, or null if it is not a pair of numbers. */
function toPoint(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, y] = v;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const q = (n: number) => Math.min(CANVAS, Math.max(0, Math.round(n)));
  return [q(x), q(y)];
}

/**
 * Part or all of one stroke from the drawer. A stroke id the drawing already
 * holds APPENDS to that stroke (keeping its colour and width), so a long line
 * streams in as it is drawn; a new id starts a stroke on top.
 */
export function stroke(
  room: Room,
  playerId: string,
  input: { id: unknown; color: unknown; width: unknown; points: unknown },
  now: number,
): void {
  drawerTurn(room, playerId);
  const { id, color, width, points } = input;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > 1e9)
    throw new GameError(400, "A stroke needs an id.");
  if (!Array.isArray(points) || points.length === 0)
    throw new GameError(400, "A stroke needs points.");
  if (points.length > MAX_POST_POINTS)
    throw new GameError(400, `Up to ${MAX_POST_POINTS} points at a time.`);
  const pts: [number, number][] = [];
  for (const v of points) {
    const p = toPoint(v);
    if (!p) throw new GameError(400, "Points are [x, y] pairs.");
    pts.push(p);
  }
  const d = room.drawing;
  if (pointCount(d) + pts.length > MAX_POINTS)
    throw new GameError(
      409,
      "The drawing is full. Undo or clear to keep going.",
    );
  let s = d.strokes.find((x) => x.id === id);
  if (!s) {
    if (
      typeof color !== "string" ||
      !(COLORS as readonly string[]).includes(color)
    )
      throw new GameError(400, "Pick a colour from the palette.");
    if (
      typeof width !== "number" ||
      !(WIDTHS as readonly number[]).includes(width)
    )
      throw new GameError(400, "Pick a pen width.");
    s = { id, color: color as Color, width: width as Width, points: [] };
    d.strokes.push(s);
  }
  s.points.push(...pts);
  room.revision += 1;
  record(room, {
    seq: room.revision,
    op: "stroke",
    id,
    color: s.color,
    width: s.width,
    points: pts,
  });
  room.updatedAt = now;
}

/** Take the last stroke off. Nothing to undo is not an error. */
export function undo(room: Room, playerId: string, now: number): void {
  drawerTurn(room, playerId);
  if (!room.drawing.strokes.length) return;
  room.drawing.strokes.pop();
  room.revision += 1;
  record(room, { seq: room.revision, op: "undo" });
  room.updatedAt = now;
}

export function clear(room: Room, playerId: string, now: number): void {
  drawerTurn(room, playerId);
  if (!room.drawing.strokes.length) return;
  room.drawing.strokes = [];
  room.revision += 1;
  record(room, { seq: room.revision, op: "clear" });
  room.updatedAt = now;
}

function guessers(room: Room): Player[] {
  return joined(room).filter((p) => p.id !== room.turn?.drawerId);
}

function everyoneSolved(room: Room): boolean {
  const turn = room.turn;
  if (!turn) return false;
  const left = guessers(room);
  return (
    left.length > 0 &&
    left.every((p) => turn.solvers.some((s) => s.id === p.id))
  );
}

function post(room: Room, turn: Turn, entry: Omit<FeedEntry, "n">): void {
  room.feedCount += 1;
  turn.feed.push({ n: room.feedCount, ...entry });
  if (turn.feed.length > MAX_FEED)
    turn.feed.splice(0, turn.feed.length - MAX_FEED);
}

/**
 * One guess from someone who is not drawing. Right: they score by the order
 * they got it in, the feed says "got it!" without the word, and the drawing
 * ends early once everybody has. Wrong: it goes in the feed for all to see —
 * unless it is one letter off, when only the guesser sees it, marked close.
 */
export function guess(
  room: Room,
  playerId: string,
  input: { text: unknown },
  now: number,
): void {
  const p = find(room, playerId);
  const turn = room.turn;
  if (p.status !== "joined")
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "drawing" || !turn || turn.word === null)
    throw new GameError(409, "Wait for the drawing.");
  if (turn.drawerId === playerId)
    throw new GameError(409, "You're drawing — no guessing!");
  if (turn.solvers.some((s) => s.id === playerId))
    throw new GameError(409, "You've already got it.");
  const text =
    typeof input.text === "string"
      ? input.text.replace(/\s+/g, " ").trim()
      : "";
  if (!text || text.length > MAX_GUESS_LENGTH)
    throw new GameError(400, "Type a guess.");
  const last = turn.lastGuessAt[playerId];
  if (last !== undefined && now - last < GUESS_GAP_MS)
    throw new GameError(409, "Not so fast — one guess at a time.");
  turn.lastGuessAt[playerId] = now;

  const said = normalise(text);
  const target = normalise(turn.word);
  if (said === target) {
    const order = turn.solvers.length;
    const points = GUESS_POINTS[order] ?? LATE_GUESS_POINTS;
    turn.solvers.push({ id: playerId, points, at: now });
    p.score += points;
    post(room, turn, {
      playerId,
      name: p.name,
      kind: "solved",
      text: null,
      to: null,
    });
    room.updatedAt = now;
    if (everyoneSolved(room)) endTurn(room, now, "solved");
    return;
  }
  const close = said.length > 0 && withinOne(said, target);
  post(room, turn, {
    playerId,
    name: p.name,
    kind: close ? "close" : "guess",
    text,
    to: close ? playerId : null,
  });
  room.updatedAt = now;
}

/** The drawing is over: settle the drawer's points (none if they left) and show the word. */
function endTurn(
  room: Room,
  now: number,
  why: "time" | "solved" | "left",
): void {
  const turn = room.turn;
  if (!turn) return;
  // A drawer who left in the pick never chose; the first word is the one revealed.
  if (turn.word === null) {
    turn.word = turn.choices[0].word;
    room.used.push(turn.word);
  }
  turn.ended = why;
  turn.revealed = turn.reveal.length;
  const drawer = room.players.find((p) => p.id === turn.drawerId);
  turn.drawerPoints =
    why === "left" || drawer?.status !== "joined"
      ? 0
      : DRAWER_POINTS * turn.solvers.length;
  if (drawer) drawer.score += turn.drawerPoints;
  room.phase = "reveal";
  room.phaseEndsAt = now + REVEAL_MS;
  room.updatedAt = now;
}

function finish(room: Room, now: number): void {
  room.phase = "finished";
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/** When the next letter is given away, or null if none is left to give. */
function nextHintAt(room: Room): number | null {
  const turn = room.turn;
  if (!turn || turn.startedAt === null || turn.revealed >= turn.reveal.length)
    return null;
  return turn.startedAt + HINTS_AT[turn.revealed] * room.seconds * 1000;
}

/**
 * Move a room along the clock by ONE step: whatever is due, act on it, and time
 * the next phase from `now`. A registry that slept through several deadlines is
 * caught up one step per call (it calls again at once), so a stale clock never
 * plays out a whole turn that nobody saw. Returns whether anything changed.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case "lobby":
    case "finished":
      close(room, now);
      break;
    case "countdown":
      beginTurn(room, 0, now, rng);
      break;
    case "picking":
      beginDrawing(room, room.turn!, room.turn!.choices[0], now);
      break;
    case "drawing": {
      const turn = room.turn!;
      if (now >= (room.phaseEndsAt ?? 0)) {
        endTurn(room, now, "time");
        break;
      }
      // Hints only: give away every letter now due.
      while (nextHintAt(room) !== null && nextHintAt(room)! <= now)
        turn.revealed += 1;
      room.updatedAt = now;
      break;
    }
    case "reveal":
      beginTurn(room, (room.turn?.index ?? -1) + 1, now, rng);
      break;
    default:
      return false;
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === "closed" || room.phaseEndsAt === null) return null;
  if (room.phase === "drawing") {
    const hint = nextHintAt(room);
    return hint === null ? room.phaseEndsAt : Math.min(hint, room.phaseEndsAt);
  }
  return room.phaseEndsAt;
}

// ---- Scoring -------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  score: number;
}

/** Everyone still in, and anyone who left having scored; highest first. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === "joined" || p.score > 0)
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

/** Nobody wins alone, and nobody wins on nothing. Top score wins; ties share. */
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

/**
 * The drawing for a phone that holds it up to `since`: only the changes after
 * that when the log still reaches back to it, else the whole drawing.
 */
function drawingWire(room: Room, since: number | null | undefined) {
  const d = room.drawing;
  const delta =
    typeof since === "number" &&
    Number.isInteger(since) &&
    since >= d.from &&
    since <= room.revision;
  return delta
    ? {
        revision: room.revision,
        since,
        strokes: null,
        ops: d.log.filter((op) => op.seq > since),
      }
    : { revision: room.revision, since: null, strokes: d.strokes, ops: null };
}

/**
 * The room as one player's phone sees it. The word (and the choices) go to the
 * drawer, and to a guesser only once they have got it or the drawing is over;
 * everyone else sees the blanks with the letters given away so far. A "close!"
 * reaches only its guesser. `since` asks for the drawing as changes.
 */
export function toWire(
  room: Room,
  meId: string,
  now: number,
  since?: number | null,
) {
  const finished = room.phase === "finished";
  const table = finished ? standings(room) : null;
  const turn = room.turn;
  const drawer = turn?.drawerId === meId;
  const over = room.phase === "reveal" || finished;
  const solvedMe = turn?.solvers.some((s) => s.id === meId) ?? false;
  const inTurn = turn && room.phase !== "lobby" && room.phase !== "countdown";
  const word =
    turn?.word && (over || (room.phase === "drawing" && (drawer || solvedMe)))
      ? turn.word
      : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    turnsEach: room.turnsEach,
    timeLimitMs: room.seconds * 1000,
    pickMs: PICK_MS,
    revealMs: REVEAL_MS,
    phaseEndsAt: room.phaseEndsAt,
    turn: inTurn
      ? {
          index: turn.index,
          of: room.order.length,
          drawerId: turn.drawerId,
          startedAt: turn.startedAt,
          choices:
            drawer && room.phase === "picking"
              ? turn.choices.map((c) => c.word)
              : null,
          word,
          hint:
            turn.word && room.phase === "drawing"
              ? hintOf(turn.word, turn.reveal.slice(0, turn.revealed))
              : null,
          solvers: turn.solvers.map((s) => ({ id: s.id, points: s.points })),
          drawerPoints: over ? turn.drawerPoints : null,
          ended: turn.ended,
          feed: turn.feed
            .filter((f) => f.to === null || f.to === meId)
            .map((f) => ({
              n: f.n,
              playerId: f.playerId,
              name: f.name,
              kind: f.kind,
              text: f.text,
            })),
        }
      : null,
    drawing: inTurn ? drawingWire(room, since) : null,
    palette: COLORS,
    widths: WIDTHS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      score: p.score,
      solved: turn?.solvers.some((s) => s.id === p.id) ?? false,
      isDrawing: inTurn ? turn.drawerId === p.id : false,
    })),
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
