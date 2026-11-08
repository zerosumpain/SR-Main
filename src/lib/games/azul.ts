// Azul — the tile-drafting board game, as pure functions over a room
// (spec: docs/superpowers/specs/2026-10-31-family-games-azul.md).
//
// Same shape as Homestead and Fireworks: every function takes `now` (epoch
// ms), the registry owns timers and fan-out, nothing here knows about either.
// Like Homestead the room carries its OWN seeded generator (`rng`, sfc32), so a
// durable room read back after a deploy draws the same tiles it would have,
// and a test can seed a whole game. The registry's `rng` argument is unused.
//
// The game, in the standard rules for two to four:
//  - Each round the factories (5 / 7 / 9 for 2 / 3 / 4 players) are filled
//    with four tiles each from the bag. A turn takes EVERY tile of one colour
//    from one factory (the rest slide to the centre) or from the centre (the
//    first to do that takes the first-player marker onto their floor too).
//  - The tiles go onto one pattern line (line n holds n), which must be empty
//    or already that colour, and whose wall row must not hold the colour yet;
//    what does not fit falls to the floor. Or straight onto the floor.
//  - When the factories and the centre are empty, every full line moves one
//    tile to the wall, scoring 1, or the length of the run it joins in its row
//    plus its column. The floor costs 1, 1, 2, 2, 2, 3, 3. The marker's holder
//    starts the next round.
//  - The round in which anybody completes a row of the wall is the last.
//    Bonuses: 2 a complete row, 7 a complete column, 10 a colour placed five
//    times. Most points wins; a tie goes to the most complete rows.
//
// Nothing is hidden in Azul — every phone and the TV board see the same table;
// the bag's order and the generator never leave the room. A phone is told the
// lines it may play each colour to only on its own turn (`canPlace`), so it
// never needs the rules to light the board.
//
// Every tile has an id for the whole game (0–99, the marker is 100), so the TV
// board and the phones can fly a tile from where it was to where it is.

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
import { nextFloat, seedRng, type RngState } from './homestead-model';
import type { Pace } from './catalogue';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'playing' | 'scoring' | 'finished' | 'closed';

export const COLOURS = ['blue', 'yellow', 'red', 'black', 'white'] as const;
export type Colour = (typeof COLOURS)[number];
export const isColour = (v: unknown): v is Colour => typeof v === 'string' && (COLOURS as readonly string[]).includes(v);

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const TILES_PER_COLOUR = 20;
export const TILES_PER_FACTORY = 4;
export const FIRST_MARKER_ID = 100;
/** What each floor space costs, left to right; a tile past the seventh goes to the lid for nothing. */
export const FLOOR_PENALTIES = [1, 1, 2, 2, 2, 3, 3] as const;
export const BONUS = { row: 2, column: 7, colour: 10 } as const;
/** The hours an async player has for a turn; anything else asked for is 24. */
export const DEADLINE_HOURS = [12, 24, 48] as const;

/** A live turn's clock: what the difficulty buys you. */
export const TURN_MS: Record<Difficulty, number> = { easy: 180_000, medium: 90_000, hard: 45_000 };
/** A player whose clock ran out last turn gets this long until they move again. */
export const AWAY_MS: Record<Pace, number> = { live: 20_000, async: 3_600_000 };
/** The pause after a round is tiled, so the table can watch the wall fill and the scores move. */
export const SCORING_MS = 6_500;

/** Whether the room expects a TV board (`/games/azul`) or plays on phones alone. Either way the phones show everything. */
export type Table = 'tv' | 'phones';

/** The wall's fixed pattern: the column a colour takes in a row. Row 0 is blue, yellow, red, black, white. */
export function wallColumn(row: number, colour: Colour): number {
  return (COLOURS.indexOf(colour) + row) % 5;
}

/** The colour that belongs at a wall square. */
export function wallColour(row: number, col: number): Colour {
  return COLOURS[(((col - row) % 5) + 5) % 5];
}

export function factoryCount(players: number): number {
  return players <= 2 ? 5 : players === 3 ? 7 : 9;
}

// ---- The room ------------------------------------------------------------

export interface Tile {
  id: number;
  c: Colour;
}

/** A floor space: a tile, or the first-player marker. */
export interface FloorItem {
  id: number;
  c: Colour | 'first';
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Place at the table once play starts (turn order); null before, or for somebody not seated. */
  seat: number | null;
  score: number;
  /** Five pattern lines; line i holds up to i + 1 tiles of one colour. */
  lines: Tile[][];
  /** The 5×5 wall: the id of the tile on each square, or null. The colour is the square's (`wallColour`). */
  wall: (number | null)[][];
  floor: FloorItem[];
  /** Turns in a row their clock ran out on; their next clock is AWAY_MS until they move. */
  away: number;
}

export type Source = 'centre' | number;

/** The last turn, for the boards' highlight and the log. */
export interface LastTake {
  by: string;
  source: Source;
  colour: Colour;
  /** Tile ids taken, in order. */
  tiles: number[];
  /** The pattern line (0–4), or 'floor'. */
  line: number | 'floor';
  /** How many fell to the floor (or the lid) for want of room. */
  overflow: number;
  /** Ids slid to the centre from the factory. */
  toCentre: number[];
  tookFirst: boolean;
  auto: boolean;
  at: number;
}

/** One tile moved to the wall at a round's end, and what it scored. */
export interface Placement {
  line: number;
  col: number;
  tile: number;
  points: number;
}

export interface RoundScore {
  id: string;
  placements: Placement[];
  /** The floor's cost, as a positive number (taken off, never below zero). */
  floor: number;
  /** The score before and after the round. */
  before: number;
  after: number;
}

export interface Bonus {
  rows: number;
  columns: number;
  colours: number;
  points: number;
}

export interface LogEntry {
  n: number;
  at: number;
  by: string | null;
  text: string;
  auto: boolean;
}

export interface Result {
  winnerIds: string[];
  reason: 'wall' | 'left' | 'tiles';
}

export interface Room {
  id: string;
  game: 'azul';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  pace: Pace;
  deadlineHours: number;
  table: Table;
  rng: RngState;
  bag: Tile[];
  lid: Tile[];
  factories: Tile[][];
  centre: Tile[];
  firstInCentre: boolean;
  /** Who holds the marker for the next round (the first to take from the centre). */
  nextStarterId: string | null;
  turnId: string | null;
  turnStartedAt: number | null;
  round: number;
  /** Turns taken in the whole game, for the waiting key. */
  turns: number;
  last: LastTake | null;
  roundScores: RoundScore[] | null;
  bonuses: Record<string, Bonus> | null;
  /** Somebody completed a wall row this round: it is the last. */
  lastRound: boolean;
  result: Result | null;
  log: LogEntry[];
  startedAt: number | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const emptyWall = (): (number | null)[][] => Array.from({ length: 5 }, () => [null, null, null, null, null]);
const emptyLines = (): Tile[][] => Array.from({ length: 5 }, () => []);

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seat: null, score: 0, lines: emptyLines(), wall: emptyWall(), floor: [], away: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** The players at the table, in turn order. */
export function seated(room: Room): Player[] {
  return room.players.filter((p) => p.seat !== null).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

/** Seated and still here. */
function active(room: Room): Player[] {
  return seated(room).filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function shuffle<T>(room: Room, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(room.rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function log(room: Room, now: number, by: string | null, text: string, auto = false): void {
  const n = (room.log.at(-1)?.n ?? 0) + 1;
  room.log.push({ n, at: now, by, text, auto });
  if (room.log.length > 30) room.log.splice(0, room.log.length - 30);
}

function lobbyMs(room: Pick<Room, 'pace' | 'deadlineHours'>): number {
  return room.pace === 'async' ? room.deadlineHours * 3_600_000 : LOBBY_MS;
}

/** The clock for whoever's turn it is now. */
function turnMs(room: Room, p: Player | null): number {
  if (p && p.away > 0) return AWAY_MS[room.pace];
  return room.pace === 'async' ? room.deadlineHours * 3_600_000 : TURN_MS[room.difficulty];
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const o = input.options ?? {};
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Azul is for two to ${MAX_PLAYERS}.`);
  const pace: Pace = o.pace === 'async' ? 'async' : 'live';
  const deadlineHours = (DEADLINE_HOURS as readonly unknown[]).includes(o.deadlineHours) ? (o.deadlineHours as number) : 24;
  const room: Room = {
    id: input.id,
    game: 'azul',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    pace,
    deadlineHours,
    table: o.table === 'tv' ? 'tv' : 'phones',
    rng: seedRng(o.seed),
    bag: [],
    lid: [],
    factories: [],
    centre: [],
    firstInCentre: false,
    nextStarterId: null,
    turnId: null,
    turnStartedAt: null,
    round: 0,
    turns: 0,
    last: null,
    roundScores: null,
    bonuses: null,
    lastRound: false,
    result: null,
    log: [],
    startedAt: null,
    phaseEndsAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  room.phaseEndsAt = input.now + lobbyMs(room);
  return room;
}

/** The invite banner's line. */
export function about(room: Room): string {
  const pace = room.pace === 'async' ? 'a turn a day' : 'play now';
  return `${room.table === 'tv' ? 'on the TV board' : 'on your phones'} · ${pace}`;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length >= MAX_PLAYERS) throw new GameError(409, `Azul is for up to ${MAX_PLAYERS}.`);
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
  room.turnId = null;
  room.turnStartedAt = null;
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

/**
 * Leaving the lobby as host cancels the game; the last one out closes the
 * room. Mid-game the leaver's board stays where it is (they are out of the
 * running) and the others play on; one player left ends the game.
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
  if (p.seat === null || (room.phase !== 'playing' && room.phase !== 'scoring')) return;
  log(room, now, p.id, `${p.name} left the game.`);
  if (active(room).length < 2) {
    finish(room, 'left', now);
    return;
  }
  if (room.nextStarterId === playerId) room.nextStarterId = null;
  if (room.phase === 'playing' && room.turnId === playerId) passTurn(room, p, now);
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  const in_ = joined(room);
  if (in_.length < MIN_PLAYERS) throw new GameError(409, 'Azul needs at least two players.');
  if (in_.length > MAX_PLAYERS) throw new GameError(409, `Azul is for up to ${MAX_PLAYERS}: ask somebody to leave.`);
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  room.players = room.players.map((p) => player(p.id, p.name, p.status === 'joined' ? 'joined' : 'invited'));
  Object.assign(room, {
    phase: 'lobby',
    bag: [],
    lid: [],
    factories: [],
    centre: [],
    firstInCentre: false,
    nextStarterId: null,
    turnId: null,
    turnStartedAt: null,
    round: 0,
    turns: 0,
    last: null,
    roundScores: null,
    bonuses: null,
    lastRound: false,
    result: null,
    log: [],
    startedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Partial<Room>);
  room.phaseEndsAt = now + lobbyMs(room);
}

// ---- Play ----------------------------------------------------------------

/** Seat everybody in a random order, fill the bag and start round one. */
function begin(room: Room, now: number): void {
  const order = shuffle(room, joined(room));
  for (const p of room.players) Object.assign(p, { ...player(p.id, p.name, p.status), seat: null });
  order.forEach((p, i) => (p.seat = i));
  const tiles: Tile[] = [];
  COLOURS.forEach((c, ci) => {
    for (let k = 0; k < TILES_PER_COLOUR; k++) tiles.push({ id: ci * TILES_PER_COLOUR + k, c });
  });
  room.bag = shuffle(room, tiles);
  room.lid = [];
  room.round = 0;
  room.turns = 0;
  room.lastRound = false;
  room.result = null;
  room.bonuses = null;
  room.log = [];
  room.startedAt = now;
  room.nextStarterId = order[0]?.id ?? null;
  log(room, now, null, `${order.map((p) => p.name).join(', ')} sit down. ${order[0]?.name ?? 'Somebody'} starts.`);
  newRound(room, now);
}

/** Draw one tile, refilling the bag from the lid when it runs dry; null when there are none left anywhere. */
function draw(room: Room): Tile | null {
  if (!room.bag.length && room.lid.length) {
    room.bag = shuffle(room, room.lid);
    room.lid = [];
  }
  return room.bag.pop() ?? null;
}

function newRound(room: Room, now: number): void {
  room.round += 1;
  room.roundScores = null;
  room.factories = Array.from({ length: factoryCount(seated(room).length) }, () => {
    const f: Tile[] = [];
    for (let i = 0; i < TILES_PER_FACTORY; i++) {
      const t = draw(room);
      if (t) f.push(t);
    }
    return f;
  });
  room.centre = [];
  room.firstInCentre = true;
  if (room.factories.every((f) => !f.length)) {
    // Every tile is on a wall or a line: nothing left to draft, so the game ends here.
    finish(room, 'tiles', now);
    return;
  }
  const players = active(room);
  const starter = players.find((p) => p.id === room.nextStarterId) ?? players[0];
  room.nextStarterId = null;
  room.phase = 'playing';
  room.turnId = starter?.id ?? null;
  room.turnStartedAt = now;
  room.phaseEndsAt = now + turnMs(room, starter ?? null);
  room.updatedAt = now;
  log(room, now, null, `Round ${room.round}. ${starter?.name ?? 'Somebody'} to start.`);
}

/** The lines (0–4) this player may put `colour` on. The floor is always allowed. */
export function legalLines(p: Pick<Player, 'lines' | 'wall'>, colour: Colour): number[] {
  const out: number[] = [];
  for (let i = 0; i < 5; i++) {
    const line = p.lines[i];
    if (line.length >= i + 1) continue;
    if (line.length && line[0].c !== colour) continue;
    if (p.wall[i][wallColumn(i, colour)] !== null) continue;
    out.push(i);
  }
  return out;
}

/** The colours on offer at a source, in COLOURS order. */
function coloursAt(tiles: Tile[]): Colour[] {
  return COLOURS.filter((c) => tiles.some((t) => t.c === c));
}

function parseSource(room: Room, v: unknown): Source {
  if (v === 'centre' || v === 'center') return 'centre';
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < room.factories.length) return v;
  throw new GameError(400, 'Pick a factory or the centre.');
}

function parseLine(v: unknown): number | 'floor' {
  if (v === 'floor') return 'floor';
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 5) return v;
  throw new GameError(400, 'Pick a pattern line or the floor.');
}

function addToFloor(room: Room, p: Player, items: FloorItem[]): number {
  let lost = 0;
  for (const item of items) {
    if (p.floor.length < FLOOR_PENALTIES.length) p.floor.push(item);
    else if (item.c !== 'first') {
      room.lid.push(item as Tile);
      lost += 1;
    }
  }
  return lost;
}

const LINE_NAMES = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Take every tile of `colour` from a factory (`source` its index) or from the
 * centre, onto a pattern line (0–4) or the floor. One call is one whole turn.
 * A refusal (400) costs nothing; off-turn is 409.
 */
export function take(room: Room, playerId: string, input: { source: unknown; colour: unknown; line: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined' || p.seat === null) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing') {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : room.phase === 'scoring' ? 'The round is being scored.' : 'The game has not started.');
  }
  if (room.turnId !== p.id) throw new GameError(409, "It's not your turn.");
  const source = parseSource(room, input.source);
  if (!isColour(input.colour)) throw new GameError(400, 'Pick a colour.');
  const line = parseLine(input.line);
  const pool = source === 'centre' ? room.centre : room.factories[source];
  if (!pool.some((t) => t.c === input.colour)) {
    throw new GameError(400, source === 'centre' ? `There is no ${input.colour} in the centre.` : `That factory has no ${input.colour}.`);
  }
  if (line !== 'floor' && !legalLines(p, input.colour).includes(line)) {
    throw new GameError(400, lineRefusal(p, line, input.colour));
  }
  p.away = 0;
  place(room, p, source, input.colour, line, false, now);
}

function lineRefusal(p: Player, line: number, colour: Colour): string {
  const l = p.lines[line];
  if (l.length >= line + 1) return 'That line is full.';
  if (l.length && l[0].c !== colour) return `That line is collecting ${l[0].c}.`;
  return `Your wall already has ${colour} in that row.`;
}

function place(room: Room, p: Player, source: Source, colour: Colour, line: number | 'floor', auto: boolean, now: number): void {
  const pool = source === 'centre' ? room.centre : room.factories[source];
  const taken = pool.filter((t) => t.c === colour);
  const rest = pool.filter((t) => t.c !== colour);
  let tookFirst = false;
  const floorItems: FloorItem[] = [];
  if (source === 'centre') {
    room.centre = rest;
    if (room.firstInCentre) {
      room.firstInCentre = false;
      room.nextStarterId = p.id;
      tookFirst = true;
      floorItems.push({ id: FIRST_MARKER_ID, c: 'first' });
    }
  } else {
    room.factories[source] = [];
    room.centre.push(...rest);
  }
  let overflow = 0;
  if (line === 'floor') {
    floorItems.push(...taken);
    overflow = taken.length;
  } else {
    const room_ = line + 1 - p.lines[line].length;
    p.lines[line].push(...taken.slice(0, room_));
    const spill = taken.slice(room_);
    floorItems.push(...spill);
    overflow = spill.length;
  }
  addToFloor(room, p, floorItems);
  room.last = {
    by: p.id,
    source,
    colour,
    tiles: taken.map((t) => t.id),
    line,
    overflow,
    toCentre: source === 'centre' ? [] : rest.map((t) => t.id),
    tookFirst,
    auto,
    at: now,
  };
  room.turns += 1;
  const from = source === 'centre' ? 'the centre' : `factory ${source + 1}`;
  const where = line === 'floor' ? 'the floor' : LINE_NAMES[line] + (overflow ? `, ${overflow} to the floor` : '');
  log(room, now, p.id, `${p.name} took ${plural(taken.length, colour)} from ${from} → ${where}${tookFirst ? ', and the first-player marker' : ''}.`, auto);
  room.updatedAt = now;
  if (room.factories.every((f) => !f.length) && !room.centre.length) {
    scoreRound(room, now);
    return;
  }
  passTurn(room, p, now);
}

/** Hand the turn to the next player still at the table. */
function passTurn(room: Room, from: Player, now: number): void {
  const order = seated(room);
  const start = order.findIndex((x) => x.id === from.id);
  for (let k = 1; k <= order.length; k++) {
    const next = order[(start + k) % order.length];
    if (next.status === 'joined') {
      room.turnId = next.id;
      room.turnStartedAt = now;
      room.phaseEndsAt = now + turnMs(room, next);
      return;
    }
  }
  room.turnId = null;
}

/** The points a tile placed at (row, col) scores against what is already on the wall. */
export function placementPoints(wall: (number | null)[][], row: number, col: number): number {
  const filled = (r: number, c: number) => r >= 0 && r < 5 && c >= 0 && c < 5 && wall[r][c] !== null;
  let h = 1;
  for (let c = col - 1; filled(row, c); c--) h++;
  for (let c = col + 1; filled(row, c); c++) h++;
  let v = 1;
  for (let r = row - 1; filled(r, col); r--) v++;
  for (let r = row + 1; filled(r, col); r++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

/** What the floor costs now. */
export function floorPenalty(floor: readonly unknown[]): number {
  return FLOOR_PENALTIES.slice(0, floor.length).reduce((a, b) => a + b, 0);
}

/** Tile the walls, take the floors, and pause for the table to watch. */
function scoreRound(room: Room, now: number): void {
  const scores: RoundScore[] = [];
  for (const p of seated(room)) {
    const before = p.score;
    const placements: Placement[] = [];
    for (let i = 0; i < 5; i++) {
      const line = p.lines[i];
      if (line.length < i + 1) continue;
      const col = wallColumn(i, line[0].c);
      p.wall[i][col] = line[0].id;
      const points = placementPoints(p.wall, i, col);
      p.score += points;
      placements.push({ line: i, col, tile: line[0].id, points });
      room.lid.push(...line.slice(1));
      p.lines[i] = [];
    }
    const floor = floorPenalty(p.floor);
    p.score = Math.max(0, p.score - floor);
    for (const item of p.floor) if (item.c !== 'first') room.lid.push(item as Tile);
    p.floor = [];
    scores.push({ id: p.id, placements, floor, before, after: p.score });
    if (p.wall.some((row) => row.every((x) => x !== null))) room.lastRound = true;
  }
  room.roundScores = scores;
  room.phase = 'scoring';
  room.turnId = null;
  room.turnStartedAt = null;
  room.phaseEndsAt = now + SCORING_MS;
  room.updatedAt = now;
  const line = scores
    .map((s) => `${room.players.find((p) => p.id === s.id)?.name ?? '?'} ${s.after - s.before >= 0 ? '+' : ''}${s.after - s.before}`)
    .join(', ');
  log(room, now, null, `Round ${room.round} scored: ${line}.${room.lastRound ? ' A row is complete — that was the last round.' : ''}`);
}

/** End-of-game bonuses for one wall. */
export function bonusFor(wall: (number | null)[][]): Bonus {
  const rows = wall.filter((r) => r.every((x) => x !== null)).length;
  let columns = 0;
  for (let c = 0; c < 5; c++) if (wall.every((r) => r[c] !== null)) columns++;
  let colours = 0;
  for (const colour of COLOURS) {
    if (wall.every((r, i) => r[wallColumn(i, colour)] !== null)) colours++;
  }
  return { rows, columns, colours, points: rows * BONUS.row + columns * BONUS.column + colours * BONUS.colour };
}

function finish(room: Room, reason: Result['reason'], now: number): void {
  const bonuses: Record<string, Bonus> = {};
  if (reason !== 'left') {
    for (const p of seated(room)) {
      const b = bonusFor(p.wall);
      bonuses[p.id] = b;
      p.score += b.points;
    }
  }
  room.bonuses = reason === 'left' ? null : bonuses;
  const contenders = active(room);
  const ranked = rank(room, contenders);
  const top = ranked[0];
  room.result = {
    winnerIds: top ? ranked.filter((p) => p.score === top.score && rowsOf(p) === rowsOf(top)).map((p) => p.id) : [],
    reason,
  };
  room.phase = 'finished';
  room.turnId = null;
  room.turnStartedAt = null;
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
  const names = room.result.winnerIds.map((id) => room.players.find((p) => p.id === id)?.name ?? '?');
  log(room, now, null, names.length ? `${names.join(' and ')} ${names.length > 1 ? 'share' : 'wins'} it.` : 'Game over.');
}

const rowsOf = (p: Player) => p.wall.filter((r) => r.every((x) => x !== null)).length;

function rank(_room: Room, players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score || rowsOf(b) - rowsOf(a) || (a.seat ?? 0) - (b.seat ?? 0));
}

// ---- The clock --------------------------------------------------------------

/**
 * The move the server makes for a player whose clock ran out: the colour and
 * line that put the most tiles onto a line with the fewest on the floor,
 * preferring a line it completes, then the shortest line. Never the marker if
 * a factory will do.
 */
export function autoMove(room: Room, p: Player): { source: Source; colour: Colour; line: number | 'floor' } | null {
  let best: { source: Source; colour: Colour; line: number | 'floor'; key: number[] } | null = null;
  const sources: Source[] = [...room.factories.map((_, i) => i as Source), 'centre'];
  for (const source of sources) {
    const pool = source === 'centre' ? room.centre : room.factories[source];
    for (const colour of coloursAt(pool)) {
      const n = pool.filter((t) => t.c === colour).length;
      const marker = source === 'centre' && room.firstInCentre ? 1 : 0;
      const options: (number | 'floor')[] = [...legalLines(p, colour), 'floor'];
      for (const line of options) {
        const fits = line === 'floor' ? 0 : Math.min(n, line + 1 - p.lines[line].length);
        const spill = n - fits + marker;
        const completes = line !== 'floor' && p.lines[line].length + fits === line + 1 ? 1 : 0;
        // Bigger is better, compared in order.
        const key = [-spill, fits, completes, line === 'floor' ? -9 : -line];
        if (!best || better(key, best.key)) best = { source, colour, line, key };
      }
    }
  }
  return best ? { source: best.source, colour: best.colour, line: best.line } : null;
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it. One
 * step per call, each next deadline set from `now`, so a room asleep for days
 * takes one auto-move, not a cascade.
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
        room.phaseEndsAt = now + lobbyMs(room);
      } else begin(room, now);
      break;
    case 'playing': {
      const p = room.players.find((x) => x.id === room.turnId);
      const move = p && p.status === 'joined' ? autoMove(room, p) : null;
      if (!p || !move) {
        if (p) passTurn(room, p, now);
        else room.phaseEndsAt = null;
        break;
      }
      p.away += 1;
      place(room, p, move.source, move.colour, move.line, true, now);
      break;
    }
    case 'scoring':
      if (room.lastRound) finish(room, 'wall', now);
      else newRound(room, now);
      break;
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Durable rooms ----------------------------------------------------------

/** Rooms of this game are written to `game_rooms` and survive a restart. */
export const durable = { schema: 1 };
export const paces = ['live', 'async'] as const;

/** Who the room is waiting on, with a key that changes for every new decision. */
export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  if (room.phase !== 'playing' || !room.turnId) return null;
  const last = room.last && room.last.by !== room.turnId ? room.players.find((p) => p.id === room.last?.by) : null;
  const line = last && room.last ? `${last.name} took ${plural(room.last.tiles.length, room.last.colour)}. Your turn.` : 'Your turn.';
  return { ids: [room.turnId], key: `${room.turns}:${room.turnId}`, line };
}

/** A live room read back after a restart: the running decision gets its full time again. */
export function resume(room: Room, now: number, _pausedMs: number): void {
  if (room.phase === 'countdown') room.phaseEndsAt = now + COUNTDOWN_MS;
  else if (room.phase === 'scoring') room.phaseEndsAt = now + SCORING_MS;
  else if (room.phase === 'playing') {
    room.turnStartedAt = now;
    room.phaseEndsAt = now + turnMs(room, room.players.find((p) => p.id === room.turnId) ?? null);
  }
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  place: number;
  score: number;
  rows: number;
  bonus: Bonus | null;
  result: 'won' | 'lost' | 'drew' | 'left';
}

export function standings(room: Room): Standing[] {
  const winners = room.result?.winnerIds ?? [];
  const order = [...rank(room, active(room)), ...seated(room).filter((p) => p.status !== 'joined')];
  const shared = winners.length > 1;
  let place = 0;
  let prev: Player | null = null;
  return order.map((p, i) => {
    if (!prev || p.score !== prev.score || rowsOf(p) !== rowsOf(prev)) place = i + 1;
    prev = p;
    const left = p.status !== 'joined';
    return {
      id: p.id,
      name: p.name,
      place: left ? order.length : place,
      score: p.score,
      rows: rowsOf(p),
      bonus: room.bonuses?.[p.id] ?? null,
      result: left ? 'left' : winners.includes(p.id) ? (shared ? 'drew' : 'won') : 'lost',
    };
  });
}

export function winners(room: Room): string[] {
  return room.result?.winnerIds ?? [];
}

// ---- The wire ---------------------------------------------------------------

/**
 * The room as one phone (or the TV board, `meId` '') sees it. Everything on
 * the table is public; only `canPlace` differs, sent to the player whose turn
 * it is: for each colour on offer, the lines it may go on.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const me = room.players.find((p) => p.id === meId) ?? null;
  const myTurn = room.phase === 'playing' && !!me && room.turnId === meId;
  const canPlace: Partial<Record<Colour, number[]>> = {};
  if (myTurn && me) {
    const offered = new Set([...room.factories.flat(), ...room.centre].map((t) => t.c));
    for (const c of COLOURS) if (offered.has(c)) canPlace[c] = legalLines(me, c);
  }
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    table: room.table,
    turnMs: room.pace === 'async' ? room.deadlineHours * 3_600_000 : TURN_MS[room.difficulty],
    deadlineHours: room.pace === 'async' ? room.deadlineHours : null,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    round: room.round,
    lastRound: room.lastRound,
    turnId: room.turnId,
    turnStartedAt: room.turnStartedAt,
    colours: [...COLOURS],
    factories: room.factories.map((f) => f.map((t) => ({ ...t }))),
    centre: room.centre.map((t) => ({ ...t })),
    firstInCentre: room.firstInCentre,
    bag: room.bag.length,
    lid: room.lid.length,
    canPlace,
    last: room.last ? { ...room.last, tiles: [...room.last.tiles], toCentre: [...room.last.toCentre] } : null,
    roundScores: room.roundScores ? room.roundScores.map((s) => ({ ...s, placements: s.placements.map((x) => ({ ...x })) })) : null,
    log: room.log.slice(-8).map((e) => ({ ...e })),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seat: p.seat,
      score: p.score,
      away: p.away > 0,
      lines: p.lines.map((l) => l.map((t) => ({ ...t }))),
      wall: p.wall.map((r) => [...r]),
      floor: p.floor.map((f) => ({ ...f })),
      floorPenalty: floorPenalty(p.floor),
      rows: rowsOf(p),
      hasFirst: p.floor.some((f) => f.c === 'first'),
    })),
    result: room.result ? { ...room.result, winnerIds: [...room.result.winnerIds] } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

/** The TV board's view: the same table, as nobody in particular. */
export function toScreen(room: Room, now: number) {
  return toWire(room, '', now);
}

export type WireRoom = ReturnType<typeof toWire>;
