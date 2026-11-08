// Manhunt — real-world hide-and-seek on the map, as pure functions over a room.
//
// Same shape as Liar's Dice (`liars-dice.ts`): every function takes `now`
// (epoch ms) and, where it deals, a `rng`, so a whole hunt plays in a test
// without a clock or a phone. The registry owns timers and fan-out.
//
// One runner, everyone else hunts. The host (a parent or the owner — the
// registry's door checks that, `api.server.ts`) sets a circle centred on where
// they stand and a length of game. After a two-minute head start the hunters
// see each other live, but the runner only at a PING (every 5 / 3 / 2 minutes
// on easy / medium / hard) — and live for 30 s after any fix of theirs that
// lands outside the circle. The runner sees the hunters only at the pings. A
// hunter close enough to the runner's latest fix claims the catch; the runner
// confirms it, or the server accepts it after 20 s. Time running out wins it
// for the runner.
//
// PRIVACY. Positions live in this room object and nowhere else: never a
// journey, a history row, the database or a log line. The finished room drops
// every fix and ping, and the leaderboard reads standings that carry none.
// Hidden information is per viewer in `toWire`; the test builds the wire for
// every player and searches the JSON for everyone else's coordinates.

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

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'headstart' | 'hunt' | 'finished' | 'closed';
export type Role = 'runner' | 'hunter';

/** One runner and at least two hunters. */
export const MIN_PLAYERS = 3;
/** The registry reads this instead of the shared five (`GameRules.maxPlayers`). */
export const maxPlayers = 8;

export const RADIUS_MIN_M = 250;
export const RADIUS_MAX_M = 2_000;
export const DEFAULT_RADIUS_M = 500;
export const MINUTES_MIN = 15;
export const MINUTES_MAX = 60;
export const DEFAULT_MINUTES = 30;

/** The hunters wait this long, seeing nobody, while the runner gets away. */
export const HEADSTART_MS = 2 * 60_000;
/** How often the runner's position is shown to the hunters (and theirs to the runner). */
export const PING_MS: Record<Difficulty, number> = {
  easy: 5 * 60_000,
  medium: 3 * 60_000,
  hard: 2 * 60_000,
};
/** A runner outside the circle is live to the hunters until this long after their last fix outside. */
export const OUTSIDE_LIVE_MS = 30_000;

/** How close a hunter's fix must be to the runner's for a catch, before accuracy. */
export const CATCH_M = 25;
/** The most GPS accuracy may add to CATCH_M (the larger of the two fixes' radii, capped). */
export const CATCH_SLACK_M = 25;
/** A hunter's own fix must be this fresh, and this sharp, to claim a catch. */
export const CATCH_FIX_FRESH_MS = 30_000;
export const CATCH_FIX_ACCURACY_M = 50;
/** The runner has this long to confirm a claimed catch before the server accepts it. */
export const CLAIM_MS = 20_000;
/** A hunter whose claim was too far away waits this long to try again. */
export const CATCH_COOLDOWN_MS = 30_000;
/** A runner with no fix for this long has "gone quiet": a claim against them skips the distance check. */
export const RUNNER_QUIET_MS = 60_000;

/** Fixes closer together than this, from one phone, are ignored. */
export const FIX_MIN_GAP_MS = 3_000;
/** A fix older than this when it arrives is ignored. */
export const FIX_MAX_AGE_MS = 60_000;

// ---- Geometry ------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points on the earth (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Area extends LatLng {
  radiusM: number;
}

/**
 * Outside the circle: further from the centre than the radius by more than
 * the fix's own uncertainty (capped at CATCH_SLACK_M), so GPS jitter at the
 * edge does not expose a runner who is standing on the line.
 */
export function isOutside(area: Area, fix: Fix): boolean {
  return distanceM(area, fix) - Math.min(CATCH_SLACK_M, fix.accuracy) > area.radiusM;
}

/**
 * Close enough to catch: the fixes are within CATCH_M plus the larger of the
 * two accuracy radii, the extra capped at CATCH_SLACK_M. So two sharp fixes
 * (5 m) must be within 30 m; two rough ones never further than 50 m.
 */
export function withinCatch(hunter: Fix, runner: Fix): boolean {
  const slack = Math.min(CATCH_SLACK_M, Math.max(hunter.accuracy, runner.accuracy));
  return distanceM(hunter, runner) <= CATCH_M + slack;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function latLng(lat: unknown, lng: unknown): LatLng | null {
  if (!finite(lat) || !finite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const clampRound = (v: unknown, lo: number, hi: number, step: number, fallback: number): number =>
  finite(v) ? Math.min(hi, Math.max(lo, Math.round(v / step) * step)) : fallback;

/** The circle's radius from a request: 250 m to 2 km, to the nearest 10 m. */
export const radiusFrom = (v: unknown): number => clampRound(v, RADIUS_MIN_M, RADIUS_MAX_M, 10, DEFAULT_RADIUS_M);
/** The game's length from a request: 15 to 60 minutes, whole minutes. */
export const minutesFrom = (v: unknown): number => clampRound(v, MINUTES_MIN, MINUTES_MAX, 1, DEFAULT_MINUTES);

// ---- The room ------------------------------------------------------------

export interface Fix extends LatLng {
  /** Metres, the phone's horizontal accuracy. */
  accuracy: number;
  /** When the phone took it, clamped to the server's clock. */
  at: number;
  /** When the server took it: the rate limit and freshness run on this. */
  receivedAt: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** In the hunt when it began: the ones standings are about. */
  seated: boolean;
  role: Role | null;
  /** The latest fix. Held in this room only; dropped when the game ends or they leave. */
  fix: Fix | null;
  /** A hunter whose claim was too far away may not claim again until then. */
  cooldownUntil: number | null;
}

export interface Ping {
  at: number;
  /** The runner's latest fix at the ping — for the hunters. */
  runner: Fix | null;
  /** Each hunter's latest fix at the ping — for the runner. */
  hunters: { id: string; fix: Fix | null }[];
}

export interface Claim {
  hunterId: string;
  at: number;
  /** Accepted by the server at this time unless the runner confirms first. */
  deadline: number;
  /** The runner had gone quiet: the claim was taken on the hunter's word. */
  quiet: boolean;
}

export type Outcome = 'caught' | 'time' | 'runner-left' | 'hunters-left';

export interface Result {
  outcome: Outcome;
  /** The hunter who made the catch; null otherwise. */
  catcherId: string | null;
  /** The runner confirmed (false: the server accepted it at the claim's deadline). */
  confirmed: boolean;
  at: number;
}

export interface Room {
  id: string;
  game: 'manhunt';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** The play area. Null until the host's phone has sent where it is. */
  area: Area | null;
  /** The radius and length the host picked — plain numbers the leaderboard keeps. */
  radius: number;
  minutes: number;
  /** The host's pick for runner; null draws one at the start. */
  runnerPick: string | null;
  /** Who is running this hunt; null before the countdown ends. */
  runnerId: string | null;
  /** When the head start began (the countdown's end). */
  startedAt: number | null;
  /** When the hunt proper began (the head start's end). */
  huntStartedAt: number | null;
  /** When time runs out for the hunters. */
  endsAt: number | null;
  pings: Ping[];
  /** The runner is live to the hunters until then (they were outside). */
  liveUntil: number | null;
  claim: Claim | null;
  result: Result | null;
  /** Lobby expiry, countdown end, head start end, hunt end, finished expiry. */
  phaseEndsAt: number | null;
  /**
   * Players the server has checked are parents (the host who made the room,
   * and anyone the API marks with `noteParent` as they join). The host role
   * passes to one of them first. Never on the wire.
   */
  parents: string[];
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seated: false, role: null, fix: null, cooldownUntil: null };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

const inGame = (p: Player) => p.seated && p.status === 'joined';

export function runner(room: Room): Player | null {
  const p = room.players.find((x) => x.id === room.runnerId);
  return p && inGame(p) ? p : null;
}

export function hunters(room: Room): Player[] {
  return room.players.filter((p) => inGame(p) && p.role === 'hunter');
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
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter(
    (p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > maxPlayers - 1) throw new GameError(400, `Up to ${maxPlayers} players.`);
  const o = input.options ?? {};
  const radius = radiusFrom(o.radius);
  const centre = latLng(o.lat, o.lng);
  return {
    id: input.id,
    game: 'manhunt',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    area: centre ? { ...centre, radiusM: radius } : null,
    radius,
    minutes: minutesFrom(o.minutes),
    runnerPick: null,
    runnerId: null,
    startedAt: null,
    huntStartedAt: null,
    endsAt: null,
    pings: [],
    liveUntil: null,
    claim: null,
    result: null,
    phaseEndsAt: input.now + LOBBY_MS,
    // Only a parent may make a Manhunt room (the API checks before it gets here).
    parents: [input.host.id],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** "500 m" or "1.5 km". */
export function radiusLabel(m: number): string {
  return m >= 1_000 ? `${Number((m / 1_000).toFixed(1))} km` : `${m} m`;
}

/** The invite banner's line: "500 m · 30 min · a ping every 3 min". Never a coordinate. */
export function about(room: Room): string {
  return `${radiusLabel(room.radius)} · ${room.minutes} min · a ping every ${PING_MS[room.difficulty] / 60_000} min`;
}

/** The rule in a sentence, for the phone. */
export function ruleLine(difficulty: Difficulty): string {
  const mins = PING_MS[difficulty] / 60_000;
  return `The runner shows up every ${mins} min, and live whenever they step outside the circle. Get within ${CATCH_M} m to catch.`;
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
  if (room.runnerPick === playerId) room.runnerPick = null;
  room.updatedAt = now;
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  wipe(room);
  room.updatedAt = now;
}

/** Drop every position the room holds. */
function wipe(room: Room): void {
  for (const p of room.players) p.fix = null;
  room.pings = [];
  room.liveUntil = null;
  room.claim = null;
}

function finish(room: Room, outcome: Outcome, catcherId: string | null, confirmed: boolean, at: number): void {
  room.phase = 'finished';
  room.result = { outcome, catcherId, confirmed, at };
  room.phaseEndsAt = at + FINISHED_MS;
  wipe(room);
  room.updatedAt = at;
}

/**
 * The API has checked this player is a parent: they may inherit the host
 * role. Not a move — no phone can say it of itself.
 */
export function noteParent(room: Room, playerId: string): void {
  if (!room.players.some((p) => p.id === playerId) || room.parents.includes(playerId)) return;
  room.parents.push(playerId);
}

/**
 * Leaving the lobby as host cancels the game; the last one out closes the
 * room. Mid-game a leaver's fix is dropped at once. The runner leaving ends
 * it for the hunters (nobody made the catch) — unless a claim is standing,
 * which the runner cannot walk away from: it stands as the catch. The last
 * hunter leaving ends it for the runner. A hunter's own pending claim goes
 * with them, and so do the copies of their fix in earlier pings. The host
 * role passes to a parent still here when there is one (a child cannot set
 * up the next game); with none left it passes to whoever is next.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  p.fix = null;
  for (const pg of room.pings) pg.hunters = pg.hunters.filter((h) => h.id !== playerId);
  room.updatedAt = now;
  if (room.runnerPick === playerId) room.runnerPick = null;
  if (room.phase === 'lobby' && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = (rest.find((q) => room.parents.includes(q.id)) ?? rest[0]).id;
  if (room.phase !== 'headstart' && room.phase !== 'hunt') return;
  if (!p.seated) return;
  if (room.claim?.hunterId === playerId) room.claim = null;
  if (p.role === 'runner') {
    if (room.claim) finish(room, 'caught', room.claim.hunterId, false, now);
    else finish(room, 'runner-left', null, false, now);
  } else if (hunters(room).length === 0) {
    finish(room, 'hunters-left', null, false, now);
  }
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (!room.area) throw new GameError(409, 'Set the play area first: the circle goes round where you stand.');
  if (joined(room).length < MIN_PLAYERS) {
    throw new GameError(409, 'Manhunt needs at least three: one runner and two hunters.');
  }
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/**
 * The host plays again in the same place with whoever is still here; the
 * runner's role passes to the next player round the table.
 */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  const last = room.runnerId;
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.seated = false;
    p.role = null;
    p.fix = null;
    p.cooldownUntil = null;
  }
  const seats = room.players;
  const at = seats.findIndex((p) => p.id === last);
  let next: string | null = null;
  for (let k = 1; k <= seats.length && at >= 0; k++) {
    const q = seats[(at + k) % seats.length];
    if (q.status === 'joined') {
      next = q.id;
      break;
    }
  }
  room.runnerPick = next;
  room.phase = 'lobby';
  room.runnerId = null;
  room.startedAt = null;
  room.huntStartedAt = null;
  room.endsAt = null;
  room.result = null;
  wipe(room);
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Moves ---------------------------------------------------------------

/**
 * The host sets the play area in the lobby: the circle's centre (where their
 * phone is), and optionally its radius and the game's length.
 */
export function setArea(
  room: Room,
  playerId: string,
  input: { lat: unknown; lng: unknown; radius?: unknown; minutes?: unknown },
  now: number,
): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host sets the play area.');
  if (room.phase !== 'lobby') throw new GameError(409, 'The play area is fixed once the game starts.');
  const centre = latLng(input.lat, input.lng);
  if (!centre) throw new GameError(400, 'That is not a place on the map.');
  if (input.radius !== undefined) room.radius = radiusFrom(input.radius);
  if (input.minutes !== undefined) room.minutes = minutesFrom(input.minutes);
  room.area = { ...centre, radiusM: room.radius };
  room.updatedAt = now;
}

/** The host picks who runs (a player id), or null to let the start draw one. */
export function pickRunner(room: Room, playerId: string, input: { playerId: unknown }, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host picks the runner.');
  if (room.phase !== 'lobby') throw new GameError(409, 'The runner is set once the game starts.');
  if (input.playerId === null || input.playerId === undefined) {
    room.runnerPick = null;
  } else {
    const p = room.players.find((x) => x.id === input.playerId);
    if (!p || (p.status !== 'joined' && p.status !== 'invited')) {
      throw new GameError(400, 'Pick somebody in this game to run.');
    }
    room.runnerPick = p.id;
  }
  room.updatedAt = now;
}

/**
 * Where my phone is: `{ lat, lng, accuracy, at }`. Taken only from players in
 * the hunt during the head start and the hunt; anywhere else it is dropped
 * without a word (a phone that has not caught up yet). A fix sooner than
 * FIX_MIN_GAP_MS after my last one, older than FIX_MAX_AGE_MS, or no newer than the
 * fix already held (a delayed or retried POST), is ignored.
 * Returns whether the fix was kept.
 */
export function position(
  room: Room,
  playerId: string,
  input: { lat: unknown; lng: unknown; accuracy: unknown; at: unknown },
  now: number,
): boolean {
  const p = find(room, playerId);
  const where = latLng(input.lat, input.lng);
  if (!where) throw new GameError(400, 'That is not a place on the map.');
  if (!finite(input.accuracy) || input.accuracy < 0) throw new GameError(400, 'That fix has no accuracy.');
  if (!inGame(p) || (room.phase !== 'headstart' && room.phase !== 'hunt')) return false;
  if (p.fix && now - p.fix.receivedAt < FIX_MIN_GAP_MS) return false;
  // A phone's clock is its own: a fix "from the future" is now, one with no time is now.
  const at = finite(input.at) ? Math.min(input.at, now) : now;
  if (now - at > FIX_MAX_AGE_MS) return false;
  // A delayed or retried POST must not put an older place over a newer one.
  if (p.fix && at <= p.fix.at) return false;
  const fix: Fix = { ...where, accuracy: Math.min(input.accuracy, 10_000), at, receivedAt: now };
  p.fix = fix;
  if (room.phase === 'hunt' && p.role === 'runner' && room.area && isOutside(room.area, fix)) {
    room.liveUntil = now + OUTSIDE_LIVE_MS;
  }
  room.updatedAt = now;
  return true;
}

/** The runner has sent nothing for RUNNER_QUIET_MS (or nothing at all) during the hunt. */
export function runnerQuiet(room: Room, now: number): boolean {
  if (room.phase !== 'hunt') return false;
  const r = runner(room);
  if (!r) return false;
  const since = r.fix?.receivedAt ?? room.huntStartedAt ?? now;
  return now - since > RUNNER_QUIET_MS;
}

/**
 * A hunter claims the catch. Their own fix must be fresh and sharp; the
 * runner's latest fix must be within reach (`withinCatch`). A runner who has
 * gone quiet is claimed on the hunter's word. A claim that is too far away
 * costs that hunter CATCH_COOLDOWN_MS. The claim stands for CLAIM_MS.
 */
export function claimCatch(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (!inGame(p)) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'hunt') {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The hunt has not started.');
  }
  if (p.role !== 'hunter') throw new GameError(409, 'Only a hunter can make a catch.');
  if (room.claim) {
    throw new GameError(409, room.claim.hunterId === p.id ? 'You have already claimed it.' : 'Somebody has already claimed the catch.');
  }
  if (p.cooldownUntil !== null && now < p.cooldownUntil) {
    throw new GameError(400, `Not yet: try again in ${Math.ceil((p.cooldownUntil - now) / 1000)} seconds.`);
  }
  const r = runner(room);
  if (!r) throw new GameError(409, 'There is nobody to catch.');
  const quiet = runnerQuiet(room, now);
  if (!quiet) {
    const mine = p.fix;
    if (!mine || now - mine.receivedAt > CATCH_FIX_FRESH_MS || mine.accuracy > CATCH_FIX_ACCURACY_M) {
      throw new GameError(400, 'Your phone needs a fresh, sharp GPS fix first: step into the open for a moment.');
    }
    if (!r.fix || !withinCatch(mine, r.fix)) {
      p.cooldownUntil = now + CATCH_COOLDOWN_MS;
      room.updatedAt = now;
      throw new GameError(400, `Not close enough. You can try again in ${CATCH_COOLDOWN_MS / 1000} seconds.`);
    }
  }
  room.claim = { hunterId: p.id, at: now, deadline: now + CLAIM_MS, quiet };
  room.updatedAt = now;
}

/** The runner owns up to a claimed catch: it ends the game at once. */
export function confirmCatch(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (room.phase !== 'hunt' || !room.claim) throw new GameError(409, 'There is no catch to confirm.');
  if (p.id !== room.runnerId || !inGame(p)) throw new GameError(403, 'Only the runner can confirm a catch.');
  finish(room, 'caught', room.claim.hunterId, true, now);
}

// ---- The clock -----------------------------------------------------------

/** The next ping's time, or null when the hunt will end first. */
export function nextPingAt(room: Room): number | null {
  if (room.phase !== 'hunt' || room.huntStartedAt === null || room.endsAt === null) return null;
  const at = room.huntStartedAt + (room.pings.length + 1) * PING_MS[room.difficulty];
  return at < room.endsAt ? at : null;
}

function ping(room: Room, at: number): void {
  const copy = (f: Fix | null): Fix | null => (f ? { ...f } : null);
  room.pings.push({
    at,
    runner: copy(runner(room)?.fix ?? null),
    hunters: hunters(room).map((h) => ({ id: h.id, fix: copy(h.fix) })),
  });
  room.updatedAt = at;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  if (room.phase !== 'hunt') return room.phaseEndsAt;
  const due = [
    room.claim?.deadline ?? null,
    room.liveUntil,
    nextPingAt(room),
    // A catch claimed in time is settled before the clock can run out.
    room.claim ? null : room.endsAt,
  ].filter((t): t is number => t !== null);
  return due.length ? Math.min(...due) : null;
}

/**
 * Move a room along the clock: each deadline that has passed is acted on in
 * turn. Times are anchored to the schedule (the hunt's start, the ping
 * interval), so a late timer still pings at the right moments; the loop is
 * capped, and a `now` that is not a number does nothing.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 64; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        beginHeadStart(room, due, rng);
        break;
      case 'headstart':
        room.phase = 'hunt';
        room.huntStartedAt = due;
        room.endsAt = due + room.minutes * 60_000;
        room.phaseEndsAt = room.endsAt;
        room.updatedAt = due;
        break;
      case 'hunt':
        if (room.claim && room.claim.deadline === due) {
          finish(room, 'caught', room.claim.hunterId, false, due);
        } else if (room.liveUntil !== null && room.liveUntil === due) {
          room.liveUntil = null;
          room.updatedAt = due;
        } else if (nextPingAt(room) === due) {
          ping(room, due);
        } else {
          finish(room, 'time', null, false, due);
        }
        break;
    }
  }
  return changed;
}

function beginHeadStart(room: Room, at: number, rng: Rng): void {
  const ready = joined(room);
  // Somebody left during the 3-2-1 and too few are left for a hunt: one
  // runner and two hunters, the same as the start asks for.
  if (ready.length < MIN_PLAYERS) {
    close(room, at);
    return;
  }
  const picked = ready.find((p) => p.id === room.runnerPick);
  const run = picked ?? ready[Math.min(ready.length - 1, Math.floor(rng() * ready.length))];
  for (const p of room.players) {
    p.seated = p.status === 'joined';
    p.role = p.seated ? (p.id === run.id ? 'runner' : 'hunter') : null;
    p.fix = null;
    p.cooldownUntil = null;
  }
  room.runnerId = run.id;
  room.phase = 'headstart';
  room.startedAt = at;
  room.phaseEndsAt = at + HEADSTART_MS;
  room.pings = [];
  room.liveUntil = null;
  room.claim = null;
  room.result = null;
  room.updatedAt = at;
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  /** 1 for the winner(s); then the rest of the winning side; the losers last. */
  place: number;
  role: Role;
  /** won: the leaderboard win. team: on the winning side, but somebody else made the catch. */
  result: 'won' | 'team' | 'lost';
  left: boolean;
}

/** Who wins: the catcher; the runner when time runs out or the hunters all left; the hunters still in when the runner left. */
export function winners(room: Room): string[] {
  const r = room.result;
  if (!r) return [];
  switch (r.outcome) {
    case 'caught':
      return r.catcherId ? [r.catcherId] : [];
    case 'time':
    case 'hunters-left':
      return room.runnerId ? [room.runnerId] : [];
    case 'runner-left':
      return hunters(room).map((h) => h.id);
  }
}

/** Everyone who was in the hunt: winners first, their side next, the other side last. */
export function standings(room: Room): Standing[] {
  const won = new Set(winners(room));
  const huntersWon = room.result?.outcome === 'caught' || room.result?.outcome === 'runner-left';
  const seated = room.players.filter((p) => p.seated && p.role);
  const rank = (p: Player) => (won.has(p.id) ? 0 : (p.role === 'hunter') === huntersWon ? 1 : 2);
  const ordered = [...seated].sort((a, b) => rank(a) - rank(b));
  let place = 0;
  let lastRank = -1;
  return ordered.map((p, i) => {
    if (rank(p) !== lastRank) {
      place = i + 1;
      lastRank = rank(p);
    }
    return {
      id: p.id,
      name: p.name,
      place,
      role: p.role!,
      result: won.has(p.id) ? 'won' : rank(p) === 1 ? 'team' : 'lost',
      left: p.status === 'left',
    };
  });
}

// ---- The wire ------------------------------------------------------------

const wireFix = (f: Fix | null, area: Area | null) =>
  f
    ? {
        lat: f.lat,
        lng: f.lng,
        accuracy: Math.round(f.accuracy),
        at: f.at,
        outside: area ? isOutside(area, f) : false,
      }
    : null;

/**
 * The room as one player's phone sees it.
 *
 * - My own fix, always (while the game holds one).
 * - A hunter, in the hunt: every hunter's live fix; the runner's only while
 *   they are live (outside the circle, and OUTSIDE_LIVE_MS after); and the
 *   runner's fix at each ping.
 * - The runner, in the hunt: no hunter live, ever; each hunter's fix at each
 *   ping.
 * - The head start shows nobody to anybody. Somebody not in the hunt (left,
 *   declined) sees no positions at all. A finished room holds none.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const me = room.players.find((p) => p.id === meId) ?? null;
  const myRole = me && inGame(me) ? me.role : null;
  const hunting = room.phase === 'hunt';
  const live = hunting && room.liveUntil !== null && now < room.liveUntil;
  const area = room.area;

  const sees = (p: Player): boolean => {
    if (p.id === meId) return !!me && inGame(me);
    if (!hunting || myRole !== 'hunter') return false;
    return p.role === 'hunter' || (p.role === 'runner' && live);
  };

  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    myRole,
    area: area ? { lat: area.lat, lng: area.lng, radiusM: area.radiusM } : null,
    radius: room.radius,
    minutes: room.minutes,
    rule: ruleLine(room.difficulty),
    pingMs: PING_MS[room.difficulty],
    headStartMs: HEADSTART_MS,
    catchM: CATCH_M,
    catchSlackM: CATCH_SLACK_M,
    claimMs: CLAIM_MS,
    outsideLiveMs: OUTSIDE_LIVE_MS,
    fixMinGapMs: FIX_MIN_GAP_MS,
    runnerPick: room.phase === 'lobby' ? room.runnerPick : null,
    runnerId: room.runnerId,
    startedAt: room.startedAt,
    huntStartedAt: room.huntStartedAt,
    endsAt: room.endsAt,
    nextPingAt: nextPingAt(room),
    phaseEndsAt: room.phaseEndsAt,
    /** The runner is showing live to the hunters until then (everyone is told that, not where). */
    runnerLiveUntil: live ? room.liveUntil : null,
    runnerQuiet: runnerQuiet(room, now),
    claim: room.claim ? { hunterId: room.claim.hunterId, deadline: room.claim.deadline, quiet: room.claim.quiet } : null,
    catchCooldownUntil: me && me.cooldownUntil !== null && now < me.cooldownUntil ? me.cooldownUntil : null,
    pings: hunting
      ? room.pings.map((pg) => ({
          at: pg.at,
          runner: myRole === 'hunter' ? wireFix(pg.runner, area) : null,
          hunters:
            myRole === 'runner' ? pg.hunters.map((h) => ({ id: h.id, fix: wireFix(h.fix, area) })) : [],
        }))
      : [],
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seated: p.seated,
      role: p.role,
      fix: sees(p) ? wireFix(p.fix, area) : null,
    })),
    result: room.result
      ? { outcome: room.result.outcome, catcherId: room.result.catcherId, confirmed: room.result.confirmed }
      : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
