// Biscuit Tower — the rules, as pure functions over a room.
//
// A physics game for the TV. Players take turns: a crane swings an item —
// a custard cream, a bourbon, a mug, a teapot, a Darlington brick — back and
// forth above a tower on the TV, and the player whose turn it is taps DROP on
// their phone. The TV runs the physics (Rapier 2D, in the browser) and reports
// what happened: the item settled and the tower is this tall, or the tower
// toppled. A settled drop scores; a topple ends the round. Three rounds.
//
// The swing is a pure function of time (`craneX`), so the phone, the TV and
// the server agree where the item was when DROP was tapped. The TV is the
// authority on the physics because it is the one drawing it, and it is a
// linked device (`party.server`): its report is a move only the party's TV can
// send (`SCREEN_ACTOR`). A TV that never reports — switched off mid-drop — is
// not waited on: the drop counts as settled after `REPORT_MS`.

import { GameError, isDifficulty, DIFFICULTIES, type Difficulty, type PlayerStatus, type Rng } from './tap-duel';

export { GameError, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'aiming' | 'falling' | 'toppled' | 'finished' | 'closed';

/** The id a TV's report is acted under. Never a player's id (`p_`/`v_`), and refused from any phone. */
export const SCREEN_ACTOR = 'screen';

export const ROUNDS = 3;
export const maxPlayers = 8;
export const minPlayers = 1;
export const LOBBY_MS = 3 * 60_000;
export const COUNTDOWN_MS = 3_000;
/** A turn's time to tap DROP; at the end the item drops wherever the crane is. */
export const AIM_MS = 9_000;
/** How long the TV may take to say how a drop landed before it counts as settled. */
export const REPORT_MS = 9_000;
/** Between a topple and the next round's first turn. */
export const TOPPLED_MS = 5_000;
export const FINISHED_MS = 10 * 60_000;
/** A round stops growing here, however steady the hands. */
export const MAX_DROPS = 40;

/** The items, by how hard they are to land. The TV draws and weighs them (`biscuit-tower-physics.ts`). */
export const ITEMS = {
  custard: { label: 'a custard cream', hard: 0 },
  bourbon: { label: 'a bourbon', hard: 0 },
  digestive: { label: 'a digestive', hard: 0 },
  scone: { label: 'a scone', hard: 1 },
  brick: { label: 'a Darlington brick', hard: 1 },
  toast: { label: 'a slice of toast', hard: 1 },
  mug: { label: 'a mug of tea', hard: 2 },
  teapot: { label: 'the teapot', hard: 2 },
  kettle: { label: 'the kettle', hard: 2 },
} as const;
export type Item = keyof typeof ITEMS;
export const ITEM_IDS = Object.keys(ITEMS) as Item[];

interface Tuning {
  /** One full swing, there and back. */
  periodMs: number;
  /** Highest item difficulty dealt early in a round; harder ones arrive as the tower grows. */
  hardFrom: [number, number];
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { periodMs: 3_600, hardFrom: [6, 14] },
  medium: { periodMs: 2_700, hardFrom: [4, 10] },
  hard: { periodMs: 1_900, hardFrom: [2, 6] },
};

/** Where the crane is at `t`: -1 (far left) to 1 (far right), a sine from the turn's start. */
export function craneX(t: number, startsAt: number, periodMs: number): number {
  return Math.sin((2 * Math.PI * (t - startsAt)) / periodMs);
}

export interface Drop {
  turn: number;
  playerId: string;
  item: Item;
  /** Where the crane was when it let go. */
  x: number;
  outcome: 'settled' | 'toppled' | null;
  /** The tower's height after it, in item heights, as the TV measured it. */
  height: number | null;
}

export interface Turn {
  number: number;
  playerId: string;
  item: Item;
  startsAt: number;
  endsAt: number;
  droppedAt: number | null;
  x: number | null;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  topples: number;
}

export interface Room {
  id: string;
  game: 'biscuit-tower';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  rounds: number;
  round: number;
  /** Whose turn comes next: an index into the joined players, carried across rounds. */
  next: number;
  turn: Turn | null;
  /** This round's drops, in order (the TV rebuilds the tower from them after a reload). */
  drops: Drop[];
  /** Tallest tower of the game, in item heights, and who topped it. */
  best: { height: number; playerId: string } | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0, topples: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > maxPlayers - 1) throw new GameError(400, `Up to ${maxPlayers} players.`);
  return {
    id: input.id,
    game: 'biscuit-tower',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    rounds: ROUNDS,
    round: 0,
    next: 0,
    turn: null,
    drops: [],
    best: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function about(room: Room): string {
  return `${room.rounds} rounds · ${room.difficulty}`;
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

export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.score = 0;
    p.topples = 0;
  }
  Object.assign(room, { phase: 'lobby', round: 0, next: 0, turn: null, drops: [], best: null, phaseEndsAt: now + LOBBY_MS, createdAt: now, updatedAt: now });
}

/** The item for the drop after `count` in this round: biscuits first, the awkward things as the tower grows. */
export function itemFor(count: number, difficulty: Difficulty, rng: Rng): Item {
  const [lo, hi] = TUNING[difficulty].hardFrom;
  const most = count < lo ? 0 : count < hi ? 1 : 2;
  const pool = ITEM_IDS.filter((i) => ITEMS[i].hard <= most);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

function openTurn(room: Room, now: number, rng: Rng): void {
  const people = joined(room);
  if (!people.length) {
    close(room, now);
    return;
  }
  const who = people[room.next % people.length];
  room.next = (room.next + 1) % people.length;
  room.turn = { number: (room.turn?.number ?? 0) + 1, playerId: who.id, item: itemFor(room.drops.length, room.difficulty, rng), startsAt: now, endsAt: now + AIM_MS, droppedAt: null, x: null };
  room.phase = 'aiming';
  room.phaseEndsAt = room.turn.endsAt;
  room.updatedAt = now;
}

function newRound(room: Room, now: number, rng: Rng): void {
  room.round += 1;
  room.drops = [];
  openTurn(room, now, rng);
}

function letGo(room: Room, at: number, now: number): void {
  const t = room.turn!;
  t.droppedAt = at;
  t.x = craneX(at, t.startsAt, TUNING[room.difficulty].periodMs);
  room.drops.push({ turn: t.number, playerId: t.playerId, item: t.item, x: t.x, outcome: null, height: null });
  room.phase = 'falling';
  room.phaseEndsAt = now + REPORT_MS;
  room.updatedAt = now;
}

/**
 * The player whose turn it is taps DROP: `at` is when, on the server's clock
 * as the phone reckons it (believed within a few seconds of now, and never
 * before the turn or after it).
 */
export function drop(room: Room, playerId: string, input: { turn: unknown; at: unknown }, now: number): void {
  find(room, playerId);
  const t = room.turn;
  if (room.phase !== 'aiming' || !t || t.number !== input.turn) throw new GameError(409, 'That turn is over.');
  if (t.playerId !== playerId) throw new GameError(409, 'It is not your turn.');
  const said = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : now;
  const at = Math.min(t.endsAt, Math.max(t.startsAt, Math.abs(said - now) > 4_000 ? now : said));
  letGo(room, at, now);
}

/**
 * The TV says how the last drop landed: `settled` with the tower's height, or
 * `toppled`. Only the party's TV sends this (`SCREEN_ACTOR`).
 */
export function report(room: Room, actor: string, input: { turn: unknown; outcome: unknown; height: unknown }, now: number, rng: Rng = Math.random): void {
  if (actor !== SCREEN_ACTOR) throw new GameError(403, 'Only the TV reports a drop.');
  const t = room.turn;
  if (room.phase !== 'falling' || !t || t.number !== input.turn) return;
  const outcome = input.outcome === 'toppled' ? 'toppled' : 'settled';
  const height = typeof input.height === 'number' && Number.isFinite(input.height) ? Math.max(0, Math.min(200, Math.round(input.height * 10) / 10)) : null;
  land(room, outcome, height, now, rng);
}

function land(room: Room, outcome: 'settled' | 'toppled', height: number | null, now: number, rng: Rng): void {
  const t = room.turn!;
  const d = room.drops[room.drops.length - 1];
  d.outcome = outcome;
  d.height = height;
  const p = room.players.find((x) => x.id === t.playerId);
  if (outcome === 'settled') {
    if (p) p.score += 1;
    if (height !== null && (!room.best || height > room.best.height)) room.best = { height, playerId: t.playerId };
    if (room.drops.length >= MAX_DROPS) roundOver(room, now);
    else openTurn(room, now, rng);
    return;
  }
  if (p) p.topples += 1;
  roundOver(room, now);
}

function roundOver(room: Room, now: number): void {
  room.phase = room.round >= room.rounds ? 'finished' : 'toppled';
  room.phaseEndsAt = now + (room.phase === 'finished' ? FINISHED_MS : TOPPLED_MS);
  room.updatedAt = now;
}

export function advance(room: Room, now: number, rng: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 40; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        newRound(room, due, rng);
        break;
      case 'aiming':
        // Nobody tapped: it drops wherever the crane is when time runs out.
        letGo(room, room.turn!.endsAt, due);
        break;
      case 'falling':
        // The TV never said: count it as settled, the tower a little taller.
        land(room, 'settled', null, due, rng);
        break;
      case 'toppled':
        newRound(room, due, rng);
        break;
    }
  }
  return changed;
}

export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  return room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  topples: number;
}

/** Most items landed first; fewer topples breaks a tie. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.score > 0 || p.topples > 0)
    .map((p) => ({ id: p.id, name: p.name, score: p.score, topples: p.topples }))
    .sort((a, b) => b.score - a.score || a.topples - b.topples);
}

export function winners(list: Standing[]): string[] {
  if (!list.length || list[0].score <= 0) return [];
  return list.filter((s) => s.score === list[0].score && s.topples === list[0].topples).map((s) => s.id);
}

function common(room: Room, now: number) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    rounds: room.rounds,
    round: room.round,
    periodMs: TUNING[room.difficulty].periodMs,
    players: room.players.map((p) => ({ id: p.id, name: p.name, status: p.status, score: p.score, topples: p.topples, isHost: p.id === room.hostId })),
    turn: room.turn ? { ...room.turn, itemLabel: ITEMS[room.turn.item].label } : null,
    drops: room.drops,
    best: room.best,
    phaseEndsAt: room.phaseEndsAt,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

/** Everything here is on the TV anyway: the phone sees what the TV sees, and whether it is their turn. */
export function toWire(room: Room, meId: string, now: number) {
  return { ...common(room, now), meId, myTurn: room.phase === 'aiming' && room.turn?.playerId === meId };
}

export type WireRoom = ReturnType<typeof toWire>;

export function toScreen(room: Room, now: number) {
  return common(room, now);
}

export type ScreenRoom = ReturnType<typeof toScreen>;
