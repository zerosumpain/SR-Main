// Homestead's shared layer: the room's types and constants, its own seeded
// generator, and the read-only questions the rules, the trades and the wire
// all ask of a room (who is playing, where may they build, how many points,
// whose decision is running). Nothing here moves the game on — that is
// `homestead.ts`, which re-exports the public names (spec:
// docs/superpowers/specs/2026-10-22-family-games-homestead.md).

import {
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  type Difficulty,
  type PlayerStatus,
} from './tap-duel';
import {
  RESOURCES,
  edgeEnds,
  geometry,
  hexCorners,
  isResource,
  type Board,
  type Harbour,
  type Hex,
  type IslandSize,
  type Resource,
} from './homestead-board';
export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';
export type Step = 'setup' | 'roll' | 'discard' | 'fox' | 'main' | 'roads';
export type Pace = 'live' | 'async';
export type Piece = 'road' | 'cottage' | 'town';
export type CardKind = 'ranger' | 'heirloom' | 'pathfinders' | 'harvest' | 'market';
export type Hand = Record<Resource, number>;

export const CARD_KINDS: readonly CardKind[] = ['ranger', 'heirloom', 'pathfinders', 'harvest', 'market'];
export const isCardKind = (v: unknown): v is CardKind => typeof v === 'string' && (CARD_KINDS as readonly string[]).includes(v);

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
export const COLOURS = ['red', 'blue', 'amber', 'green', 'purple'] as const;
export const TRAIL_MIN = 5;
export const RANGERS_MIN = 3;
export const MAX_OPEN_OFFERS = 3;
export const LOG_KEEP = 200;
export const LOG_SEND = 50;
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

export const roller = (room: Room) => () => nextFloat(room.rng);
export const randInt = (room: Room, n: number) => Math.floor(nextFloat(room.rng) * n);

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

export const emptyHand = (): Hand => ({ timber: 0, clay: 0, wool: 0, grain: 0, stone: 0 });
export const handCount = (h: Partial<Hand>) => RESOURCES.reduce((n, r) => n + (h[r] ?? 0), 0);

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

export function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}
export const byId = (room: Room, id: string) => room.players.find((p) => p.id === id) ?? null;
export const nameOf = (room: Room, id: string | null) => (id ? (byId(room, id)?.name ?? 'Someone') : 'Nobody');

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** Seated players still at the table, in seat order. */
export function playing(room: Room): Player[] {
  return room.seats.map((id) => byId(room, id)!).filter((p) => p && p.status === 'joined');
}

export function activePlayer(room: Room): Player | null {
  if (room.phase !== 'playing') return null;
  const id = room.seats[room.active];
  return id ? byId(room, id) : null;
}

export const lobbyMs = (pace: Pace, hours: number) => (pace === 'async' ? hours * 3_600_000 : LOBBY_MS);
export const finishedMs = (room: Room) => (room.pace === 'async' ? ASYNC_FINISHED_MS : FINISHED_MS);

/** The invite banner's line. */
export function about(room: Room): string {
  const island = room.island === 'auto' ? '' : `${room.island === 'large' ? 'Large' : 'Standard'} island · `;
  const pace = room.pace === 'async' ? `over days, ${room.deadlineHours} h a move` : 'play now';
  return `${island}first to ${room.vpTarget} points · ${pace}`;
}

// ---- The log ------------------------------------------------------------------

export function log(
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

export const handText = (h: Partial<Hand>) =>
  RESOURCES.filter((r) => (h[r] ?? 0) > 0)
    .map((r) => `${h[r]} ${r}`)
    .join(', ');

/** The setup snake's seat for placement `k`: 0…n−1, then n−1…0. */
export function setupSeat(n: number, k: number): number {
  return k < n ? k : 2 * n - 1 - k;
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

export function toStep(room: Room, step: Step, now: number): void {
  room.step = step;
  room.phaseEndsAt = now + decisionMs(room, step);
  room.updatedAt = now;
}

export function waitingIds(room: Room, step: Step = room.step): string[] {
  if (room.phase !== 'playing') return [];
  if (step === 'discard') return Object.keys(room.discardOwed);
  const id = room.seats[room.active];
  return id ? [id] : [];
}

// ---- Board queries -------------------------------------------------------------

export function geo(room: Room) {
  return geometry(room.board!.size);
}

export function hexById(room: Room, id: string): Hex | null {
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

export function setupRoadSpots(room: Room): string[] {
  if (!room.board || !room.setupCottage) return [];
  return geo(room).vertexBoardEdges.get(room.setupCottage)!.filter((e) => !room.roads[e]);
}

export function townSpots(room: Room, p: Player): string[] {
  return Object.entries(room.buildings)
    .filter(([, b]) => b.owner === p.id && b.piece === 'cottage')
    .map(([v]) => v)
    .sort();
}

/** Pip total of a corner's land hexes. */
export function vertexPips(room: Room, v: string): number {
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

export function heirlooms(p: Player): number {
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

// ---- Hands and the bank -----------------------------------------------------------

export function covers(hand: Hand, cost: Partial<Hand>): boolean {
  return RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
}

export function pay(room: Room, p: Player, cost: Partial<Hand>): void {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    p.hand[r] -= n;
    room.bank[r] += n;
  }
}

/** Offers whose proposer can no longer cover them become void. */
export function voidUncovered(room: Room): void {
  for (const o of room.offers) {
    if (o.status !== 'open') continue;
    const from = byId(room, o.from);
    if (!from || !covers(from.hand, o.give)) o.status = 'void';
  }
}

/** Parse `{ timber: 2, … }`: whole positive counts of real resources, at least one. */
export function parseCards(v: unknown, what: string): Partial<Hand> {
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

export function assertPlaying(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (room.phase !== 'playing') {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  }
  if (p.status !== 'joined' || p.seat === null) throw new GameError(403, 'You are not playing this game.');
  return p;
}

export function assertActive(room: Room, playerId: string, steps: Step[]): Player {
  const p = assertPlaying(room, playerId);
  if (room.seats[room.active] !== p.id) throw new GameError(409, "It's not your turn.");
  if (!steps.includes(room.step)) throw new GameError(409, stepRefusal(room));
  return p;
}

export function stepRefusal(room: Room): string {
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
export function present(room: Room, p: Player, now: number): void {
  p.autoEnds = 0;
  if (!p.away) return;
  p.away = false;
  log(room, now, 'away', p.id, `${p.name} is back.`);
  // Their running decision gets its full time again.
  if (waitingIds(room).includes(p.id)) room.phaseEndsAt = now + decisionMs(room, room.step);
}

/** Five seated: anyone may build or buy during another player's main step. */
export function openBuilding(room: Room): boolean {
  return room.seats.length >= 5;
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

// ---- Timeouts --------------------------------------------------------------------------

/** Best-pip legal corner (first in board order on a tie). */
export function bestBy<T>(items: T[], score: (t: T) => number): T | null {
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

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
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
