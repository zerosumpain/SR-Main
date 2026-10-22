// Homestead — an island-settling board game for three to five, as pure
// functions over a room (spec: docs/superpowers/specs/2026-10-22-family-games-
// homestead.md).
//
// Same shape as Liar's Dice and Chess: every function takes `now` (epoch ms),
// the registry owns timers and fan-out, nothing here knows about either. One
// difference: the room carries its OWN seeded generator (`rng`, sfc32 state),
// so a durable room written to the database and read back days later rolls the
// same dice it would have, and a test can seed a whole game. The registry's
// `rng` argument to `advance` is not used.
//
// Hidden information — other players' resource cards, everyone's unplayed
// almanac cards, the deck order, the generator, which card a steal took — never
// leaves `toWire` except to the one player it belongs to.
//
// Every name here is Homestead's own: timber, clay, wool, grain and stone; the
// fox; cottages and towns; almanac cards (ranger, heirloom, pathfinders,
// harvest, market); Longest Trail and Chief Ranger.

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
import {
  RESOURCES,
  ISLAND,
  edgeEnds,
  generateIsland,
  geometry,
  hexCorners,
  isResource,
  parseEdge,
  parseHex,
  parseVertex,
  shuffle,
  type Board,
  type Harbour,
  type Hex,
  type IslandSize,
  type Resource,
} from './homestead-board';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES, RESOURCES };
export type { Difficulty, PlayerStatus, Rng, Resource, IslandSize };

export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';
export type Step = 'setup' | 'roll' | 'discard' | 'fox' | 'main' | 'roads';
export type Pace = 'live' | 'async';
export type Piece = 'road' | 'cottage' | 'town';
export type CardKind = 'ranger' | 'heirloom' | 'pathfinders' | 'harvest' | 'market';
export type Hand = Record<Resource, number>;

const CARD_KINDS: readonly CardKind[] = ['ranger', 'heirloom', 'pathfinders', 'harvest', 'market'];
const isCardKind = (v: unknown): v is CardKind => typeof v === 'string' && (CARD_KINDS as readonly string[]).includes(v);

export const MIN_PLAYERS = 3;
export const PIECES: Record<Piece, number> = { road: 15, cottage: 5, town: 4 };
export const COSTS: Record<Piece | 'card', Partial<Hand>> = {
  road: { timber: 1, clay: 1 },
  cottage: { timber: 1, clay: 1, wool: 1, grain: 1 },
  town: { grain: 2, stone: 3 },
  card: { wool: 1, grain: 1, stone: 1 },
};
export const TARGET: Record<Difficulty, number> = { easy: 8, medium: 10, hard: 10 };
export const DEADLINE_HOURS = [12, 24, 48] as const;
const COLOURS = ['red', 'blue', 'amber', 'green', 'purple'] as const;
const TRAIL_MIN = 5;
const RANGERS_MIN = 3;
const MAX_OPEN_OFFERS = 3;
const LOG_KEEP = 200;
const LOG_SEND = 50;
/** An async room's finished result stays readable this long. */
export const ASYNC_FINISHED_MS = 72 * 3_600_000;

/** Live timers per decision (ms). */
export const LIVE_MS: Record<Difficulty, { setup: number; roll: number; main: number; discard: number }> = {
  easy: { setup: 90_000, roll: 30_000, main: 180_000, discard: 60_000 },
  medium: { setup: 90_000, roll: 30_000, main: 120_000, discard: 60_000 },
  hard: { setup: 60_000, roll: 20_000, main: 90_000, discard: 45_000 },
};
/** An away player's decisions time out this fast until they move again. */
export const AWAY_MS: Record<Pace, number> = { live: 15_000, async: 3_600_000 };

// ---- The generator ----------------------------------------------------------

/** sfc32 state: four uint32. JSON-safe, kept in the room, never on the wire. */
export type RngState = [number, number, number, number];

/** The next float in [0, 1), advancing the state in place. */
export function nextFloat(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  s[0] = a >>> 0;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return t / 4294967296;
}

/** A seeded state: from a test's number, or 16 random bytes. */
export function seedRng(seed?: unknown): RngState {
  let s: RngState;
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    // splitmix32 spreads a small seed over the four words.
    let x = Math.floor(seed) >>> 0;
    const mix = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    s = [mix(), mix(), mix(), mix()];
  } else {
    const bytes = new Uint32Array(4);
    globalThis.crypto.getRandomValues(bytes);
    s = [bytes[0], bytes[1], bytes[2], bytes[3]];
  }
  // Warm it up: sfc32's first outputs from a near-zero state are poor.
  for (let i = 0; i < 12; i++) nextFloat(s);
  return s;
}

const roller = (room: Room) => () => nextFloat(room.rng);
const randInt = (room: Room, n: number) => Math.floor(nextFloat(room.rng) * n);

// ---- The room -----------------------------------------------------------------

export interface Card {
  kind: CardKind;
  /** The turn it was bought on: it cannot be played that turn. */
  boughtTurn: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Seat index once play starts; null before, or for somebody not at the table. */
  seat: number | null;
  hand: Hand;
  cards: Card[];
  rangersPlayed: number;
  pieces: Record<Piece, number>;
  /** Turns auto-ended in a row; two makes them away. */
  autoEnds: number;
  away: boolean;
}

export interface Offer {
  id: string;
  from: string;
  /** Null = everyone. */
  to: string[] | null;
  give: Partial<Hand>;
  want: Partial<Hand>;
  status: 'open' | 'done' | 'cancelled' | 'void';
  refusedBy: string[];
  /** The offer this counters, or null. */
  counterTo: string | null;
  acceptedBy: string | null;
  at: number;
}

export interface LogEntry {
  n: number;
  at: number;
  kind: string;
  by: string | null;
  text: string;
  /** What a named player sees instead of `text` (a steal's thief and victim). */
  secret: Record<string, string> | null;
  auto: boolean;
}

export interface Result {
  winnerId: string | null;
  reason: 'points' | 'left' | 'abandoned';
}

export interface Room {
  id: string;
  game: 'homestead';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  pace: Pace;
  deadlineHours: number;
  /** What the host asked for. */
  islandChoice: 'auto' | IslandSize;
  /** The island in play (resolved at start); the choice before then. */
  island: 'auto' | IslandSize;
  vpTarget: number;
  board: Board | null;
  fox: string | null;
  /** vertex id → building. */
  buildings: Record<string, { owner: string; piece: 'cottage' | 'town' }>;
  /** edge id → owner. */
  roads: Record<string, string>;
  /** Player ids by seat. */
  seats: string[];
  /** Counts every decision-owning turn, setup placements included. */
  turn: number;
  /** Seat index of the active player. */
  active: number;
  step: Step;
  /** Setup progress: index into the snake (0 … 2n−1). */
  setupIndex: number;
  setupNeed: 'cottage' | 'road';
  setupCottage: string | null;
  /** Where play goes after the fox moves. */
  foxReturn: 'roll' | 'main';
  dice: { a: number; b: number; total: number; by: string; at: number } | null;
  freeRoads: number;
  discardOwed: Record<string, number>;
  bank: Hand;
  deck: CardKind[];
  offers: Offer[];
  nextOffer: number;
  playedCardThisTurn: boolean;
  longestTrailId: string | null;
  chiefRangerId: string | null;
  log: LogEntry[];
  logN: number;
  rng: RngState;
  result: Result | null;
  startedAt: number | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const emptyHand = (): Hand => ({ timber: 0, clay: 0, wool: 0, grain: 0, stone: 0 });
const handCount = (h: Partial<Hand>) => RESOURCES.reduce((n, r) => n + (h[r] ?? 0), 0);

export function player(id: string, name: string, status: PlayerStatus): Player {
  return {
    id,
    name,
    status,
    seat: null,
    hand: emptyHand(),
    cards: [],
    rangersPlayed: 0,
    pieces: { ...PIECES },
    autoEnds: 0,
    away: false,
  };
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}
const byId = (room: Room, id: string) => room.players.find((p) => p.id === id) ?? null;
const nameOf = (room: Room, id: string | null) => (id ? (byId(room, id)?.name ?? 'Someone') : 'Nobody');

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** Seated players still at the table, in seat order. */
function playing(room: Room): Player[] {
  return room.seats.map((id) => byId(room, id)!).filter((p) => p && p.status === 'joined');
}

export function activePlayer(room: Room): Player | null {
  if (room.phase !== 'playing') return null;
  const id = room.seats[room.active];
  return id ? byId(room, id) : null;
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
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  const o = input.options ?? {};
  const pace: Pace = o.pace === 'async' ? 'async' : 'live';
  const deadlineHours = (DEADLINE_HOURS as readonly unknown[]).includes(o.deadlineHours) ? (o.deadlineHours as number) : 24;
  const islandChoice = o.island === 'standard' || o.island === 'large' ? o.island : 'auto';
  const room: Room = {
    id: input.id,
    game: 'homestead',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    pace,
    deadlineHours,
    islandChoice,
    island: islandChoice,
    vpTarget: TARGET[input.difficulty],
    board: null,
    fox: null,
    buildings: {},
    roads: {},
    seats: [],
    turn: 0,
    active: 0,
    step: 'setup',
    setupIndex: 0,
    setupNeed: 'cottage',
    setupCottage: null,
    foxReturn: 'main',
    dice: null,
    freeRoads: 0,
    discardOwed: {},
    bank: emptyHand(),
    deck: [],
    offers: [],
    nextOffer: 1,
    playedCardThisTurn: false,
    longestTrailId: null,
    chiefRangerId: null,
    log: [],
    logN: 0,
    rng: seedRng(o.seed),
    result: null,
    startedAt: null,
    phaseEndsAt: input.now + lobbyMs(pace, deadlineHours),
    createdAt: input.now,
    updatedAt: input.now,
  };
  return room;
}

const lobbyMs = (pace: Pace, hours: number) => (pace === 'async' ? hours * 3_600_000 : LOBBY_MS);
const finishedMs = (room: Room) => (room.pace === 'async' ? ASYNC_FINISHED_MS : FINISHED_MS);

/** The invite banner's line. */
export function about(room: Room): string {
  const island = room.island === 'auto' ? '' : `${room.island === 'large' ? 'Large' : 'Standard'} island · `;
  const pace = room.pace === 'async' ? `over days, ${room.deadlineHours} h a move` : 'play now';
  return `${island}first to ${room.vpTarget} points · ${pace}`;
}

// ---- The log ------------------------------------------------------------------

function log(
  room: Room,
  now: number,
  kind: string,
  by: string | null,
  text: string,
  extra: { secret?: Record<string, string> | null; auto?: boolean } = {},
): void {
  room.logN += 1;
  room.log.push({ n: room.logN, at: now, kind, by, text, secret: extra.secret ?? null, auto: extra.auto ?? false });
  if (room.log.length > LOG_KEEP) room.log.splice(0, room.log.length - LOG_KEEP);
}

const handText = (h: Partial<Hand>) =>
  RESOURCES.filter((r) => (h[r] ?? 0) > 0)
    .map((r) => `${h[r]} ${r}`)
    .join(', ');

// ---- Lobby verbs --------------------------------------------------------------

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

function finish(room: Room, result: Result, now: number): void {
  room.result = result;
  for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
  room.discardOwed = {};
  room.phase = 'finished';
  room.phaseEndsAt = now + finishedMs(room);
  room.updatedAt = now;
  if (result.reason === 'points') {
    log(room, now, 'finish', result.winnerId, `${nameOf(room, result.winnerId)} reached ${totalVp(room, result.winnerId!)} points and won!`);
  } else if (result.reason === 'left') {
    log(room, now, 'finish', result.winnerId, `${nameOf(room, result.winnerId)} is the last one here and wins.`);
  }
}

/**
 * Leaving the lobby as host cancels it. Leaving mid-game: your pieces stay on
 * the island, your resource cards go back to the bank, your offers are
 * cancelled and your turns are skipped. With fewer than two left, the one
 * still here wins.
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
  if (room.phase !== 'playing' || p.seat === null) {
    if (room.phase === 'countdown' && rest.length < MIN_PLAYERS) {
      // Not enough to start: back to the lobby.
      room.phase = 'lobby';
      room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
    }
    return;
  }
  for (const r of RESOURCES) {
    room.bank[r] += p.hand[r];
    p.hand[r] = 0;
  }
  p.cards = [];
  delete room.discardOwed[p.id];
  for (const o of room.offers) {
    if (o.status !== 'open') continue;
    if (o.from === p.id || (o.to && o.to.length === 1 && o.to[0] === p.id)) o.status = 'cancelled';
  }
  log(room, now, 'leave', p.id, `${p.name} left the game.`);
  const left = playing(room);
  if (left.length < 2) {
    finish(room, { winnerId: left[0]?.id ?? null, reason: 'left' }, now);
    return;
  }
  // Awards held by somebody who has gone are re-judged without them.
  refreshAwards(room, now);
  const wasActive = room.seats[room.active] === p.id;
  // An award handed over by the leaver can carry the active player to the target on their own turn.
  if (!wasActive && checkWin(room, now)) return;
  if (room.step === 'discard' && !Object.keys(room.discardOwed).length && !wasActive) {
    toStep(room, 'fox', now);
  }
  if (wasActive) {
    if (room.step === 'setup') nextSetup(room, now);
    else nextTurn(room, now);
  }
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < MIN_PLAYERS) throw new GameError(409, 'Homestead needs three players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here — a new island, a new seat order; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    const fresh = player(p.id, p.name, p.status === 'joined' ? 'joined' : 'invited');
    Object.assign(p, fresh);
  }
  room.phase = 'lobby';
  room.island = room.islandChoice;
  room.board = null;
  room.fox = null;
  room.buildings = {};
  room.roads = {};
  room.seats = [];
  room.turn = 0;
  room.active = 0;
  room.step = 'setup';
  room.setupIndex = 0;
  room.setupNeed = 'cottage';
  room.setupCottage = null;
  room.dice = null;
  room.freeRoads = 0;
  room.discardOwed = {};
  room.bank = emptyHand();
  room.deck = [];
  room.offers = [];
  room.playedCardThisTurn = false;
  room.longestTrailId = null;
  room.chiefRangerId = null;
  room.log = [];
  room.result = null;
  room.startedAt = null;
  room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Starting play --------------------------------------------------------------

function begin(room: Room, now: number): void {
  const seated = shuffle(joined(room).map((p) => p.id), roller(room));
  const size: IslandSize = room.islandChoice === 'auto' ? (seated.length >= 5 ? 'large' : 'standard') : room.islandChoice;
  const spec = ISLAND[size];
  const board = generateIsland(size, roller(room));
  room.board = { size, hexes: board.hexes, harbours: board.harbours };
  room.island = size;
  room.fox = board.hexes.find((h) => h.kind === 'dunes')?.id ?? board.hexes[0].id;
  room.seats = seated;
  for (const p of room.players) {
    Object.assign(p, { ...player(p.id, p.name, p.status), seat: seated.indexOf(p.id) >= 0 ? seated.indexOf(p.id) : null });
  }
  room.bank = { timber: spec.bank, clay: spec.bank, wool: spec.bank, grain: spec.bank, stone: spec.bank };
  room.deck = shuffle(
    (Object.entries(spec.deck) as [CardKind, number][]).flatMap(([k, n]) => Array<CardKind>(n).fill(k)),
    roller(room),
  );
  room.buildings = {};
  room.roads = {};
  room.offers = [];
  room.discardOwed = {};
  room.dice = null;
  room.longestTrailId = null;
  room.chiefRangerId = null;
  room.result = null;
  room.phase = 'playing';
  room.startedAt = now;
  room.setupIndex = -1;
  room.turn = 0;
  log(room, now, 'turn', null, `The island is ready. ${seated.map((id) => nameOf(room, id)).join(', ')} — in that order.`);
  nextSetup(room, now);
}

/** The setup snake's seat for placement `k`: 0…n−1, then n−1…0. */
function setupSeat(n: number, k: number): number {
  return k < n ? k : 2 * n - 1 - k;
}

/** Move on to the next setup placement, skipping anyone who left; after the last, seat 0 rolls. */
function nextSetup(room: Room, now: number): void {
  const n = room.seats.length;
  for (let k = room.setupIndex + 1; k < 2 * n; k++) {
    const seat = setupSeat(n, k);
    if (byId(room, room.seats[seat])?.status !== 'joined') continue;
    room.setupIndex = k;
    room.active = seat;
    room.turn += 1;
    room.setupNeed = 'cottage';
    room.setupCottage = null;
    toStep(room, 'setup', now);
    return;
  }
  // Setup done: the first seat still here takes the first real turn.
  room.setupCottage = null;
  room.active = n - 1;
  nextTurn(room, now, true);
}

// ---- Clock ------------------------------------------------------------------------

/** How long the current decision may take. */
export function decisionMs(room: Room, step: Step): number {
  const waiting = waitingIds(room, step);
  const away = waiting.length > 0 && waiting.every((id) => byId(room, id)?.away);
  if (away) return AWAY_MS[room.pace];
  if (room.pace === 'async') return room.deadlineHours * 3_600_000;
  const t = LIVE_MS[room.difficulty];
  switch (step) {
    case 'setup':
      return t.setup;
    case 'roll':
      return t.roll;
    case 'discard':
    case 'fox':
      return t.discard;
    case 'main':
    case 'roads':
      return t.main;
  }
}

function toStep(room: Room, step: Step, now: number): void {
  room.step = step;
  room.phaseEndsAt = now + decisionMs(room, step);
  room.updatedAt = now;
}

function waitingIds(room: Room, step: Step = room.step): string[] {
  if (room.phase !== 'playing') return [];
  if (step === 'discard') return Object.keys(room.discardOwed);
  const id = room.seats[room.active];
  return id ? [id] : [];
}

/** Pass to the next seat still here; their turn starts at `roll` (and they may already have won). */
function nextTurn(room: Room, now: number, first = false): void {
  for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
  room.offers = [];
  room.freeRoads = 0;
  room.discardOwed = {};
  room.playedCardThisTurn = false;
  const n = room.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = (room.active + i) % n;
    if (byId(room, room.seats[seat])?.status !== 'joined') continue;
    room.active = seat;
    break;
  }
  room.turn += 1;
  const p = activePlayer(room)!;
  log(room, now, 'turn', p.id, first ? `Setup done. ${p.name} rolls first.` : `${p.name}'s turn.`);
  toStep(room, 'roll', now);
  // Reaching the target off-turn (open building) wins at the start of your own turn.
  checkWin(room, now);
}

// ---- Board queries -------------------------------------------------------------

function geo(room: Room) {
  return geometry(room.board!.size);
}

function hexById(room: Room, id: string): Hex | null {
  return room.board?.hexes.find((h) => h.id === id) ?? null;
}

/** Cottage spots for `p` now: the distance rule, plus a road of theirs unless in setup. */
export function cottageSpots(room: Room, p: Player, setup = false): string[] {
  if (!room.board) return [];
  const g = geo(room);
  return g.vertices.filter((v) => {
    if (room.buildings[v]) return false;
    if (g.vertexBoardNeighbours.get(v)!.some((n) => room.buildings[n])) return false;
    if (setup) return true;
    return g.vertexBoardEdges.get(v)!.some((e) => room.roads[e] === p.id);
  });
}

/** Road spots for `p` now (not in setup). */
export function roadSpots(room: Room, p: Player): string[] {
  if (!room.board) return [];
  const g = geo(room);
  return g.edges.filter((e) => {
    if (room.roads[e]) return false;
    return edgeEnds(e).some((v) => {
      if (!g.vertexSet.has(v)) return false;
      const b = room.buildings[v];
      if (b?.owner === p.id) return true;
      if (b) return false; // Another player's building blocks the way through.
      return g.vertexBoardEdges.get(v)!.some((x) => x !== e && room.roads[x] === p.id);
    });
  });
}

function setupRoadSpots(room: Room): string[] {
  if (!room.board || !room.setupCottage) return [];
  return geo(room).vertexBoardEdges.get(room.setupCottage)!.filter((e) => !room.roads[e]);
}

function townSpots(room: Room, p: Player): string[] {
  return Object.entries(room.buildings)
    .filter(([, b]) => b.owner === p.id && b.piece === 'cottage')
    .map(([v]) => v)
    .sort();
}

/** Pip total of a corner's land hexes. */
function vertexPips(room: Room, v: string): number {
  return geo(room)
    .vertexLand.get(v)!
    .reduce((n, h) => n + (hexById(room, h)?.pips ?? 0), 0);
}

/** Trade rates for each resource: 2 with its harbour, 3 with an `any`, else 4. */
export function rates(room: Room, playerId: string): Hand {
  const out: Hand = { timber: 4, clay: 4, wool: 4, grain: 4, stone: 4 };
  if (!room.board) return out;
  const mine = (h: Harbour) => edgeEnds(h.edge).some((v) => room.buildings[v]?.owner === playerId);
  for (const h of room.board.harbours) {
    if (!mine(h)) continue;
    if (h.kind === 'any') for (const r of RESOURCES) out[r] = Math.min(out[r], 3);
    else out[h.kind] = 2;
  }
  return out;
}

// ---- Points and awards ----------------------------------------------------------

/** The longest run of `id`'s roads, no edge twice, never through another player's building. */
export function trailLength(room: Room, id: string): number {
  if (!room.board) return 0;
  const g = geo(room);
  const mine = Object.keys(room.roads).filter((e) => room.roads[e] === id);
  if (!mine.length) return 0;
  const blocked = (v: string) => !!room.buildings[v] && room.buildings[v].owner !== id;
  const used = new Set<string>();
  const walk = (v: string): number => {
    if (blocked(v)) return 0;
    let best = 0;
    for (const e of g.vertexBoardEdges.get(v)!) {
      if (room.roads[e] !== id || used.has(e)) continue;
      const [a, b] = edgeEnds(e);
      used.add(e);
      best = Math.max(best, 1 + walk(a === v ? b : a));
      used.delete(e);
    }
    return best;
  };
  let best = 0;
  for (const e of mine) {
    // Walk out from every road, both ways: a trail's end road is one of these
    // starts, and the corner behind it may be blocked without breaking it.
    for (const to of edgeEnds(e)) {
      used.add(e);
      best = Math.max(best, 1 + walk(to));
      used.delete(e);
    }
  }
  return best;
}

function heirlooms(p: Player): number {
  return p.cards.filter((c) => c.kind === 'heirloom').length;
}

export function publicVp(room: Room, id: string): number {
  let vp = 0;
  for (const b of Object.values(room.buildings)) if (b.owner === id) vp += b.piece === 'town' ? 2 : 1;
  if (room.longestTrailId === id) vp += 2;
  if (room.chiefRangerId === id) vp += 2;
  return vp;
}

export function totalVp(room: Room, id: string): number {
  const p = byId(room, id);
  return publicVp(room, id) + (p ? heirlooms(p) : 0);
}

/** Re-judge Longest Trail (and drop awards held by somebody who left). */
function refreshAwards(room: Room, now: number): void {
  const eligible = playing(room);
  const lengths = new Map(eligible.map((p) => [p.id, trailLength(room, p.id)]));
  const best = Math.max(0, ...lengths.values());
  let holder = room.longestTrailId;
  if (holder && !lengths.has(holder)) holder = null;
  const leaders = [...lengths.entries()].filter(([, n]) => n === best && n >= TRAIL_MIN).map(([id]) => id);
  let next: string | null;
  if (holder && (lengths.get(holder) ?? 0) >= TRAIL_MIN && lengths.get(holder) === best) next = holder;
  else next = leaders.length === 1 ? leaders[0] : null;
  if (next !== room.longestTrailId) {
    room.longestTrailId = next;
    log(
      room,
      now,
      'award',
      next,
      next ? `${nameOf(room, next)} has the Longest Trail (${best}).` : 'Nobody holds the Longest Trail now.',
    );
  }
  if (room.chiefRangerId && !eligible.some((p) => p.id === room.chiefRangerId)) {
    room.chiefRangerId = null;
    const top = Math.max(0, ...eligible.map((p) => p.rangersPlayed));
    const tops = eligible.filter((p) => p.rangersPlayed === top && top >= RANGERS_MIN);
    if (tops.length === 1) room.chiefRangerId = tops[0].id;
    log(room, now, 'award', room.chiefRangerId, room.chiefRangerId ? `${nameOf(room, room.chiefRangerId)} is Chief Ranger.` : 'Nobody is Chief Ranger now.');
  }
}

/** The active player wins the moment their total reaches the target on their own turn. */
function checkWin(room: Room, now: number): boolean {
  if (room.phase !== 'playing' || room.step === 'setup') return false;
  const p = activePlayer(room);
  if (!p || totalVp(room, p.id) < room.vpTarget) return false;
  finish(room, { winnerId: p.id, reason: 'points' }, now);
  return true;
}

// ---- Hands and the bank -----------------------------------------------------------

function covers(hand: Hand, cost: Partial<Hand>): boolean {
  return RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
}

function pay(room: Room, p: Player, cost: Partial<Hand>): void {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    p.hand[r] -= n;
    room.bank[r] += n;
  }
}

/** Offers whose proposer can no longer cover them become void. */
function voidUncovered(room: Room): void {
  for (const o of room.offers) {
    if (o.status !== 'open') continue;
    const from = byId(room, o.from);
    if (!from || !covers(from.hand, o.give)) o.status = 'void';
  }
}

/** Parse `{ timber: 2, … }`: whole positive counts of real resources, at least one. */
function parseCards(v: unknown, what: string): Partial<Hand> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new GameError(400, `Say which cards to ${what}.`);
  const out: Partial<Hand> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (!isResource(k)) throw new GameError(400, `${k} is not a resource.`);
    if (n === 0) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 99) throw new GameError(400, 'Card counts are whole numbers.');
    out[k] = n;
  }
  if (!handCount(out)) throw new GameError(400, `Say which cards to ${what}.`);
  return out;
}

// ---- Moves: shared checks -----------------------------------------------------------

function assertPlaying(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (room.phase !== 'playing') {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  }
  if (p.status !== 'joined' || p.seat === null) throw new GameError(403, 'You are not playing this game.');
  return p;
}

function assertActive(room: Room, playerId: string, steps: Step[]): Player {
  const p = assertPlaying(room, playerId);
  if (room.seats[room.active] !== p.id) throw new GameError(409, "It's not your turn.");
  if (!steps.includes(room.step)) throw new GameError(409, stepRefusal(room));
  return p;
}

function stepRefusal(room: Room): string {
  switch (room.step) {
    case 'setup':
      return `Place your ${room.setupNeed} first.`;
    case 'roll':
      return 'Roll the dice first.';
    case 'discard':
      return 'Waiting for discards.';
    case 'fox':
      return 'Move the fox first.';
    case 'roads':
      return 'Place your free roads first.';
    default:
      return 'Not now.';
  }
}

/** A player moving for themselves is not away any more. */
function present(room: Room, p: Player, now: number): void {
  p.autoEnds = 0;
  if (!p.away) return;
  p.away = false;
  log(room, now, 'away', p.id, `${p.name} is back.`);
  // Their running decision gets its full time again.
  if (waitingIds(room).includes(p.id)) room.phaseEndsAt = now + decisionMs(room, room.step);
}

/** Five seated: anyone may build or buy during another player's main step. */
function openBuilding(room: Room): boolean {
  return room.seats.length >= 5;
}

// ---- Moves --------------------------------------------------------------------------

/** Roll the two dice on your turn. */
export function roll(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['roll']);
  if (!auto) present(room, p, now);
  const a = 1 + randInt(room, 6);
  const b = 1 + randInt(room, 6);
  const total = a + b;
  room.dice = { a, b, total, by: p.id, at: now };
  log(room, now, 'roll', p.id, `${p.name} rolled ${total}.`, { auto });
  if (total === 7) {
    for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
    room.discardOwed = {};
    for (const q of playing(room)) {
      const n = handCount(q.hand);
      if (n > 7) room.discardOwed[q.id] = Math.floor(n / 2);
    }
    room.foxReturn = 'main';
    const owing = Object.keys(room.discardOwed);
    if (owing.length) {
      log(room, now, 'discard', null, `${owing.map((id) => `${nameOf(room, id)} discards ${room.discardOwed[id]}`).join(', ')}.`);
      toStep(room, 'discard', now);
    } else toStep(room, 'fox', now);
    return;
  }
  produce(room, total, now);
  toStep(room, 'main', now);
}

/** Every hex with this number and no fox pays its cottages 1 and towns 2 — if the bank can. */
function produce(room: Room, total: number, now: number): void {
  const g = geo(room);
  const owed: Record<Resource, Record<string, number>> = { timber: {}, clay: {}, wool: {}, grain: {}, stone: {} };
  for (const h of room.board!.hexes) {
    if (h.token !== total || h.id === room.fox || !h.resource) continue;
    for (const v of hexCorners(h.q, h.r)) {
      const b = room.buildings[v];
      if (!b || !g.vertexSet.has(v)) continue;
      if (byId(room, b.owner)?.status !== 'joined') continue;
      owed[h.resource][b.owner] = (owed[h.resource][b.owner] ?? 0) + (b.piece === 'town' ? 2 : 1);
    }
  }
  const got: Record<string, Partial<Hand>> = {};
  const short: Resource[] = [];
  for (const r of RESOURCES) {
    const who = Object.entries(owed[r]);
    if (!who.length) continue;
    const sum = who.reduce((n, [, k]) => n + k, 0);
    if (sum > room.bank[r] && who.length > 1) {
      short.push(r);
      continue;
    }
    for (const [id, k] of who) {
      const n = Math.min(k, room.bank[r]);
      if (!n) continue;
      room.bank[r] -= n;
      byId(room, id)!.hand[r] += n;
      (got[id] ??= {})[r] = n;
    }
  }
  const parts = room.seats
    .filter((id) => got[id])
    .map((id) => `${nameOf(room, id)} +${RESOURCES.filter((r) => got[id][r]).map((r) => `${got[id][r]} ${r}`).join(', +')}`);
  let text = parts.length ? `${total}: ${parts.join('; ')}.` : `${total}: nothing this time.`;
  if (short.length) text += ` The bank is short of ${short.join(' and ')}: nobody gets it.`;
  log(room, now, 'produce', null, text);
  voidUncovered(room);
}

/** Put the cards owed on a 7 back in the bank: `{ cards: { timber: 2, … } }`. */
export function discard(room: Room, playerId: string, input: { cards: unknown }, now: number, auto = false): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'discard') throw new GameError(409, 'Nothing to discard now.');
  const owed = room.discardOwed[p.id];
  if (!owed) throw new GameError(409, "You don't owe a discard.");
  const cards = parseCards(input.cards, 'discard');
  if (handCount(cards) !== owed) throw new GameError(400, `Discard exactly ${owed} card${owed === 1 ? '' : 's'}.`);
  if (!covers(p.hand, cards)) throw new GameError(400, "You don't have those cards.");
  if (!auto) present(room, p, now);
  pay(room, p, cards);
  delete room.discardOwed[p.id];
  log(room, now, 'discard', p.id, `${p.name} discarded ${handText(cards)}.`, { auto });
  voidUncovered(room);
  if (!Object.keys(room.discardOwed).length) toStep(room, 'fox', now);
}

/** Hexes the fox may go to now (the friendly fox on easy spares small players). */
export function foxHexes(room: Room, moverId: string): string[] {
  if (!room.board) return [];
  const g = geo(room);
  const candidates = room.board.hexes.filter((h) => h.id !== room.fox);
  if (room.difficulty !== 'easy') return candidates.map((h) => h.id);
  const protectedOwner = (owner: string) => owner !== moverId && publicVp(room, owner) <= 2;
  const touchesProtected = (h: Hex) =>
    hexCorners(h.q, h.r).some((v) => g.vertexSet.has(v) && room.buildings[v] && protectedOwner(room.buildings[v].owner));
  let ok = candidates.filter((h) => !touchesProtected(h));
  if (!ok.length) ok = candidates.filter((h) => h.kind === 'dunes');
  if (!ok.length) ok = candidates;
  return ok.map((h) => h.id);
}

/** Players the fox could take from on this hex. */
export function victimsAt(room: Room, moverId: string, hexIdValue: string): string[] {
  const h = hexById(room, hexIdValue);
  if (!h) return [];
  const g = geo(room);
  const out = new Set<string>();
  for (const v of hexCorners(h.q, h.r)) {
    const b = g.vertexSet.has(v) ? room.buildings[v] : undefined;
    if (!b || b.owner === moverId) continue;
    const q = byId(room, b.owner);
    if (q?.status === 'joined' && handCount(q.hand) > 0) out.add(q.id);
  }
  return room.seats.filter((id) => out.has(id));
}

/** Move the fox: `{ hex, victim? }`. A victim is needed when two or more could be robbed. */
export function fox(room: Room, playerId: string, input: { hex: unknown; victim?: unknown }, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['fox']);
  const at = parseHex(input.hex);
  const id = typeof input.hex === 'string' ? input.hex : '';
  if (!at || !hexById(room, id)) throw new GameError(400, "That's not a spot on the board.");
  if (id === room.fox) throw new GameError(400, 'The fox has to move to a different field.');
  if (!foxHexes(room, p.id).includes(id)) throw new GameError(400, 'The friendly fox leaves smaller farms alone: pick another field.');
  const eligible = victimsAt(room, p.id, id);
  let victim: string | null = null;
  if (eligible.length === 1) {
    if (input.victim != null && input.victim !== eligible[0]) throw new GameError(400, 'The fox can only take from someone with a cottage or town on that field.');
    victim = eligible[0];
  } else if (eligible.length > 1) {
    if (typeof input.victim !== 'string' || !eligible.includes(input.victim)) {
      throw new GameError(400, input.victim == null ? 'Pick who the fox takes from.' : 'The fox can only take from someone with a cottage or town on that field.');
    }
    victim = input.victim;
  } else if (input.victim != null) {
    throw new GameError(400, 'Nobody on that field has a card to take.');
  }
  if (!auto) present(room, p, now);
  room.fox = id;
  const h = hexById(room, id)!;
  log(room, now, 'fox', p.id, `${p.name} moved the fox to the ${h.kind === 'dunes' ? 'dunes' : `${h.resource} ${h.token}`}.`, { auto });
  if (victim) {
    const v = byId(room, victim)!;
    const pool = RESOURCES.flatMap((r) => Array<Resource>(v.hand[r]).fill(r));
    const took = pool[randInt(room, pool.length)];
    v.hand[took] -= 1;
    p.hand[took] += 1;
    log(room, now, 'steal', p.id, `${p.name}'s fox took a card from ${v.name}.`, {
      secret: {
        [p.id]: `Your fox took a ${took} from ${v.name}.`,
        [v.id]: `${p.name}'s fox took a ${took} from you.`,
      },
      auto,
    });
    voidUncovered(room);
  }
  toStep(room, room.foxReturn, now);
}

/**
 * Build `{ piece: road | cottage | town, at: id }`. In setup it is free and
 * placed where the setup says; otherwise it costs and must connect.
 */
export function build(room: Room, playerId: string, input: { piece: unknown; at: unknown }, now: number, auto = false): void {
  const p = assertPlaying(room, playerId);
  const piece = input.piece;
  if (piece !== 'road' && piece !== 'cottage' && piece !== 'town') throw new GameError(400, 'Build a road, a cottage or a town.');
  const isActive = room.seats[room.active] === p.id;
  const g = geo(room);
  const at = typeof input.at === 'string' ? input.at : '';
  const onBoard = piece === 'road' ? !!parseEdge(at) && g.edgeSet.has(at) : !!parseVertex(at) && g.vertexSet.has(at);

  if (room.step === 'setup') {
    if (!isActive) throw new GameError(409, "It's not your turn.");
    if (piece !== room.setupNeed) throw new GameError(409, `Place your ${room.setupNeed} first.`);
    if (!onBoard) throw new GameError(400, "That's not a spot on the board.");
    if (!auto) present(room, p, now);
    if (piece === 'cottage') {
      if (room.buildings[at]) throw new GameError(409, 'Someone just built there.');
      if (!cottageSpots(room, p, true).includes(at)) throw new GameError(400, 'Too close to another cottage: leave a gap of one road.');
      room.buildings[at] = { owner: p.id, piece: 'cottage' };
      p.pieces.cottage -= 1;
      room.setupCottage = at;
      room.setupNeed = 'road';
      const second = room.setupIndex >= room.seats.length;
      let text = `${p.name} placed a cottage.`;
      if (second) {
        const got: Partial<Hand> = {};
        for (const hid of g.vertexLand.get(at)!) {
          const r = hexById(room, hid)?.resource;
          if (r && room.bank[r] > 0) {
            room.bank[r] -= 1;
            p.hand[r] += 1;
            got[r] = (got[r] ?? 0) + 1;
          }
        }
        if (handCount(got)) text = `${p.name} placed a cottage and took ${handText(got)}.`;
      }
      log(room, now, 'setup', p.id, text, { auto });
      room.phaseEndsAt = now + decisionMs(room, 'setup');
      room.updatedAt = now;
      return;
    }
    if (room.roads[at]) throw new GameError(409, 'Someone just built there.');
    if (!setupRoadSpots(room).includes(at)) throw new GameError(400, 'Your road must touch the cottage you just placed.');
    room.roads[at] = p.id;
    p.pieces.road -= 1;
    log(room, now, 'setup', p.id, `${p.name} placed a road.`, { auto });
    nextSetup(room, now);
    return;
  }

  const free = room.step === 'roads' && isActive && piece === 'road';
  if (room.step === 'roads' && isActive && piece !== 'road') throw new GameError(409, stepRefusal(room));
  if (!free) {
    if (room.step !== 'main') throw new GameError(409, isActive ? stepRefusal(room) : "It's not your turn.");
    if (!isActive && !openBuilding(room)) throw new GameError(409, "It's not your turn.");
  }
  if (!onBoard) throw new GameError(400, "That's not a spot on the board.");
  if (p.pieces[piece] <= 0) throw new GameError(409, `You have no ${piece}s left.`);
  if (!free && !covers(p.hand, COSTS[piece])) throw new GameError(409, `You can't afford a ${piece}.`);

  if (piece === 'road') {
    if (room.roads[at]) throw new GameError(409, 'Someone just built there.');
    if (!roadSpots(room, p).includes(at)) throw new GameError(400, 'Roads must join your own roads, cottages or towns.');
  } else if (piece === 'cottage') {
    if (room.buildings[at]) throw new GameError(409, 'Someone just built there.');
    if (g.vertexBoardNeighbours.get(at)!.some((n) => room.buildings[n])) {
      throw new GameError(400, 'Too close to another cottage: leave a gap of one road.');
    }
    if (!g.vertexBoardEdges.get(at)!.some((e) => room.roads[e] === p.id)) throw new GameError(400, 'You need a road next to it.');
  } else {
    const b = room.buildings[at];
    if (!b || b.owner !== p.id || b.piece !== 'cottage') throw new GameError(400, 'A town replaces one of your own cottages.');
  }

  if (!auto) present(room, p, now);
  if (!free) pay(room, p, COSTS[piece]);
  if (piece === 'road') {
    room.roads[at] = p.id;
    p.pieces.road -= 1;
  } else if (piece === 'cottage') {
    room.buildings[at] = { owner: p.id, piece: 'cottage' };
    p.pieces.cottage -= 1;
  } else {
    room.buildings[at] = { owner: p.id, piece: 'town' };
    p.pieces.town -= 1;
    p.pieces.cottage += 1;
  }
  log(room, now, 'build', p.id, `${p.name} built a ${free ? 'free ' : ''}${piece}.`, { auto });
  room.updatedAt = now;
  voidUncovered(room);
  refreshAwards(room, now);
  if (free) {
    room.freeRoads -= 1;
    if (room.freeRoads <= 0 || p.pieces.road <= 0 || !roadSpots(room, p).length) {
      room.freeRoads = 0;
      toStep(room, 'main', now);
    }
  }
  checkWin(room, now);
}

/** Buy the top almanac card. */
export function buy(room: Room, playerId: string, now: number): void {
  const p = assertPlaying(room, playerId);
  const isActive = room.seats[room.active] === p.id;
  if (room.step !== 'main') throw new GameError(409, isActive ? stepRefusal(room) : "It's not your turn.");
  if (!isActive && !openBuilding(room)) throw new GameError(409, "It's not your turn.");
  if (!room.deck.length) throw new GameError(409, 'The almanac deck is empty.');
  if (!covers(p.hand, COSTS.card)) throw new GameError(409, "You can't afford an almanac card.");
  present(room, p, now);
  pay(room, p, COSTS.card);
  const kind = room.deck.pop()!;
  p.cards.push({ kind, boughtTurn: room.turn });
  log(room, now, 'buy', p.id, `${p.name} bought an almanac card.`);
  room.updatedAt = now;
  voidUncovered(room);
  checkWin(room, now);
}

/** Play an almanac card: `{ card, take?: [r, r], resource?: r }`. */
export function play(room: Room, playerId: string, input: { card: unknown; take?: unknown; resource?: unknown }, now: number): void {
  const card = input.card;
  if (!isCardKind(card)) throw new GameError(400, 'Pick an almanac card to play.');
  if (card === 'heirloom') throw new GameError(400, 'Heirlooms are kept, not played: they count at the end.');
  const p = assertActive(room, playerId, card === 'ranger' ? ['roll', 'main'] : ['main']);
  if (room.playedCardThisTurn) throw new GameError(409, 'You have already played an almanac card this turn.');
  const held = p.cards.filter((c) => c.kind === card);
  if (!held.length) throw new GameError(409, `You don't have a ${card} card.`);
  const ready = held.find((c) => c.boughtTurn !== room.turn);
  if (!ready) throw new GameError(409, 'A card bought this turn can be played from your next turn.');

  let take: Resource[] = [];
  let named: Resource | null = null;
  if (card === 'harvest') {
    if (!Array.isArray(input.take) || input.take.length !== 2 || !input.take.every(isResource)) {
      throw new GameError(400, 'Pick two resources to take.');
    }
    take = input.take as Resource[];
    const need: Partial<Hand> = {};
    for (const r of take) need[r] = (need[r] ?? 0) + 1;
    if (!covers(room.bank, need)) throw new GameError(409, "The bank doesn't have those.");
  }
  if (card === 'market') {
    if (!isResource(input.resource)) throw new GameError(400, 'Name a resource.');
    named = input.resource;
  }

  present(room, p, now);
  p.cards.splice(p.cards.indexOf(ready), 1);
  room.playedCardThisTurn = true;
  room.updatedAt = now;
  switch (card) {
    case 'ranger': {
      p.rangersPlayed += 1;
      log(room, now, 'play', p.id, `${p.name} played a ranger.`);
      const holder = room.chiefRangerId ? byId(room, room.chiefRangerId) : null;
      if (p.rangersPlayed >= RANGERS_MIN && room.chiefRangerId !== p.id && (!holder || p.rangersPlayed > holder.rangersPlayed)) {
        room.chiefRangerId = p.id;
        log(room, now, 'award', p.id, `${p.name} is Chief Ranger.`);
      }
      room.foxReturn = room.step === 'roll' ? 'roll' : 'main';
      toStep(room, 'fox', now);
      break;
    }
    case 'pathfinders': {
      log(room, now, 'play', p.id, `${p.name} played pathfinders.`);
      room.freeRoads = Math.min(2, p.pieces.road);
      if (room.freeRoads > 0 && roadSpots(room, p).length) toStep(room, 'roads', now);
      else room.freeRoads = 0;
      break;
    }
    case 'harvest': {
      for (const r of take) {
        room.bank[r] -= 1;
        p.hand[r] += 1;
      }
      log(room, now, 'play', p.id, `${p.name} played a harvest and took ${take[0]} and ${take[1]}.`);
      break;
    }
    case 'market': {
      const r = named!;
      const parts: string[] = [];
      let total = 0;
      for (const q of playing(room)) {
        if (q.id === p.id || !q.hand[r]) continue;
        parts.push(`${q.hand[r]} from ${q.name}`);
        total += q.hand[r];
        p.hand[r] += q.hand[r];
        q.hand[r] = 0;
      }
      log(room, now, 'play', p.id, `${p.name} played a market for ${r}: ${total ? parts.join(', ') : 'nobody had any'}.`);
      voidUncovered(room);
      break;
    }
  }
  checkWin(room, now);
}

/** Trade with the bank: `rate` of `give` for one `get`. */
export function bank(room: Room, playerId: string, input: { give: unknown; get: unknown }, now: number): void {
  const p = assertActive(room, playerId, ['main']);
  if (!isResource(input.give) || !isResource(input.get)) throw new GameError(400, 'Pick a resource to give and one to get.');
  if (input.give === input.get) throw new GameError(400, 'Pick a different resource to get.');
  const rate = rates(room, p.id)[input.give];
  if (p.hand[input.give] < rate) throw new GameError(409, `You need ${rate} ${input.give} to trade.`);
  if (room.bank[input.get] < 1) throw new GameError(409, `The bank has no ${input.get} left.`);
  present(room, p, now);
  p.hand[input.give] -= rate;
  room.bank[input.give] += rate;
  room.bank[input.get] -= 1;
  p.hand[input.get] += 1;
  log(room, now, 'bank', p.id, `${p.name} traded ${rate} ${input.give} with the bank for 1 ${input.get}.`);
  room.updatedAt = now;
  voidUncovered(room);
}

function parseTrade(give: unknown, want: unknown): { give: Partial<Hand>; want: Partial<Hand> } {
  const g = parseCards(give, 'give');
  const w = parseCards(want, 'ask for');
  if (RESOURCES.some((r) => g[r] && w[r])) throw new GameError(400, "Don't put the same resource on both sides.");
  return { give: g, want: w };
}

function openOffer(room: Room, id: unknown): Offer {
  const o = room.offers.find((x) => x.id === id);
  if (!o || o.status !== 'open') throw new GameError(409, 'That offer has gone.');
  return o;
}

const isRecipient = (o: Offer, id: string) => o.from !== id && (o.to === null || o.to.includes(id));

/** The active player offers a trade to everyone or to named players. */
export function offer(room: Room, playerId: string, input: { give: unknown; want: unknown; to?: unknown }, now: number): void {
  const p = assertActive(room, playerId, ['main']);
  const { give, want } = parseTrade(input.give, input.want);
  let to: string[] | null = null;
  if (input.to != null) {
    if (!Array.isArray(input.to)) throw new GameError(400, 'Say who the offer is for.');
    const others = playing(room).filter((q) => q.id !== p.id).map((q) => q.id);
    const ids = [...new Set(input.to)];
    if (!ids.every((x): x is string => typeof x === 'string' && others.includes(x))) {
      throw new GameError(400, 'You can only offer to players in this game.');
    }
    to = ids.length ? ids : null;
  }
  if (!covers(p.hand, give)) throw new GameError(409, "You don't have those cards.");
  if (room.offers.filter((o) => o.status === 'open' && o.from === p.id).length >= MAX_OPEN_OFFERS) {
    throw new GameError(409, `You can have ${MAX_OPEN_OFFERS} offers open at once.`);
  }
  present(room, p, now);
  const o: Offer = { id: `o${room.nextOffer++}`, from: p.id, to, give, want, status: 'open', refusedBy: [], counterTo: null, acceptedBy: null, at: now };
  room.offers.push(o);
  log(room, now, 'offer', p.id, `${p.name} offers ${handText(give)} for ${handText(want)}${to ? ` to ${to.map((id) => nameOf(room, id)).join(' and ')}` : ''}.`);
  room.updatedAt = now;
}

/** A recipient answers the active player's offer with their own terms. */
export function counter(room: Room, playerId: string, input: { offerId: unknown; give: unknown; want: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'main') throw new GameError(409, 'Trading happens in the main part of a turn.');
  const active = room.seats[room.active];
  const o = openOffer(room, input.offerId);
  if (o.from !== active || !isRecipient(o, p.id)) throw new GameError(409, 'You can only counter an offer made to you.');
  const { give, want } = parseTrade(input.give, input.want);
  if (!covers(p.hand, give)) throw new GameError(409, "You don't have those cards.");
  if (room.offers.some((x) => x.status === 'open' && x.from === p.id && x.counterTo === o.id)) {
    throw new GameError(409, 'You already have a counter-offer open on that one.');
  }
  present(room, p, now);
  room.offers.push({ id: `o${room.nextOffer++}`, from: p.id, to: [active], give, want, status: 'open', refusedBy: [], counterTo: o.id, acceptedBy: null, at: now });
  log(room, now, 'offer', p.id, `${p.name} counters: ${handText(give)} for ${handText(want)}.`);
  room.updatedAt = now;
}

/** Take an offer: the trade happens at once. */
export function accept(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'main') throw new GameError(409, 'Trading happens in the main part of a turn.');
  const o = openOffer(room, input.offerId);
  const active = room.seats[room.active];
  // Every trade has the active player on one side.
  if (!isRecipient(o, p.id) || (o.from !== active && p.id !== active)) throw new GameError(409, "That offer isn't for you.");
  const from = byId(room, o.from)!;
  if (from.status !== 'joined' || !covers(from.hand, o.give)) throw new GameError(409, `${from.name} no longer has those cards.`);
  if (!covers(p.hand, o.want)) throw new GameError(409, "You don't have the cards they want.");
  present(room, p, now);
  for (const r of RESOURCES) {
    const g = o.give[r] ?? 0;
    const w = o.want[r] ?? 0;
    from.hand[r] += w - g;
    p.hand[r] += g - w;
  }
  o.status = 'done';
  o.acceptedBy = p.id;
  log(room, now, 'trade', p.id, `${from.name} traded ${handText(o.give)} to ${p.name} for ${handText(o.want)}.`);
  room.updatedAt = now;
  voidUncovered(room);
}

/** A recipient says no to an offer. */
export function refuse(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  const o = openOffer(room, input.offerId);
  if (!isRecipient(o, p.id)) throw new GameError(409, "That offer isn't for you.");
  present(room, p, now);
  if (!o.refusedBy.includes(p.id)) o.refusedBy.push(p.id);
  // An offer to named players that all of them refused is over.
  if (o.to && o.to.every((id) => o.refusedBy.includes(id))) o.status = 'cancelled';
  room.updatedAt = now;
}

/** The proposer withdraws an offer. */
export function cancel(room: Room, playerId: string, input: { offerId: unknown }, now: number): void {
  const p = assertPlaying(room, playerId);
  const o = openOffer(room, input.offerId);
  if (o.from !== p.id) throw new GameError(409, 'Only the player who made an offer can cancel it.');
  present(room, p, now);
  o.status = 'cancelled';
  room.updatedAt = now;
}

/** Stop placing free roads. */
export function skip(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['roads']);
  if (!auto) present(room, p, now);
  room.freeRoads = 0;
  toStep(room, 'main', now);
}

/** End your turn. */
export function end(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['main']);
  if (!auto) present(room, p, now);
  nextTurn(room, now);
}

// ---- Timeouts --------------------------------------------------------------------------

/** Best-pip legal corner (first in board order on a tie). */
function bestBy<T>(items: T[], score: (t: T) => number): T | null {
  let best: T | null = null;
  let top = -Infinity;
  for (const t of items) {
    const s = score(t);
    if (s > top) {
      top = s;
      best = t;
    }
  }
  return best;
}

/** One timed-out decision, made for whoever the room was waiting on. */
function autoMove(room: Room, now: number): void {
  const p = activePlayer(room)!;
  switch (room.step) {
    case 'setup': {
      if (room.setupNeed === 'cottage') {
        const v = bestBy(cottageSpots(room, p, true), (x) => vertexPips(room, x));
        if (!v) {
          // Nowhere at all to settle (cannot happen on these islands): skip their placement.
          nextSetup(room, now);
          break;
        }
        build(room, p.id, { piece: 'cottage', at: v }, now, true);
      }
      const roads = setupRoadSpots(room);
      const road = bestBy(roads, (e) => {
        const far = edgeEnds(e).find((v) => v !== room.setupCottage)!;
        return geo(room).vertexSet.has(far) ? vertexPips(room, far) : -1;
      });
      endedByClock(room, p, now);
      if (room.phase !== 'playing') break;
      if (road) build(room, p.id, { piece: 'road', at: road }, now, true);
      else nextSetup(room, now);
      break;
    }
    case 'roll':
      roll(room, p.id, now, true);
      break;
    case 'discard':
      for (const id of Object.keys(room.discardOwed)) {
        const q = byId(room, id)!;
        const owe = room.discardOwed[id];
        const h = { ...q.hand };
        const cards: Partial<Hand> = {};
        for (let i = 0; i < owe; i++) {
          const r = bestBy([...RESOURCES], (x) => h[x])!;
          h[r] -= 1;
          cards[r] = (cards[r] ?? 0) + 1;
        }
        discard(room, id, { cards }, now, true);
      }
      break;
    case 'fox': {
      const g = geo(room);
      const hexes = foxHexes(room, p.id).map((id) => hexById(room, id)!);
      const touchesMine = (h: Hex) => hexCorners(h.q, h.r).some((v) => g.vertexSet.has(v) && room.buildings[v]?.owner === p.id);
      const pool = hexes.some((h) => !touchesMine(h)) ? hexes.filter((h) => !touchesMine(h)) : hexes;
      const target = bestBy(pool, (h) =>
        hexCorners(h.q, h.r).reduce((n, v) => {
          const b = g.vertexSet.has(v) ? room.buildings[v] : undefined;
          return b && b.owner !== p.id ? n + h.pips * (b.piece === 'town' ? 2 : 1) : n;
        }, 0),
      )!;
      const victims = victimsAt(room, p.id, target.id);
      const victim = bestBy(victims, (id) => publicVp(room, id) * 1000 + handCount(byId(room, id)!.hand) * 10 - room.seats.indexOf(id) / 10);
      fox(room, p.id, { hex: target.id, victim }, now, true);
      break;
    }
    case 'main':
      endedByClock(room, p, now);
      log(room, now, 'turn', p.id, `${p.name}'s time ran out.`, { auto: true });
      if (room.phase === 'playing') nextTurn(room, now);
      break;
    case 'roads':
      room.freeRoads = 0;
      endedByClock(room, p, now);
      log(room, now, 'turn', p.id, `${p.name}'s time ran out.`, { auto: true });
      if (room.phase === 'playing') nextTurn(room, now);
      break;
  }
}

/** A turn the clock ended: two in a row and they are away; everyone away ends the game. */
function endedByClock(room: Room, p: Player, now: number): void {
  p.autoEnds += 1;
  if (p.autoEnds >= 2 && !p.away) {
    p.away = true;
    log(room, now, 'away', p.id, `${p.name} seems to be away: their turns will be quick until they're back.`);
  }
  if (playing(room).every((q) => q.away)) {
    room.result = { winnerId: null, reason: 'abandoned' };
    log(room, now, 'finish', null, "Everyone's away — game abandoned.");
    close(room, now);
  }
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it. One
 * step per call, each next deadline set from `now`, so a room that was asleep
 * for three days takes one auto-move, not a cascade.
 */
export function advance(room: Room, now: number, _rng?: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case 'lobby':
    case 'finished':
      close(room, due);
      break;
    case 'countdown':
      if (joined(room).length < MIN_PLAYERS) {
        room.phase = 'lobby';
        room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
      } else begin(room, now);
      break;
    case 'playing':
      autoMove(room, now);
      break;
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Durable rooms --------------------------------------------------------------------

/** Rooms of this game are written to `game_rooms` and survive a restart. */
export const durable = { schema: 1 };
export const paces = ['live', 'async'] as const;

/** Who the room is waiting on, with a key that changes for every new decision. */
export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  if (room.phase !== 'playing') return null;
  const ids = waitingIds(room);
  if (!ids.length) return null;
  const active = room.seats[room.active];
  const name = nameOf(room, active);
  const dice = room.dice;
  if (room.step === 'discard') {
    return { ids, key: `${room.turn}:discard`, line: `${name} rolled a 7: time to discard.` };
  }
  let line: string;
  switch (room.step) {
    case 'setup':
      line = `Your turn to place a ${room.setupNeed}.`;
      break;
    case 'roll':
      line = 'Your turn to roll.';
      break;
    case 'fox':
      line = 'Move the fox.';
      break;
    case 'roads':
      line = 'Place your free roads.';
      break;
    default: {
      // This line goes only to the active player: word it for them.
      const lastRoll = [...room.log].reverse().find((e) => e.kind === 'roll');
      if (!dice || dice.by !== active) line = 'Your move.';
      else if (lastRoll?.by === active && lastRoll.auto) line = `The dice rolled ${dice.total} for you.`;
      else line = `You rolled ${dice.total}.`;
    }
  }
  return { ids, key: `${room.turn}:${room.step}:${active}`, line };
}

/** A live room read back after a restart: the running decision gets its full time again. */
export function resume(room: Room, now: number, _pausedMs: number): void {
  if (room.phase === 'countdown') room.phaseEndsAt = now + COUNTDOWN_MS;
  else if (room.phase === 'playing') room.phaseEndsAt = now + decisionMs(room, room.step);
}

// ---- Result -----------------------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  place: number;
  /** Final VP, heirlooms included: the leaderboard's high score. */
  score: number;
  vp: number;
  heirlooms: number;
  cottages: number;
  towns: number;
  trail: number;
  longestTrail: boolean;
  chiefRanger: boolean;
  result: 'won' | 'lost';
  left: boolean;
}

/** Winner first, then points (equal points share a place), leavers last. */
export function standings(room: Room): Standing[] {
  if (!room.result || room.result.reason === 'abandoned') return [];
  const winnerId = room.result.winnerId;
  const rows = room.seats
    .map((id) => byId(room, id)!)
    .filter(Boolean)
    .map((p) => {
      const mine = Object.values(room.buildings).filter((b) => b.owner === p.id);
      return {
        id: p.id,
        name: p.name,
        place: 0,
        score: totalVp(room, p.id),
        vp: totalVp(room, p.id),
        heirlooms: heirlooms(p),
        cottages: mine.filter((b) => b.piece === 'cottage').length,
        towns: mine.filter((b) => b.piece === 'town').length,
        trail: trailLength(room, p.id),
        longestTrail: room.longestTrailId === p.id,
        chiefRanger: room.chiefRangerId === p.id,
        result: (p.id === winnerId ? 'won' : 'lost') as 'won' | 'lost',
        left: p.status !== 'joined',
      };
    });
  rows.sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    if (a.left !== b.left) return a.left ? 1 : -1;
    return b.vp - a.vp;
  });
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.place = i === 0 ? 1 : prev && !prev.left && !r.left && prev.vp === r.vp && prev.id !== winnerId ? prev.place : i + 1;
  });
  return rows;
}

export function winners(room: Room): string[] {
  return room.result?.winnerId ? [room.result.winnerId] : [];
}

// ---- The wire ---------------------------------------------------------------------------

const TIPS = [
  'A town makes two of everything its cottage made.',
  'Numbers with more dots come up more often: 6 and 8 most of all.',
  'A harbour lets you trade with the bank for less.',
  'Rangers move the fox — three of them make you Chief Ranger.',
  'Five roads in a row can win you the Longest Trail.',
  'Trading with the others is often better than trading with the bank.',
];

function affordable(room: Room, p: Player): (Piece | 'card')[] {
  const out: (Piece | 'card')[] = [];
  for (const k of ['road', 'cottage', 'town'] as Piece[]) if (p.pieces[k] > 0 && covers(p.hand, COSTS[k])) out.push(k);
  if (room.deck.length && covers(p.hand, COSTS.card)) out.push('card');
  return out;
}

/** Bank trades that would let `p` afford something they nearly can, best first. */
function suggestedTrades(room: Room, p: Player): { give: Resource; count: number; get: Resource; for: Piece | 'card' }[] {
  const out: { give: Resource; count: number; get: Resource; for: Piece | 'card' }[] = [];
  const r = rates(room, p.id);
  for (const target of ['town', 'cottage', 'card', 'road'] as (Piece | 'card')[]) {
    if (target !== 'card' && p.pieces[target] <= 0) continue;
    const cost = COSTS[target];
    const missing = RESOURCES.filter((x) => p.hand[x] < (cost[x] ?? 0));
    if (missing.length !== 1 || p.hand[missing[0]] + 1 < (cost[missing[0]] ?? 0)) continue;
    const get = missing[0];
    if (room.bank[get] < 1) continue;
    const give = RESOURCES.find((x) => x !== get && p.hand[x] - (cost[x] ?? 0) >= r[x]);
    if (give) out.push({ give, count: r[give], get, for: target });
    if (out.length >= 3) break;
  }
  return out;
}

/** The viewer's own options right now. */
function legalFor(room: Room, p: Player | null) {
  const none = {
    road: [] as string[],
    cottage: [] as string[],
    town: [] as string[],
    fox: [] as string[],
    victims: {} as Record<string, string[]>,
    canRoll: false,
    canBuy: false,
    canEnd: false,
    playable: [] as CardKind[],
    canTrade: false,
  };
  if (!p || room.phase !== 'playing' || p.status !== 'joined' || p.seat === null) return none;
  const isActive = room.seats[room.active] === p.id;
  const out = { ...none };
  switch (room.step) {
    case 'setup':
      if (!isActive) break;
      if (room.setupNeed === 'cottage') out.cottage = cottageSpots(room, p, true);
      else out.road = setupRoadSpots(room);
      break;
    case 'roll':
      if (!isActive) break;
      out.canRoll = true;
      break;
    case 'fox':
      if (!isActive) break;
      out.fox = foxHexes(room, p.id);
      for (const h of out.fox) {
        const v = victimsAt(room, p.id, h);
        if (v.length) out.victims[h] = v;
      }
      break;
    case 'roads':
      if (isActive && p.pieces.road > 0) out.road = roadSpots(room, p);
      break;
    case 'main':
      if (!isActive && !openBuilding(room)) break;
      if (p.pieces.road > 0 && covers(p.hand, COSTS.road)) out.road = roadSpots(room, p);
      if (p.pieces.cottage > 0 && covers(p.hand, COSTS.cottage)) out.cottage = cottageSpots(room, p);
      if (p.pieces.town > 0 && covers(p.hand, COSTS.town)) out.town = townSpots(room, p);
      out.canBuy = room.deck.length > 0 && covers(p.hand, COSTS.card);
      out.canEnd = isActive;
      out.canTrade = isActive;
      break;
  }
  if (isActive && !room.playedCardThisTurn && (room.step === 'roll' || room.step === 'main')) {
    const kinds = new Set(p.cards.filter((c) => c.boughtTurn !== room.turn && c.kind !== 'heirloom').map((c) => c.kind));
    out.playable = CARD_KINDS.filter((k) => kinds.has(k) && (room.step === 'main' || k === 'ranger'));
  }
  return out;
}

/**
 * The room as one player's phone sees it. Hidden: other players' cards (counts
 * only), unplayed almanac cards (mine listed for me), the deck order, the
 * generator, and what a steal took (thief and victim only).
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const meP = byId(room, meId);
  const seated = meP && meP.seat !== null ? meP : null;
  const active = activePlayer(room);
  const hintsLevel = room.difficulty === 'easy' ? 'full' : room.difficulty === 'medium' ? 'affordable' : null;
  const hints =
    seated && hintsLevel && room.phase === 'playing'
      ? {
          affordable: affordable(room, seated),
          trades: hintsLevel === 'full' ? suggestedTrades(room, seated) : [],
          tip: hintsLevel === 'full' ? TIPS[room.turn % TIPS.length] : null,
        }
      : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    step: room.phase === 'playing' ? room.step : null,
    hostId: room.hostId,
    meId,
    pace: room.pace,
    deadlineHours: room.deadlineHours,
    vpTarget: room.vpTarget,
    island: room.island,
    rule: about(room),
    turn: room.turn,
    activeId: active?.id ?? null,
    phaseEndsAt: room.phaseEndsAt,
    startedAt: room.startedAt,
    board: room.board
      ? {
          hexes: room.board.hexes.map((h) => ({
            id: h.id,
            q: h.q,
            r: h.r,
            kind: h.kind,
            ...(h.resource ? { resource: h.resource } : {}),
            token: h.token,
            pips: h.pips,
          })),
          harbours: room.board.harbours.map((h) => ({ edge: h.edge, kind: h.kind, rate: h.rate })),
        }
      : null,
    fox: room.fox,
    buildings: Object.entries(room.buildings)
      .map(([at, b]) => ({ at, owner: b.owner, piece: b.piece }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
    roads: Object.entries(room.roads)
      .map(([at, owner]) => ({ at, owner }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
    seats: [...room.seats],
    dice: room.dice ? { ...room.dice } : null,
    setup:
      room.phase === 'playing' && room.step === 'setup'
        ? { round: room.setupIndex < room.seats.length ? 1 : 2, need: room.setupNeed, cottage: room.setupCottage }
        : null,
    freeRoads: room.freeRoads,
    discardOwed: { ...room.discardOwed },
    me: seated
      ? {
          hand: { ...seated.hand },
          cards: seated.cards.map((c) => ({ kind: c.kind, new: c.boughtTurn === room.turn })),
          vp: totalVp(room, seated.id),
          playedCardThisTurn: room.seats[room.active] === seated.id ? room.playedCardThisTurn : false,
          rates: rates(room, seated.id),
        }
      : null,
    legal: legalFor(room, seated),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seat: p.seat,
      colour: p.seat === null ? null : COLOURS[p.seat],
      handCount: handCount(p.hand),
      cardCount: p.cards.length,
      rangersPlayed: p.rangersPlayed,
      publicVp: publicVp(room, p.id),
      trail: trailLength(room, p.id),
      longestTrail: room.longestTrailId === p.id,
      chiefRanger: room.chiefRangerId === p.id,
      pieces: { ...p.pieces },
      away: p.away,
      ...(finished ? { heirlooms: heirlooms(p), vp: totalVp(room, p.id) } : {}),
    })),
    bank: { ...room.bank },
    deckCount: room.deck.length,
    costs: COSTS,
    showCosts: room.difficulty !== 'hard',
    offers: room.offers.map((o) => ({
      id: o.id,
      from: o.from,
      to: o.to ? [...o.to] : null,
      give: { ...o.give },
      want: { ...o.want },
      status: o.status,
      refusedBy: [...o.refusedBy],
      counterTo: o.counterTo,
      acceptedBy: o.acceptedBy,
      at: o.at,
    })),
    hints,
    log: room.log.slice(-LOG_SEND).map((e) => ({
      n: e.n,
      at: e.at,
      kind: e.kind,
      by: e.by,
      text: e.secret?.[meId] ?? e.text,
      auto: e.auto,
    })),
    result: room.result ? { ...room.result } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
