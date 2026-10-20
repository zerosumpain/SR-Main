// Marble Race — the rules, as pure functions over a room.
//
// Marbler (strangeramblings.com/projects/marbler) is a deterministic physics
// race: the same course and run seed give the same race, step for step, on
// any phone. So the server runs nothing. It deals the seed and a start time
// AHEAD, each phone builds the race and steps it to that clock, and each
// phone reports the finish order it saw. Phones that agree are the result;
// if they ever disagree the majority stands and the round says so.
//
// Each player backs one marble (no two the same). Whoever hasn't picked when
// picking closes is given a free marble, so nobody watches without a horse.
// The family winner is whoever backed the best-placed marble.

import { GameError, type Difficulty, type PlayerStatus, type Rng } from './tap-duel';

export type Phase = 'lobby' | 'picking' | 'racing' | 'finished' | 'closed';

export const MAX_PLAYERS = 5;
export const LOBBY_MS = 3 * 60_000;
/** Time to back a marble; closes early once everyone has. */
export const PICK_MS = 25_000;
/** From the seed being dealt to step 0: every phone has it, and has loaded the course, before the race. */
export const START_LEAD_MS = 6_000;
/** Longest a race may run before the room stops waiting for reports. */
export const MAX_RACE_MS = 20 * 60_000;
/** After the recorded race's length, how long the room waits for every phone (a fresh seed runs longer or shorter). */
export const RACE_SLACK = 3;
export const FINISHED_MS = 10 * 60_000;

/** A course from Marbler's pack, as the host's phone chose it. */
export interface Course {
  id: string;
  name: string;
  marbles: number;
  /** How long the pack's recorded race took, in seconds: sets how long to wait for reports. */
  seconds: number;
}

/** When the host's phone sends no course: the pack's first course. */
export const DEFAULT_COURSE: Course = { id: 'c9001', name: 'Paper Mill', marbles: 10, seconds: 173 };

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** The marble this player backs (index into the course's field), or null. */
  marble: number | null;
  /** The finish order this player's phone reported (marble indices), or null. */
  report: number[] | null;
}

export interface Room {
  id: string;
  game: 'marble-race';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  course: Course;
  /** Dealt when picking closes. */
  seed: number | null;
  /** Epoch ms of the race's step 0. */
  startAt: number | null;
  /** The agreed finish order, once the race is settled. */
  result: number[] | null;
  /** True when some phone reported a different order from the one that stood. */
  disputed: boolean;
  /** Lobby expiry, picking end, race deadline, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, marble: null, report: null };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

/** A course from the create request, checked; the default when there is none. */
export function parseCourse(value: unknown): Course {
  if (value === undefined || value === null) return { ...DEFAULT_COURSE };
  const c = value as Record<string, unknown>;
  const id = typeof c.id === 'string' && /^[a-z]\d{1,8}$/.test(c.id) ? c.id : null;
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, 60) : '';
  const marbles = typeof c.marbles === 'number' && Number.isInteger(c.marbles) ? c.marbles : NaN;
  const seconds = typeof c.seconds === 'number' && Number.isFinite(c.seconds) ? Math.round(c.seconds) : NaN;
  if (!id || !name || !(marbles >= 2 && marbles <= 30) || !(seconds >= 10 && seconds <= 3_600)) {
    throw new GameError(400, 'That course is not one Marbler knows.');
  }
  return { id, name, marbles, seconds };
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
  return {
    id: input.id,
    game: 'marble-race',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    course: parseCourse(input.options?.course),
    seed: null,
    startAt: null,
    result: null,
    disputed: false,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** "Rusted Foundry, 11 marbles" — the invite banner's line. */
export function about(room: Room): string | null {
  return `${room.course.name}, ${room.course.marbles} marbles`;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That race has already started.');
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
 * Leaving the lobby as host cancels the race. Leaving later hands the host
 * role on, frees the marble if picking is still open, and no longer waits
 * for that phone's report; the last one out closes the room.
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
  if (room.phase === 'picking') p.marble = null;
  if (room.phase === 'racing') settleIfReported(room, now);
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That race has already started.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'picking';
  room.phaseEndsAt = now + PICK_MS;
  room.updatedAt = now;
}

/** The host races again with whoever is still here, on the same course; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This race is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.marble = null;
    p.report = null;
  }
  room.phase = 'lobby';
  room.seed = null;
  room.startAt = null;
  room.result = null;
  room.disputed = false;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

/** The host picks another course, in the lobby. */
export function chooseCourse(room: Room, playerId: string, course: unknown, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host picks the course.');
  if (room.phase !== 'lobby') throw new GameError(409, 'The course is set once the race starts.');
  room.course = parseCourse(course);
  room.updatedAt = now;
}

/** Back a marble. Each marble has one backer; picking again swaps. */
export function back(room: Room, playerId: string, marble: unknown, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not in this race.');
  if (room.phase !== 'picking') throw new GameError(409, 'Picking is over.');
  if (typeof marble !== 'number' || !Number.isInteger(marble) || marble < 0 || marble >= room.course.marbles) {
    throw new GameError(400, 'There is no such marble.');
  }
  if (room.players.some((q) => q.id !== playerId && q.status === 'joined' && q.marble === marble)) {
    throw new GameError(409, 'Somebody already backs that marble.');
  }
  p.marble = marble;
  room.updatedAt = now;
  // Everyone has picked: close picking now. The registry's advance, right after
  // this move, deals the race with its own rng (rules never draw their own).
  if (joined(room).every((q) => q.marble !== null)) room.phaseEndsAt = now;
}

/**
 * Picking is over: anybody without a marble is given a free one, and the
 * race is dealt — a run seed and a start time a few seconds ahead, so every
 * phone has both before step 0.
 */
function deal(room: Room, now: number, rng: Rng): void {
  const taken = new Set(joined(room).map((p) => p.marble).filter((m): m is number => m !== null));
  for (const p of joined(room)) {
    if (p.marble !== null) continue;
    const free = Array.from({ length: room.course.marbles }, (_, m) => m).filter((m) => !taken.has(m));
    p.marble = free[Math.floor(rng() * free.length)] ?? null;
    if (p.marble !== null) taken.add(p.marble);
  }
  room.seed = Math.floor(rng() * 0x1_0000_0000) >>> 0;
  room.startAt = now + START_LEAD_MS;
  room.phase = 'racing';
  const waitMs = Math.min(MAX_RACE_MS, room.course.seconds * 1000 * RACE_SLACK);
  room.phaseEndsAt = room.startAt + waitMs;
  room.updatedAt = now;
}

/**
 * A phone saw the race end: its finish order, by marble index. The server
 * only refuses the impossible (not a full, once-each order of the field).
 */
export function finish(room: Room, playerId: string, order: unknown, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not in this race.');
  if (room.phase !== 'racing') throw new GameError(409, 'That race is over.');
  const n = room.course.marbles;
  if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || !order.every((m) => Number.isInteger(m) && m >= 0 && m < n)) {
    throw new GameError(400, 'A finish order names every marble once.');
  }
  if (p.report) return;
  p.report = order as number[];
  room.updatedAt = now;
  settleIfReported(room, now);
}

function settleIfReported(room: Room, now: number): void {
  if (joined(room).every((p) => p.report !== null)) settle(room, now);
}

/** The order most phones reported stands (ties: the host's, then the first). */
function settle(room: Room, now: number): void {
  const reports = room.players.filter((p) => p.report !== null);
  const counts = new Map<string, { order: number[]; votes: number; host: boolean }>();
  for (const p of reports) {
    const key = p.report!.join(',');
    const c = counts.get(key) ?? { order: p.report!, votes: 0, host: false };
    c.votes++;
    c.host ||= p.id === room.hostId;
    counts.set(key, c);
  }
  const best = [...counts.values()].sort((a, b) => b.votes - a.votes || Number(b.host) - Number(a.host))[0];
  room.result = best?.order ?? null;
  room.disputed = counts.size > 1;
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
      case 'picking':
        deal(room, due, rng);
        break;
      case 'racing':
        // Not every phone reported in time: what was reported stands.
        settle(room, due);
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  return room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  marble: number | null;
  /** Where the backed marble finished (1 = first), or null with no result. */
  place: number | null;
  /** One point for every marble yours beat, plus one: higher is better. */
  score: number;
}

/** Best-placed marble first. */
export function standings(room: Room): Standing[] {
  const n = room.course.marbles;
  return room.players
    .filter((p) => p.status === 'joined' || p.marble !== null)
    .map((p) => {
      const at = p.marble === null || !room.result ? -1 : room.result.indexOf(p.marble);
      const place = at < 0 ? null : at + 1;
      return { id: p.id, name: p.name, marble: p.marble, place, score: place === null ? 0 : n - place + 1 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Nobody wins alone, and nobody wins without a result. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score === 0) return [];
  return [list[0].id];
}

/** The room as one player's phone sees it. Everyone's picks are public; that's the fun. */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      marble: p.marble,
      reported: p.report !== null,
    })),
    course: room.course,
    race: room.seed !== null && room.startAt !== null ? { seed: room.seed, startAt: room.startAt } : null,
    result: finished ? { order: room.result, disputed: room.disputed } : null,
    phaseEndsAt: room.phaseEndsAt,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
