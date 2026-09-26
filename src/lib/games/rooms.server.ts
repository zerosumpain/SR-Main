// The live rooms: an in-memory map, one timer per room, one emitter per room.
//
// In memory on purpose. Production is a single node process, a room lives for
// minutes, and results are per game only — a table would hold nothing anyone
// reads later. The cost is that a deploy ends the games in progress, which the
// phone reads as the room going away.
//
// The shape copies `$lib/workflows/events.ts`: a map of emitters keyed by id,
// `subscribe` returning its own unsubscribe.

import { error } from '@sveltejs/kit';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import {
  advance,
  again,
  createRoom,
  deadline,
  decline,
  join,
  leave,
  start,
  tap,
  toWire,
  GameError,
  type Difficulty,
  type Room,
  type WireRoom,
} from './tap-duel';

/** A room that closed stays readable briefly, so a phone arriving late sees "closed", not a 404. */
const CLOSED_KEEP_MS = 60_000;
const MAX_ROOMS = 50;
const MAX_OPEN_PER_HOST = 3;

interface Live {
  room: Room;
  emitter: EventEmitter;
  timer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Live>();

export type Action = 'join' | 'decline' | 'leave' | 'start' | 'tap' | 'again';
export const ACTIONS: readonly Action[] = ['join', 'decline', 'leave', 'start', 'tap', 'again'];

function emit(live: Live): void {
  live.emitter.emit('change');
}

/**
 * Advance the room to now, tell its subscribers if it moved, and arm the timer
 * for its next deadline. Every mutation ends here, so the clock never drifts
 * from the state.
 */
function settle(live: Live, changed: boolean): void {
  const now = Date.now();
  if (advance(live.room, now, Math.random)) changed = true;
  if (changed) emit(live);
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;

  const { room } = live;
  if (room.phase === 'closed') {
    live.timer = setTimeout(() => forget(room.id), CLOSED_KEEP_MS);
    live.timer.unref?.();
    return;
  }
  const due = deadline(room);
  if (due === null) return;
  live.timer = setTimeout(() => settle(live, false), Math.max(0, due - Date.now()));
  live.timer.unref?.();
}

function forget(id: string): void {
  const live = rooms.get(id);
  if (!live || live.room.phase !== 'closed') return;
  if (live.timer) clearTimeout(live.timer);
  rooms.delete(id);
  live.emitter.emit('gone');
  live.emitter.removeAllListeners();
}

function get(id: string): Live {
  const live = rooms.get(id);
  if (!live) throw new GameError(404, 'That game has finished.');
  return live;
}

function inRoom(room: Room, playerId: string): boolean {
  return room.players.some((p) => p.id === playerId);
}

export function createGame(input: {
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
}): WireRoom {
  const open = [...rooms.values()].filter((l) => l.room.phase !== 'closed');
  if (open.length >= MAX_ROOMS) throw new GameError(409, 'Too many games running. Try again shortly.');
  if (open.filter((l) => l.room.hostId === input.host.id).length >= MAX_OPEN_PER_HOST) {
    throw new GameError(409, 'Finish one of your games first.');
  }
  const now = Date.now();
  const room = createRoom({ id: 'g_' + randomBytes(6).toString('hex'), ...input, now });
  const live: Live = { room, emitter: new EventEmitter(), timer: null };
  live.emitter.setMaxListeners(20);
  rooms.set(room.id, live);
  settle(live, true);
  return toWire(room, input.host.id, now);
}

export function roomFor(id: string, playerId: string): WireRoom {
  const live = get(id);
  if (!inRoom(live.room, playerId)) throw new GameError(403, 'You are not in this game.');
  return toWire(live.room, playerId, Date.now());
}

export function act(
  id: string,
  playerId: string,
  action: Action,
  input: { round?: number; reactionMs?: number | null; early?: boolean } = {},
): WireRoom {
  const live = get(id);
  const now = Date.now();
  // Catch the room up first: a tap that lands after the window closed must be
  // judged against the closed round, not a timer that has not fired yet.
  advance(live.room, now, Math.random);
  const { room } = live;
  switch (action) {
    case 'join':
      join(room, playerId, now);
      break;
    case 'decline':
      decline(room, playerId, now);
      break;
    case 'leave':
      leave(room, playerId, now);
      break;
    case 'start':
      start(room, playerId, now);
      break;
    case 'again':
      again(room, playerId, now);
      break;
    case 'tap':
      tap(
        room,
        playerId,
        { round: input.round ?? -1, reactionMs: input.reactionMs ?? null, early: input.early === true },
        now,
      );
      break;
  }
  settle(live, true);
  return toWire(room, playerId, Date.now());
}

/** Lobbies this player is invited to and has not answered. */
export function invitesFor(playerId: string) {
  const out = [];
  for (const { room } of rooms.values()) {
    if (room.phase !== 'lobby') continue;
    const me = room.players.find((p) => p.id === playerId);
    if (me?.status !== 'invited') continue;
    const host = room.players.find((p) => p.id === room.hostId);
    out.push({
      roomId: room.id,
      game: room.game,
      difficulty: room.difficulty,
      hostName: host?.name ?? 'Someone',
      players: room.players.filter((p) => p.status === 'joined' || p.status === 'invited').map((p) => p.name),
      expiresAt: room.phaseEndsAt,
    });
  }
  return out;
}

/** Rooms this player is sitting in, so a phone that lost its screen can find its way back. */
export function roomsFor(playerId: string) {
  const out = [];
  for (const { room } of rooms.values()) {
    if (room.phase === 'closed') continue;
    if (!room.players.some((p) => p.id === playerId && p.status === 'joined')) continue;
    const host = room.players.find((p) => p.id === room.hostId);
    out.push({ id: room.id, game: room.game, phase: room.phase, hostName: host?.name ?? 'Someone' });
  }
  return out;
}

/**
 * Follow a room: `onRoom` with this player's view now and on every change,
 * `onGone` once when it is dropped. Returns the unsubscribe.
 */
export function subscribe(
  id: string,
  playerId: string,
  onRoom: (room: WireRoom) => void,
  onGone: () => void,
): () => void {
  const live = get(id);
  if (!inRoom(live.room, playerId)) throw new GameError(403, 'You are not in this game.');
  const change = () => onRoom(toWire(live.room, playerId, Date.now()));
  live.emitter.on('change', change);
  live.emitter.once('gone', onGone);
  change();
  return () => {
    live.emitter.off('change', change);
    live.emitter.off('gone', onGone);
  };
}

/** Tests only. */
export function _resetRooms(): void {
  for (const live of rooms.values()) if (live.timer) clearTimeout(live.timer);
  rooms.clear();
}

/**
 * Run a room call, turning a rules refusal into the HTTP error the native
 * wrapper forwards as `{ error }` with its status — those sentences are written
 * for the person holding the phone.
 */
export function asHttp<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof GameError) error(err.status, err.message);
    throw err;
  }
}
