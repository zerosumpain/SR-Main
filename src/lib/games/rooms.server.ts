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
import { GameError, MAX_PLAYERS, type Difficulty } from './tap-duel';
import { GAMES, type GameId, type GameRules, type RoomBase } from './catalogue';

type WireRoom = ReturnType<GameRules['toWire']>;

/** How long an invite sent from the lobby holds the lobby open for, at least. */
const INVITE_HOLD_MS = 2 * 60_000;

/** A room that closed stays readable briefly, so a phone arriving late sees "closed", not a 404. */
const CLOSED_KEEP_MS = 60_000;
const MAX_ROOMS = 50;
const MAX_OPEN_PER_HOST = 3;

interface Live {
  room: RoomBase;
  rules: GameRules;
  emitter: EventEmitter;
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Invitees whose phone has fetched the invite — by the app's poll, which is
   * the one thing the host can be told about whether it got there.
   */
  sawInvite: Set<string>;
  /**
   * Invitees an APNs push reached (`invite-push.server`). Told to their phone
   * with the invite, so its poll does not raise a second banner for it.
   */
  pushed: Set<string>;
}

/** The room as `playerId` sees it, with who has had their invite. */
function wire(live: Live, playerId: string, now = Date.now()): WireRoom {
  const out = live.rules.toWire(live.room, playerId, now) as WireRoom & { players?: { id: string }[] };
  if (!Array.isArray(out.players)) return out;
  return { ...out, players: out.players.map((p) => ({ ...p, sawInvite: live.sawInvite.has(p.id) })) } as WireRoom;
}

const rooms = new Map<string, Live>();

/** The lobby verbs every game shares; anything else is one of the game's own moves. */
const VERBS = ['join', 'decline', 'leave', 'start', 'again'] as const;
type Verb = (typeof VERBS)[number];
const isVerb = (a: string): a is Verb => (VERBS as readonly string[]).includes(a);

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
  if (live.rules.advance(live.room, now, Math.random)) changed = true;
  if (changed) emit(live);
  const { room } = live;
  if (room.phase === 'closed' && live.timer && !changed) return;
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;

  if (room.phase === 'closed') {
    // Nothing reopens a closed room (`act` refuses it), so this is armed once.
    live.timer = setTimeout(() => forget(room.id), CLOSED_KEEP_MS);
    live.timer.unref?.();
    return;
  }
  const due = live.rules.deadline(room);
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

function inRoom(room: RoomBase, playerId: string): boolean {
  return room.players.some((p) => p.id === playerId);
}

/**
 * Throw the refusal `createGame` would, without creating anything — so a
 * caller that meters creation (Quiz Night's daily cap) can ask first and not
 * charge for a game that was never going to start.
 */
export function canCreate(hostId: string): void {
  const open = [...rooms.values()].filter((l) => l.room.phase !== 'closed' && l.room.phase !== 'finished');
  if (open.length >= MAX_ROOMS) throw new GameError(409, 'Too many games running. Try again shortly.');
  if (open.filter((l) => l.room.hostId === hostId).length >= MAX_OPEN_PER_HOST) {
    throw new GameError(409, 'Finish one of your games first.');
  }
}

export function createGame(input: {
  game: GameId;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
}): WireRoom {
  // A finished game waits ten minutes for "Play again"; it is not one the host is still running.
  canCreate(input.host.id);
  const now = Date.now();
  const rules = GAMES[input.game];
  const room = rules.createRoom({
    id: 'g_' + randomBytes(6).toString('hex'),
    host: input.host,
    invite: input.invite,
    difficulty: input.difficulty,
    options: input.options,
    now,
  });
  const live: Live = { room, rules, emitter: new EventEmitter(), timer: null, sawInvite: new Set(), pushed: new Set() };
  live.emitter.setMaxListeners(20);
  rooms.set(room.id, live);
  settle(live, true);
  if (rules.prepare) {
    void rules
      .prepare(room)
      .catch((err) => console.error(`[games] ${room.id}: prepare failed`, err))
      .finally(() => {
        if (rooms.get(room.id) === live && live.room.phase !== 'closed') settle(live, true);
      });
  }
  return wire(live, input.host.id, now);
}

export function roomFor(id: string, playerId: string): WireRoom {
  const live = get(id);
  if (!inRoom(live.room, playerId)) throw new GameError(403, 'You are not in this game.');
  return wire(live, playerId);
}

/**
 * One action from a player: a lobby verb (join, decline, leave, start, again)
 * or one of the game's own moves (`tap`, `guess`), with the body it came in.
 */
export function act(id: string, playerId: string, action: string, body: Record<string, unknown> = {}): WireRoom {
  const live = get(id);
  const { rules } = live;
  const move = isVerb(action) ? null : rules.moves[action];
  if (!isVerb(action) && !move) throw new GameError(400, 'Unknown action.');
  const now = Date.now();
  // Catch the room up first: a tap that lands after the window closed must be
  // judged against the closed round, not a timer that has not fired yet. What
  // that moved is sent whether or not the action itself is then refused —
  // otherwise the round's result goes to nobody.
  const moved = rules.advance(live.room, now, Math.random);
  const { room } = live;
  if (room.phase === 'closed') {
    settle(live, moved);
    throw new GameError(409, 'That game has finished.');
  }
  try {
    if (move) move(room, playerId, body, now);
    else rules[action as Verb](room, playerId, now);
    // "Play again" asks everyone afresh: nobody has had THAT invite yet.
    if (action === 'again') {
      live.sawInvite.clear();
      live.pushed.clear();
    }
  } catch (err) {
    settle(live, moved);
    throw err;
  }
  settle(live, true);
  return wire(live, playerId);
}

/**
 * The host asks more people in while the lobby is open. Somebody who declined
 * or left is asked again; somebody already in or invited is left alone. The
 * lobby is held open at least INVITE_HOLD_MS from now, so an invite sent in
 * its last seconds still has time to be answered.
 */
export function inviteTo(id: string, hostId: string, people: { id: string; name: string }[]): WireRoom {
  const live = get(id);
  const now = Date.now();
  const moved = live.rules.advance(live.room, now, Math.random);
  const { room } = live;
  const refuse = (status: ConstructorParameters<typeof GameError>[0], message: string) => {
    settle(live, moved);
    return new GameError(status, message);
  };
  if (room.hostId !== hostId) throw refuse(403, 'Only the host can invite.');
  if (room.phase !== 'lobby') throw refuse(409, 'That game has already started.');
  const inPlay = (s: string) => s === 'joined' || s === 'invited';
  const fresh = people.filter((p, i, all) => p.id !== hostId && all.findIndex((q) => q.id === p.id) === i);
  const adding = fresh.filter((p) => !room.players.some((q) => q.id === p.id && inPlay(q.status)));
  if (room.players.filter((p) => inPlay(p.status)).length + adding.length > MAX_PLAYERS) {
    throw refuse(400, `Up to ${MAX_PLAYERS} players.`);
  }
  for (const p of adding) {
    const known = room.players.find((q) => q.id === p.id);
    if (known) known.status = 'invited';
    else room.players.push(live.rules.player(p.id, p.name, 'invited'));
    live.sawInvite.delete(p.id);
    live.pushed.delete(p.id);
  }
  if (adding.length) room.phaseEndsAt = Math.max(room.phaseEndsAt ?? 0, now + INVITE_HOLD_MS);
  settle(live, moved || adding.length > 0);
  return wire(live, hostId);
}

/** Lobbies this player is invited to and has not answered. */
export function invitesFor(playerId: string) {
  const out = [];
  for (const live of rooms.values()) {
    const { room, rules } = live;
    if (room.phase !== 'lobby') continue;
    const me = room.players.find((p) => p.id === playerId);
    if (me?.status !== 'invited') continue;
    // This read IS the delivery: the phone raises its notification from it.
    if (!live.sawInvite.has(playerId)) {
      live.sawInvite.add(playerId);
      emit(live);
    }
    const host = room.players.find((p) => p.id === room.hostId);
    out.push({
      roomId: room.id,
      game: room.game,
      difficulty: room.difficulty,
      about: rules.about?.(room) ?? null,
      hostName: host?.name ?? 'Someone',
      players: room.players.filter((p) => p.status === 'joined' || p.status === 'invited').map((p) => p.name),
      expiresAt: room.phaseEndsAt,
      // A push already rang for this one; the phone lists it without a banner.
      pushed: live.pushed.has(playerId),
    });
  }
  return out;
}

/**
 * An open lobby's invitees nobody has pushed to yet, with what a banner says
 * about the room. Null when the room is gone or no longer a lobby.
 */
export function unpushedInvites(id: string): {
  roomId: string;
  game: GameId;
  difficulty: Difficulty;
  about: string | null;
  hostName: string;
  players: string[];
  invitees: string[];
  expiresAt: number | null;
} | null {
  const live = rooms.get(id);
  if (!live || live.room.phase !== 'lobby') return null;
  const { room, rules } = live;
  const host = room.players.find((p) => p.id === room.hostId);
  return {
    roomId: room.id,
    game: room.game,
    difficulty: room.difficulty,
    about: rules.about?.(room) ?? null,
    hostName: host?.name ?? 'Someone',
    players: room.players.filter((p) => p.status === 'joined' || p.status === 'invited').map((p) => p.name),
    invitees: room.players.filter((p) => p.status === 'invited' && !live.pushed.has(p.id)).map((p) => p.id),
    expiresAt: room.phaseEndsAt ?? null,
  };
}

/** Record that a push reached these invitees' phones. */
export function markInvitesPushed(id: string, playerIds: readonly string[]): void {
  const live = rooms.get(id);
  if (!live) return;
  for (const p of playerIds) live.pushed.add(p);
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
  const change = () => onRoom(wire(live, playerId));
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
