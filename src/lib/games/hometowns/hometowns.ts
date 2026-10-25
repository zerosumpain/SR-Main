// Hometowns: the GameRules adapter (spec §10.1–§10.6, §10.11, §10.14; WP4).
//
// A county is a durable, async room: one CountyState (the engine's, pure and
// JSON-safe) plus what the registry needs around it — players and their
// seats, the revision a phone's deltas are cut against, the push window and
// the heartbeat. Everything that simulates lives in `engine/`; this file only
// turns the framework's calls into engine calls:
//   - `advance` is the lazy catch-up (§10.5): at most CHUNK_UNITS of work a
//     call. An unfinished catch-up says so (`behind`), `deadline()` then
//     answers "now" and the registry calls again on the next turn of the
//     event loop. Only the chunk that finishes, or one that ran a Regional
//     Day, reports a change (A27), so the row is written and phones are told
//     once per catch-up, not once per chunk.
//   - `deadline()` points only at interesting moments: the next Regional Day,
//     the next "Play it all" sprint tick, a pause's end and the paused or
//     napping county's weekly heartbeat. Town ticks are never scheduled one
//     by one; a view, a move or a stream catches the viewer's own town up.
//   - every move goes through the engine's `applyCommand` (§10.6): ids make
//     it idempotent (A28), the acting town is caught up first (A19), and a
//     move that meets a Regional Day still running is refused with the
//     engine's retry sentence (RETRY_MESSAGE) after this file has tried to
//     finish the day itself (two more chunks).
//   - `rev` bumps on EVERY change to the room in memory, including a chunk
//     that is not written. It is what a phone's `since` names, and the wire's
//     delta cache is keyed by it (wire.ts). The row stores an older rev than
//     the phones may hold (the unwritten bumps), so a room read back from the
//     table (a restart, a lost write race) moves its rev on to the
//     milliseconds since the county was made (`revive`): a rev is then never
//     reused across two timelines either, a phone holding one from before can
//     never be cut a delta against a different state with the same number,
//     and its store sees a whole frame and re-posts what that frame lacks.
//
// The framework's `rng` is ignored: the engine draws from counter-based
// streams seeded by the county, so a room read back days later runs exactly
// as one that never left memory.

import { GameError, type Difficulty, type PlayerStatus, type Rng } from '../tap-duel';
import { isClean } from '../quiz-night';
import {
  EngineError,
  LOG_KEEP,
  TIER_NAMES,
  applyCommand,
  backfillOrders,
  catchUp,
  catchUpTown,
  createCounty,
  effectiveNow,
  fnv64,
  gridTickAt,
  napCheck,
  nextRegionalDayAt,
  paramsFor,
  population,
  setPause,
  type Command,
  type CountySettings,
  type CountyState,
  type MoveType,
  type ParamsVersion,
  type SeatSettings,
} from './engine/index';
import type { RoomBase } from '../catalogue';
import { eraseMayor, formerSeat } from './erase-mayor';
import { closePushWindow, emptyPush, openPushWindow, prunePushWindow, type PushState } from './push';
import { SOLO_PAUSE_MESSAGE, seatedMayors, soloMayor, soloPauser } from './solo';
import { forgetViewer, toWire as wireFor, type WireOptions } from './wire';

export const GAME = 'hometowns' as const;
/** Stored shape; bump with a migration in MIGRATIONS (A38). */
export const SCHEMA = 1;
export const MAX_SEATS = 6;
/** Work units per `advance` (§10.5: tick 1, month step 6, year end 8 a town, Regional Day 20). */
export const CHUNK_UNITS = 96;
/** Extra catch-up chunks a move may run to finish a Regional Day before refusing with the retry sentence. */
export const INLINE_CHUNKS = 2;
/**
 * A pause made before decision 13 (a family county's, by a parent) ends by
 * itself after this long a season (§2.4). A solo county's pause has no cap
 * (`solo.ts`): it is the mayor's own game and lasts until they resume.
 */
export const PAUSE_MAX_MS = 21 * 86_400_000;
/** The dev clock's ticks (§2.6), honoured only when the server has HOMETOWNS_DEV_CLOCK=1. */
export const DEV_TICKS: readonly number[] = [30_000, 120_000, 300_000];
/** A plan's body, as stored in the command log, is at most this big (a 60-op plan is far smaller). */
export const MOVE_BYTES = 16_384;
/** Any other move's body: a budget, a set of standing orders or a settings change is well under this. */
export const SMALL_MOVE_BYTES = 2_048;
/**
 * Presence and telemetry moves (`hello`, `seen`, `visit`, `stats`) one seat
 * may make a minute. The engine's own limit counts only logged moves, and
 * these are never logged; a phone makes one or two a minute.
 */
export const PRESENCE_PER_MINUTE = 20;
/** The engine's sentence for a move that met a Regional Day still running (A19): the phone retries it after a second. */
export const RETRY_MESSAGE = 'Kingsport is just finishing the day. Trying again…';
/**
 * The command log keeps this many newest records whole; older ones keep
 * only what idempotency and the audit need (seat, id, type, tick, cost).
 * The ring holds 150, and 150 whole build plans would be most of the room's
 * 320 KB budget (§10.8). Nothing reads an old record's body.
 */
export const LOG_FULL = 10;
/** Allowed hours for the Regional Day (§10.11): it must fall inside the push hours. */
export const REGIONAL_HOURS: readonly [number, number] = [8, 19];

const DAY_MS = 86_400_000;

type Phase = 'lobby' | 'running' | 'closed';

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** The seat ('s1' … 's6') once they have joined; kept after they leave, so their town keeps its name. */
  seat: string | null;
}

/** The create request's `county` option, bounded (§10.12 F7). */
export interface CountySetup {
  name: string;
  rivalry: 'friendly' | 'spirited';
  regionalHour: number;
  mishaps: 'mild' | 'off';
  /** Local dev clock only; null in production. */
  devTickMs: number | null;
  seed: number;
}

/** County settings a parent changed mid-day: they take effect after the next Regional Day, so no tick already predicted changes. */
export interface QueuedSettings {
  rivalry?: 'friendly' | 'spirited';
  mishaps?: 'mild' | 'off';
  regionalHour?: number;
}

export interface Room {
  id: string;
  game: typeof GAME;
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  phaseEndsAt: number | null;
  pace: 'async';
  schema: typeof SCHEMA;
  paramsVersion: ParamsVersion;
  /** Bumps on every change in memory: the per-viewer `since`. */
  rev: number;
  setup: CountySetup;
  /** The engine's county. In the lobby it is provisional; `start` makes the real one at its own instant. */
  county: CountyState;
  /** The last catch-up stopped at its budget: `deadline()` answers "now" until it finishes. */
  behind: boolean;
  /** The Regional Days the room has accounted for (push window, queued settings). */
  daySeen: number;
  /** The last write of a paused or napping county (a weekly heartbeat keeps the row from retention). */
  heartbeatAt: number;
  push: PushState;
  /** The town each seat is visiting (§10.6 `visit`), or null. */
  viewing: Record<string, string | null>;
  queued: QueuedSettings | null;
  createdAt: number;
  updatedAt: number;
}

// ---- Setting up ------------------------------------------------------------------------------

function devClockAllowed(): boolean {
  return typeof process !== 'undefined' && process.env?.HOMETOWNS_DEV_CLOCK === '1';
}

const seedOf = (id: string): number => parseInt(fnv64(id).slice(0, 8), 16) >>> 0;

/** The `county` option as the game will use it: every field bounded, anything else its default. */
export function readSetup(options: Record<string, unknown> | undefined, id: string): CountySetup {
  const o = (options?.county && typeof options.county === 'object' ? options.county : {}) as Record<string, unknown>;
  const p = paramsFor('v1');
  const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ').slice(0, 30) : '';
  const hour = typeof o.regionalHour === 'number' && Number.isInteger(o.regionalHour) ? o.regionalHour : p.clock.regionalHour;
  // A chosen terrain seed is the local stack's and the tests' (a parent could
  // otherwise shop for favourable land); production always uses the room's own.
  const seed = devClockAllowed() && typeof o.seed === 'number' && Number.isInteger(o.seed) ? o.seed >>> 0 : seedOf(id);
  return {
    // Shown on every child's screen and in the push line: a name that fails the family word list is the default.
    name: name.length >= 2 && isClean(name, 'kids') ? name : 'Kingsport County',
    rivalry: o.rivalry === 'spirited' ? 'spirited' : 'friendly',
    regionalHour: hour >= REGIONAL_HOURS[0] && hour <= REGIONAL_HOURS[1] ? hour : p.clock.regionalHour,
    mishaps: o.mishaps === 'off' ? 'off' : 'mild',
    devTickMs: devClockAllowed() && DEV_TICKS.includes(o.devTickMs as number) ? (o.devTickMs as number) : null,
    seed,
  };
}

/** A county on the grid from `now` (ticks fall on the :00/:30 grid, §2.2; dev ticks on their own). */
function newCounty(setup: CountySetup, now: number): CountyState {
  const tickMs = setup.devTickMs ?? paramsFor('v1').clock.tickMs;
  const settings: CountySettings = { rivalry: setup.rivalry, mishaps: setup.mishaps, youngestOrder: [], perSeat: {} };
  return createCounty({
    seed: setup.seed,
    params: 'v1',
    settings,
    epoch: Math.floor(now / tickMs) * tickMs,
    now,
    name: setup.name,
    regionalHour: setup.regionalHour,
    devTickMs: setup.devTickMs,
  });
}

/** A seat's defaults: a parent's is an adult's with pushes on; anyone else is a child's until a parent says (§9.12, §9.13). */
function seatDefaults(parent: boolean): SeatSettings {
  return { profile: parent ? 'adult' : 'kid', pushes: parent, pranks: true, answerOnly: false, assist: 'none' };
}

function seatPlayer(room: Room, p: Player, parent: boolean): void {
  if (p.seat) return;
  // Every seat label in use: a player's, a town's and a seat's settings. A
  // new seat is the first label none of them holds. Counting players alone
  // would collide after an erasure (s1, s3, s4 left: "s4" again); an erased
  // mayor's label is free, since `eraseMayor` replaced it everywhere, and
  // their town still holds its site under a placeholder (A33), so it counts
  // towards the six.
  const c = room.county;
  const used = new Set<string>([
    ...room.players.map((q) => q.seat).filter((s): s is string => s !== null),
    ...c.towns.map((t) => t.seat),
    ...Object.keys(c.settings.perSeat),
  ]);
  const taken = new Set([...room.players.map((q) => q.seat).filter((s): s is string => s !== null), ...c.towns.map((t) => t.seat)]).size;
  if (taken >= MAX_SEATS) throw new GameError(409, `${room.county.name} is full: six mayors already.`);
  let n = 1;
  while (used.has(`s${n}`)) n++;
  const seat = `s${n}`;
  p.seat = seat;
  c.settings.perSeat[seat] = seatDefaults(parent);
  if (parent && !c.parents.includes(seat)) c.parents.push(seat);
}

function bump(room: Room, now: number): void {
  room.rev += 1;
  room.updatedAt = Math.max(room.updatedAt, now);
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
  if (invited.length > MAX_SEATS - 1) throw new GameError(400, `Up to ${MAX_SEATS} mayors.`);
  const setup = readSetup(input.options, input.id);
  const room: Room = {
    id: input.id,
    game: GAME,
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    phaseEndsAt: null,
    pace: 'async',
    schema: SCHEMA,
    paramsVersion: 'v1',
    rev: 1,
    setup,
    county: newCounty(setup, input.now),
    behind: false,
    daySeen: 0,
    heartbeatAt: input.now,
    push: emptyPush(),
    viewing: {},
    queued: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  // The host is a parent: the API refuses anyone else a Hometowns county (F6).
  seatPlayer(room, room.players[0], true);
  return room;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seat: null };
}

export function about(room: Room): string {
  return `${room.county.name} · up to six towns · a year a day`;
}

// ---- Lobby verbs -------------------------------------------------------------------------------

function find(room: Room, playerId: string): Player {
  const p = room.players.find((q) => q.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this county.');
  return p;
}

/** An invitee joins, in the lobby or later (an invite from before the start still stands). */
export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase === 'closed') throw new GameError(409, 'This county has closed.');
  if (p.status !== 'invited') throw new GameError(409, 'Ask the host to invite you again.');
  seatPlayer(room, p, false);
  p.status = 'joined';
  endSoloPause(room, now);
  bump(room, now);
}

/**
 * Decision 13: a county with a second mayor never stays paused. The pause
 * ends at the instant they join, exactly as the engine's own unpause does
 * (commands.ts): the backlog up to the pause's start is finished first,
 * unbounded, and then the grid shifts on from there.
 */
function endSoloPause(room: Room, now: number): void {
  const c = room.county;
  if (room.phase !== 'running' || !c.pause || seatedMayors(room).length < 2) return;
  catchUp(c, now, Infinity);
  setPause(c, false, now);
  room.behind = false;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'invited') return;
  p.status = 'declined';
  bump(room, now);
}

/**
 * Leaving: in the lobby the host's leaving cancels it. In a running county
 * the mayor's town is caught up to now and then rests (archived; A33's
 * settlement of links and contracts is the Regional Day's). The last mayor
 * leaving closes the county.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  const rest = room.players.filter((q) => q.status === 'joined');
  if ((room.phase === 'lobby' && playerId === room.hostId) || rest.length === 0) {
    room.phase = 'closed';
    bump(room, now);
    return;
  }
  const c = room.county;
  if (room.phase === 'running' && p.seat) {
    const i = c.towns.findIndex((t) => t.seat === p.seat);
    if (i >= 0) {
      const pp = paramsFor(c.paramsVersion);
      catchUpTown(c, i, gridTickAt(c, Math.min(effectiveNow(c, now, pp.clock.napAfterMs), nextRegionalDayAt(c, pp.clock.devRegionalTicks))));
      c.towns[i].archived = true;
    }
  }
  if (playerId === room.hostId) {
    const parent = rest.find((q) => q.seat && c.parents.includes(q.seat));
    room.hostId = (parent ?? rest[0]).id;
  }
  bump(room, now);
}

/** A parent (the host or a parent who joined) starts the county; a solo county is a real game. */
export function start(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (room.phase !== 'lobby') throw new GameError(409, 'The county has already started.');
  const parent = playerId === room.hostId || (!!p.seat && room.county.parents.includes(p.seat));
  if (!parent || p.status !== 'joined') throw new GameError(403, 'Only a parent can start the county.');
  // The real county starts now: its grid and first Regional Day count from this instant, not the lobby's.
  const old = room.county;
  const c = newCounty(room.setup, now);
  c.settings.perSeat = old.settings.perSeat;
  c.settings.youngestOrder = old.settings.youngestOrder;
  c.parents = old.parents;
  room.county = c;
  room.phase = 'running';
  room.daySeen = c.dayIndex;
  room.heartbeatAt = now;
  bump(room, now);
}

export function again(_room: Room, _playerId: string, _now: number): void {
  throw new GameError(409, 'A county keeps going: towns are kept forever.');
}

/**
 * The API has checked this player is a parent: their seat may pause, change
 * settings and start, and is an adult's. True when that changed the room
 * (the registry then writes it and sends it), false for a parent already noted.
 */
export function noteParent(room: Room, playerId: string): boolean {
  const p = room.players.find((q) => q.id === playerId);
  if (!p?.seat) return false;
  const c = room.county;
  const s = c.settings.perSeat[p.seat];
  if (c.parents.includes(p.seat) && (!s || s.profile === 'adult')) return false;
  if (!c.parents.includes(p.seat)) c.parents.push(p.seat);
  if (s) {
    s.profile = 'adult';
    s.pushes = true;
  }
  bump(room, room.updatedAt);
  return true;
}

// ---- The clock ---------------------------------------------------------------------------------

/** After any catch-up: account for Regional Days that have run since the room last looked. */
function noteDays(room: Room, now: number): boolean {
  const c = room.county;
  if (c.dayIndex === room.daySeen) return false;
  room.daySeen = c.dayIndex;
  if (room.queued) {
    // Mid-day changes to the rules land between days, so no tick already predicted changes.
    const q = room.queued;
    if (q.rivalry) c.settings.rivalry = room.setup.rivalry = q.rivalry;
    if (q.mishaps) c.settings.mishaps = room.setup.mishaps = q.mishaps;
    if (q.regionalHour !== undefined) c.regionalHour = room.setup.regionalHour = q.regionalHour;
    room.queued = null;
  }
  const seated = (seat: string) => room.players.some((p) => p.seat === seat && p.status === 'joined');
  openPushWindow(room.push, c, now, seated);
  return true;
}

/**
 * §10.5 advance: one bounded chunk of catch-up, then the bookkeeping that
 * needs `now` (the push window, a pause that has run out, the heartbeat).
 * True only when the room should be written and its phones told.
 */
export function advance(room: Room, now: number, _rng?: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  if (room.phase !== 'running') return false;
  const c = room.county;
  const p = paramsFor(c.paramsVersion);
  let changed = false;
  let mutated = false;
  // A solo pause lasts until its mayor resumes; any other (one from before decision 13, or one a
  // child is left alone with and cannot end) keeps its season cap.
  if (c.pause && !soloPauser(room) && c.pauseUsedMs + (now - c.pause.since) >= PAUSE_MAX_MS) {
    setPause(c, false, now);
    changed = true;
  }
  if (napCheck(c, now, p.clock.napAfterMs)) changed = true;
  const r = catchUp(c, now, CHUNK_UNITS);
  if (r.used > 0) mutated = true;
  room.behind = !r.done;
  if (r.changed) changed = true;
  if (noteDays(room, now)) changed = true;
  if (closePushWindow(room.push, now)) changed = true;
  if (prunePushWindow(room.push, c, now)) changed = true;
  if ((c.pause || c.nap) && heartbeatDue(room, now)) {
    room.heartbeatAt = now;
    changed = true;
  }
  if (changed || mutated) bump(room, now);
  return changed;
}

/** A40: a paused or napping county writes weekly, until 90 days pass with no mayor saying hello. */
function heartbeatDue(room: Room, now: number): boolean {
  const c = room.county;
  const p = paramsFor(c.paramsVersion);
  if (now - c.lastHelloAt > p.social.napHeartbeatMaxDays * DAY_MS) return false;
  return now - room.heartbeatAt >= p.clock.heartbeatMs;
}

/** §10.5 deadline: "now" while catching up, else the next moment anything happens without a phone. */
export function deadline(room: Room): number | null {
  if (room.phase !== 'running') return null;
  if (room.behind) return 0;
  const c = room.county;
  const p = paramsFor(c.paramsVersion);
  // A40: the heartbeats stop once 90 days pass with no hello; the row then expires as abandoned.
  const beat = room.heartbeatAt + p.clock.heartbeatMs;
  const heartbeat = beat - c.lastHelloAt > p.social.napHeartbeatMaxDays * DAY_MS ? null : beat;
  if (c.pause && soloPauser(room)) return heartbeat;
  if (c.pause) {
    const end = c.pause.since + Math.max(0, PAUSE_MAX_MS - c.pauseUsedMs);
    return heartbeat === null ? end : Math.min(end, heartbeat);
  }
  if (c.nap) return heartbeat;
  let due = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  for (const t of c.towns) {
    if (t.sprintAuto && t.gridBase === null && t.sprintLeft > 0 && !t.archived) due = Math.min(due, t.sprintAt + p.clock.sprintAutoMs);
  }
  if (room.push.open) due = Math.min(due, room.push.open.until);
  return due;
}

export function revision(room: Room): number {
  return room.rev;
}

// ---- Durable rooms ---------------------------------------------------------------------------------

/** Pure migrations from each older schema to the next (A38). None yet: schema 1 is the first. */
const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Every room read back from the table, under this schema or an older one
 * (the registry calls this on every load: `reviveAll`). Never null (A38): a
 * county runs for months, and the registry closes a room it cannot revive.
 * Older schemas are migrated; fields added within a schema are filled with
 * their defaults here and read defensively everywhere. The rev moves on past
 * anything the last process can have sent (see the top of this file): to the
 * milliseconds since the county was made, and never backwards. A bump is a
 * move or a chunk of catch-up, each a request or an event-loop turn of
 * work, so a run of bumps never gains on the clock.
 */
export function revive(state: Record<string, unknown>, fromSchema: number, now = Date.now()): Room {
  let s = state;
  for (let v = fromSchema; v < SCHEMA; v++) s = MIGRATIONS[v]?.(s) ?? s;
  const room = s as unknown as Room;
  room.schema = SCHEMA;
  room.push ??= emptyPush();
  room.viewing ??= {};
  room.queued ??= null;
  room.behind ??= false;
  room.daySeen ??= room.county?.dayIndex ?? 0;
  // Decision 12: a child's town made before an order existed gets it (the child default) on load.
  if (room.county) backfillOrders(room.county);
  const rev = Number.isInteger(room.rev) ? room.rev : 0;
  const age = Number.isFinite(room.createdAt) ? Math.floor(now - room.createdAt) : 0;
  room.rev = Math.max(rev + 1, age);
  return room;
}

/**
 * Erasing an account (`$lib/people/erase`, catalogue `durable.erasePlayer`):
 * the county is kept for everybody else. The engine side is `eraseMayor`
 * (their town archived and renamed "Old Town <n>", their seat a placeholder
 * everywhere in the CountyState); this takes them out of the room around it:
 *   - `players`: their row goes, name and all;
 *   - `viewing`: their own entry goes, and anybody visiting their town now
 *     visits it under its placeholder (or comes home when they had no town);
 *   - `push.open`: their seat leaves the day's push window (closed if it was
 *     the only one); `push.tiers` is by town index and names nobody;
 *   - the in-memory presence and wire caches keyed by their seat or id;
 *   - `hostId`: a host who is erased passes it to another joined parent, or
 *     the room is deleted after all (null), as the contract asks;
 *   - with no joined mayor left the county closes (A33), like a last leave.
 * `queued` and `setup` hold settings only, never a seat or a person. Pure
 * apart from those caches; in place on the copy the registry hands over.
 */
export function erasePlayer(room: Room, playerId: string, now: number): Room | null {
  const p = room.players.find((q) => q.id === playerId);
  if (!p) return room;
  const c = room.county;
  const seat = p.seat;
  if (seat) {
    const index = eraseMayor(c, { seat, ownerId: playerId });
    const placeholder = index === null ? null : formerSeat(c.towns[index].site);
    const viewing: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(room.viewing ?? {})) if (k !== seat) viewing[k] = v === seat ? placeholder : v;
    room.viewing = viewing;
    const open = room.push?.open;
    if (open) {
      const seats = open.seats.filter((s) => s !== seat && s !== placeholder);
      room.push.open = seats.length ? { ...open, seats } : null;
    }
    RECENT.get(room)?.delete(seat);
    forgetViewer(room, playerId, seat);
  } else forgetViewer(room, playerId, null);
  room.players = room.players.filter((q) => q.id !== playerId);
  if (!room.players.length) return null;
  const rest = room.players.filter((q) => q.status === 'joined' && q.seat);
  const parentOf = (q: Player) => !!q.seat && c.parents.includes(q.seat);
  if (!rest.length) {
    // A33: the last mayor gone closes the county. A closed room still names a person as its host.
    room.phase = 'closed';
    if (room.hostId === playerId) room.hostId = (room.players.find(parentOf) ?? room.players[0]).id;
  } else if (room.hostId === playerId) {
    const parent = rest.find(parentOf);
    if (!parent) return null;
    room.hostId = parent.id;
  }
  bump(room, now);
  return room;
}

export const durable = {
  schema: SCHEMA,
  revive,
  reviveAll: true,
  erasePlayer: (room: RoomBase, playerId: string, now: number): RoomBase | null =>
    erasePlayer(room as unknown as Room, playerId, now) as unknown as RoomBase | null,
};
export const paces = ['async'] as const;
export const maxPlayers = MAX_SEATS;

/** Who the day's one push goes to (push.ts). Null outside a push window. */
export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  const open = room.phase === 'running' ? room.push?.open : null;
  if (!open) return null;
  const ids = room.players.filter((p) => p.status === 'joined' && p.seat && open.seats.includes(p.seat)).map((p) => p.id);
  return ids.length ? { ids, key: open.key, line: open.line } : null;
}

/** The lobby row (§9.12, F3): "Sunnyvale · Town · 2,340 people · gift waiting". */
export function summary(room: Room, meId: string): string | null {
  const seat = room.players.find((p) => p.id === meId)?.seat;
  const t = room.county.towns.find((x) => x.seat === seat);
  if (room.phase === 'lobby') return `${room.county.name} · waiting to start`;
  if (!t) return room.phase === 'running' ? `${room.county.name} · found your town` : null;
  const tier = TIER_NAMES[t.tier];
  const parts = [t.name, tier[0].toUpperCase() + tier.slice(1), `${population(t).toLocaleString('en-GB')} people`];
  if (t.inbox.some((i) => i.kind === 'gift')) parts.push('gift waiting');
  return parts.join(' · ');
}

// ---- Moves -------------------------------------------------------------------------------------------

/** Every move the engine knows (§10.6), posted as the act endpoint's `action`. */
export const MOVE_TYPES: readonly MoveType[] = [
  'hello', 'found', 'sprint', 'build', 'undo', 'budget', 'policy', 'orders', 'loan', 'bond', 'deal', 'link', 'contract',
  'share', 'pact', 'pledge', 'vote', 'bid', 'advert', 'gift', 'aid', 'prank', 'prankReply', 'visit', 'stamp', 'attend',
  'holiday', 'pause', 'settings', 'seen',
];

/**
 * The fields each move's body may carry (engine/types.ts `Command`): the
 * command log keeps a move's body, so nothing else a phone sends is kept.
 */
const MOVE_FIELDS: Record<MoveType, readonly string[]> = {
  hello: ['moveId'],
  found: ['moveId', 'site', 'name', 'nameParts', 'avatar', 'flag'],
  sprint: ['moveId', 'auto'],
  build: ['planId', 'plan'],
  undo: ['moveId', 'planId'],
  budget: ['moveId', 'taxes', 'funding'],
  policy: ['moveId', 'card', 'on', 'area'],
  orders: ['moveId', 'orders'],
  loan: ['moveId', 'take', 'repay'],
  bond: ['moveId', 'issue', 'repay'],
  deal: ['moveId', 'offerId', 'accept'],
  link: ['moveId', 'propose', 'answer', 'close'],
  contract: ['moveId', 'offer', 'answer', 'end'],
  share: ['moveId', 'offer', 'answer'],
  pact: ['moveId', 'propose', 'answer', 'end'],
  pledge: ['moveId', 'stage', 'input', 'amount'],
  vote: ['moveId', 'question', 'choice'],
  bid: ['moveId', 'festival'],
  advert: ['moveId', 'target', 'cohort'],
  gift: ['moveId', 'to', 'item'],
  aid: ['moveId', 'to', 'kind', 'amount'],
  prank: ['moveId', 'to', 'kind'],
  prankReply: ['moveId', 'id', 'choice'],
  visit: ['moveId', 'seat'],
  stamp: ['moveId', 'seat', 'sticker'],
  attend: ['moveId', 'ribbonId'],
  holiday: ['moveId', 'days', 'end'],
  pause: ['moveId', 'on'],
  settings: ['moveId', 'county', 'seat'],
  seen: ['moveId', 'tick'],
};

/**
 * The body as the engine's Command: only the move's own fields (the
 * framework's `action` and `since`, and anything else, are not part of it),
 * and small, since the newest LOG_FULL bodies are stored whole.
 */
function commandOf(type: MoveType, body: Record<string, unknown>, profile: 'kid' | 'adult', seat: string): Command {
  const src = body ?? {};
  const cmd: Record<string, unknown> = { type };
  for (const k of MOVE_FIELDS[type]) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) cmd[k] = src[k];
  if (type === 'found') {
    // Never the phone's to say: who owns the town, and whether a typed name is allowed.
    cmd.nameAllowed = profile === 'adult';
    cmd.ownerId = seat;
    // A typed name is on every mayor's screen and in the Gazette: it passes the family word list first.
    if (typeof cmd.name === 'string' && !cmd.nameParts && !isClean(cmd.name, 'kids')) throw new GameError(400, 'Pick another name for your town.');
  }
  let size = 0;
  try {
    size = JSON.stringify(cmd).length;
  } catch {
    throw new GameError(400, 'That move could not be read.');
  }
  if (type === 'build' && size > MOVE_BYTES) throw new GameError(400, 'That plan is too big: build it in two goes.');
  if (type !== 'build' && size > SMALL_MOVE_BYTES) throw new GameError(400, 'That move could not be read.');
  return cmd as unknown as Command;
}

/**
 * A move that met a Regional Day still due: run up to INLINE_CHUNKS more
 * chunks of catch-up here, so the move usually lands without a retry. The
 * engine refuses it (retry) if the day is still not done.
 */
function finishDueDay(room: Room, now: number): void {
  const c = room.county;
  const p = paramsFor(c.paramsVersion);
  for (let k = 0; k < INLINE_CHUNKS; k++) {
    if (nextRegionalDayAt(c, p.clock.devRegionalTicks) > effectiveNow(c, now, p.clock.napAfterMs)) break;
    const r = catchUp(c, now, CHUNK_UNITS);
    room.behind = !r.done;
  }
  noteDays(room, now);
}

function playMove(room: Room, playerId: string, type: MoveType, body: Record<string, unknown>, now: number): void {
  if (room.phase === 'closed') throw new GameError(409, 'This county has closed.');
  const p = room.players.find((q) => q.id === playerId);
  if (!p || p.status !== 'joined' || !p.seat) throw new GameError(403, 'You are not a mayor in this county.');
  const seat = p.seat;
  const c = room.county;
  // A seat with no settings (a damaged row) is treated as a child's: the safe side.
  const profile = c.settings.perSeat[seat]?.profile ?? 'kid';
  if (PRESENCE.has(type)) presence(room, seat, now);
  const cmd = commandOf(type, body, profile, seat);
  if (type === 'settings') {
    applySettings(room, seat, cmd as Extract<Command, { type: 'settings' }>, now);
    bump(room, now);
    return;
  }
  if (room.phase !== 'running') throw new GameError(409, 'The county starts when a parent taps Start.');
  // Decision 13: only a county played alone pauses. Ending a pause is always
  // allowed, and a repeated pause (A28) is answered by the engine's replay.
  if (type === 'pause' && (cmd as Extract<Command, { type: 'pause' }>).on && !soloMayor(room)) {
    const id = (cmd as { moveId?: unknown }).moveId;
    if (!c.log.some((r) => r.seat === seat && r.id === id && r.type === 'pause')) throw new GameError(409, SOLO_PAUSE_MESSAGE);
  }
  try {
    finishDueDay(room, now);
    if (cmd.type === 'visit') {
      const to = (cmd as { seat?: unknown }).seat ?? null;
      if (to !== null && (typeof to !== 'string' || to === seat || !c.towns.some((t) => t.seat === to))) {
        throw new GameError(404, 'That town isn’t in this county.');
      }
      room.viewing[seat] = to as string | null;
    }
    applyCommand(c, { seat, isParent: c.parents.includes(seat), profile }, cmd, now);
  } catch (e) {
    if (e instanceof EngineError) throw new GameError(e.status, e.message);
    throw e;
  } finally {
    // Even a refused move may have caught the acting town up: a new revision either way.
    compactLog(c);
    bump(room, now);
  }
}

/** Trims the bodies of command-log records older than the newest LOG_FULL (in place, deterministically). */
function compactLog(c: CountyState): void {
  for (let k = 0; k < c.log.length - LOG_FULL; k++) {
    const r = c.log[k];
    if (Object.keys(r.cmd).length === 1 && r.result.data === undefined) continue;
    // The record's own id, seat and type stay: they are what a repeated move is matched by (A28).
    r.cmd = { type: r.type } as Command;
    r.result = { ok: true, atTick: r.result.atTick, cost: r.result.cost, ...(r.result.replayed ? { replayed: true } : {}) };
  }
}

const isRivalry = (v: unknown): v is 'friendly' | 'spirited' => v === 'friendly' || v === 'spirited';
const isMishaps = (v: unknown): v is 'mild' | 'off' => v === 'mild' || v === 'off';

/**
 * `settings` (§9.13, §10.6): county settings and children's seats are a
 * parent's. Through the API every `settings` call is a parent's already (F6
 * puts it among the parent-hosted set-up actions, checked against the
 * caller's family role); the rule here is the game's own floor, which would
 * also let a mayor who is not a parent switch their own pushes on an adult
 * seat, were the API to let them through. Idempotent by moveId like every
 * move (A28), and logged.
 */
function applySettings(room: Room, seat: string, cmd: Extract<Command, { type: 'settings' }>, now: number): void {
  const c = room.county;
  const id = typeof cmd.moveId === 'string' ? cmd.moveId : '';
  if (!id) throw new GameError(400, 'A settings change needs its moveId.');
  if (c.log.some((r) => r.seat === seat && r.id === id && r.type === 'settings')) return;
  const parent = c.parents.includes(seat);
  const county = cmd.county && typeof cmd.county === 'object' ? (cmd.county as Record<string, unknown>) : null;
  const seatPatch = cmd.seat && typeof cmd.seat === 'object' ? (cmd.seat as Record<string, unknown>) : null;
  if (county && !parent) throw new GameError(403, 'Only a parent can change the county’s settings.');

  const queued: QueuedSettings = {};
  let name: string | null = null;
  let order: string[] | null = null;
  if (county) {
    if ('rivalry' in county) {
      if (!isRivalry(county.rivalry)) throw new GameError(400, 'Rivalry is friendly or spirited.');
      queued.rivalry = county.rivalry;
    }
    if ('mishaps' in county) {
      if (!isMishaps(county.mishaps)) throw new GameError(400, 'Mishaps are mild or off.');
      queued.mishaps = county.mishaps;
    }
    if ('regionalHour' in county) {
      const h = county.regionalHour;
      if (typeof h !== 'number' || !Number.isInteger(h) || h < REGIONAL_HOURS[0] || h > REGIONAL_HOURS[1]) {
        throw new GameError(400, 'The Regional Day falls between 08:00 and 19:00.');
      }
      queued.regionalHour = h;
    }
    if ('name' in county) {
      const n = typeof county.name === 'string' ? county.name.trim().replace(/\s+/g, ' ') : '';
      if (n.length < 2 || n.length > 30) throw new GameError(400, 'A county name is 2 to 30 letters.');
      if (!isClean(n, 'kids')) throw new GameError(400, 'Pick another name for the county.');
      name = n;
    }
    if ('youngestOrder' in county) {
      const seats = Object.keys(c.settings.perSeat).sort();
      const o = county.youngestOrder;
      if (!Array.isArray(o) || o.length !== seats.length || [...o].sort().join() !== seats.join()) {
        throw new GameError(400, 'List every mayor once, youngest first.');
      }
      order = o as string[];
    }
  }

  let target: string | null = null;
  const patch: Partial<SeatSettings> = {};
  if (seatPatch) {
    target = typeof seatPatch.seat === 'string' ? seatPatch.seat : seat;
    // Own keys only: a posted seat of '__proto__' or 'constructor' must not
    // reach Object.prototype through the Object.assign below.
    const now0 = Object.hasOwn(c.settings.perSeat, target) ? c.settings.perSeat[target] : undefined;
    if (!now0) throw new GameError(404, 'That mayor isn’t in this county.');
    if ('profile' in seatPatch) {
      if (seatPatch.profile !== 'kid' && seatPatch.profile !== 'adult') throw new GameError(400, 'A seat is a child’s or an adult’s.');
      patch.profile = seatPatch.profile;
    }
    for (const k of ['pushes', 'pranks', 'answerOnly'] as const) {
      if (!(k in seatPatch)) continue;
      if (typeof seatPatch[k] !== 'boolean') throw new GameError(400, 'Pick on or off.');
      patch[k] = seatPatch[k] as boolean;
    }
    if ('assist' in seatPatch) {
      if (seatPatch.assist !== 'none' && seatPatch.assist !== 'gentle') throw new GameError(400, 'Assists are none or gentle.');
      patch.assist = seatPatch.assist;
    }
    const own = target === seat && now0.profile === 'adult' && Object.keys(patch).every((k) => k === 'pushes');
    if (!parent && !own) throw new GameError(403, 'Only a parent can change a child’s settings.');
  }

  // Everything checked: apply. Name, order and seats now; the rules between days.
  if (name !== null) c.name = room.setup.name = name;
  if (order) c.settings.youngestOrder = order;
  if (target) Object.assign(c.settings.perSeat[target], patch);
  if (Object.keys(queued).length) {
    if (room.phase === 'running') room.queued = { ...room.queued, ...queued };
    else {
      if (queued.rivalry) c.settings.rivalry = room.setup.rivalry = queued.rivalry;
      if (queued.mishaps) c.settings.mishaps = room.setup.mishaps = queued.mishaps;
      if (queued.regionalHour !== undefined) c.regionalHour = room.setup.regionalHour = queued.regionalHour;
    }
  }
  c.log.push({ id, seat, type: 'settings', at: now, atTick: -1, cmd, result: { ok: true, atTick: -1, cost: 0 } });
  while (c.log.length > LOG_KEEP) c.log.shift();
  compactLog(c);
}

// ---- Telemetry ---------------------------------------------------------------------------------------

/** Canary reports this process has seen (§10.15: first-party, logs only; nothing reads these but tests yet). */
export const CANARY = { reports: 0, mismatches: 0 };

/** The moves PRESENCE_PER_MINUTE counts. */
const PRESENCE: ReadonlySet<string> = new Set(['hello', 'seen', 'visit', 'stats']);

/** Per room object, per seat: the times of its recent presence moves, and the last tick a canary mismatch was logged for. */
const RECENT = new WeakMap<object, Map<string, { at: number[]; loggedTick: number | null }>>();

function recentFor(room: Room, seat: string): { at: number[]; loggedTick: number | null } {
  let m = RECENT.get(room);
  if (!m) RECENT.set(room, (m = new Map()));
  let r = m.get(seat);
  if (!r) m.set(seat, (r = { at: [], loggedTick: null }));
  return r;
}

/** One presence move by `seat` at `now`, refused past PRESENCE_PER_MINUTE (in memory: a restart forgets, which is fine). */
function presence(room: Room, seat: string, now: number): void {
  const r = recentFor(room, seat);
  r.at = r.at.filter((t) => t > now - 60_000 && t <= now);
  if (r.at.length >= PRESENCE_PER_MINUTE) throw new GameError(409, 'Slow down a little: try again in a minute.');
  r.at.push(now);
}

/**
 * `stats` {canary: {tick, ok, hash?}, fps?, minFps?, simMs?, thermal?}: the
 * page's telemetry, relayed by the app. A canary mismatch is logged, once
 * per seat per tick. The room does not change, so the registry neither
 * writes it nor tells its phones (`false`).
 */
function noteStats(room: Room, playerId: string, body: Record<string, unknown>, now: number): false {
  const p = room.players.find((q) => q.id === playerId);
  if (!p?.seat || p.status !== 'joined') throw new GameError(403, 'You are not a mayor in this county.');
  presence(room, p.seat, now);
  const canary = body.canary && typeof body.canary === 'object' ? (body.canary as Record<string, unknown>) : null;
  if (!canary) return false;
  CANARY.reports += 1;
  if (canary.ok === false) {
    CANARY.mismatches += 1;
    const tick = typeof canary.tick === 'number' && Number.isFinite(canary.tick) ? canary.tick : null;
    const r = recentFor(room, p.seat);
    if (tick === null || r.loggedTick !== tick) {
      r.loggedTick = tick;
      console.warn(`[hometowns] canary mismatch ${JSON.stringify({ room: room.id, seat: p.seat, tick })}`);
    }
  }
  return false;
}

type MoveFn = (room: Room, playerId: string, body: Record<string, unknown>, now: number) => void | boolean;

export const moves: Record<string, MoveFn> = {
  ...Object.fromEntries(MOVE_TYPES.map((type): [string, MoveFn] => [type, (room, pid, body, now) => playMove(room, pid, type, body, now)])),
  stats: (room, pid, body, now) => noteStats(room, pid, body, now),
};

// ---- The wire ------------------------------------------------------------------------------------------

/** §10.7: this player's frame; `since` (a rev the phone holds) asks for a delta. */
export function toWire(room: Room, meId: string, now: number, since: number | null = null, o: WireOptions = {}) {
  return wireFor(room, meId, now, since, o);
}
