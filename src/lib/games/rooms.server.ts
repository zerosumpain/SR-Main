// The live rooms: an in-memory map, one timer per room, one emitter per room.
//
// In memory on purpose. Production is a single node process and a room lives
// for minutes. The cost is that a deploy ends the games in progress, which the
// phone reads as the room going away. What outlives a room is its RESULT: each
// time a room reaches `finished`, its standings are recorded once for the
// leaderboard (`results.server`), fire-and-forget, so a database that is down
// never touches a game.
//
// The shape copies `$lib/workflows/events.ts`: a map of emitters keyed by id,
// `subscribe` returning its own unsubscribe.
//
// DURABLE rooms (2026-10-22, spec `2026-10-22-family-games-durable-rooms.md`):
// a game that declares `durable` in its rules has its room written to
// `game_rooms` after every accepted change (one coalesced, version-checked
// write per room at a time) and read back lazily after a restart — by the
// next access, the lobby poll, or the sweep. The map below stays the
// authority while the process is up; a database that is down never stops a
// game, it only risks the unsaved moves if the process restarts during the
// outage. A game that does not declare `durable` never touches the store.

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { GameError, MAX_PLAYERS, type Difficulty } from './tap-duel';
import { GAMES, PACES, type GameId, type GameRules, type Pace, type RoomBase } from './catalogue';
import { roundRows, type RoundRow, type Window } from './results';
import type { RoomMeta, RoomStore, SaveResult, StoredRoom } from './room-store';

type WireRoom = ReturnType<GameRules['toWire']>;

/** How long an invite sent from the lobby holds the lobby open for, at least. */
const INVITE_HOLD_MS = 2 * 60_000;

/** A room that closed stays readable briefly, so a phone arriving late sees "closed", not a 404. */
const CLOSED_KEEP_MS = 60_000;
/** Open quick (in-memory) rooms at once, across every host. */
const MAX_ROOMS = 50;
/** Open durable rooms in memory at once: their own budget, so games lasting days never crowd out quick ones. */
export const MAX_DURABLE_ROOMS = 200;
const MAX_OPEN_PER_HOST = 3;
/** Open (not finished, not closed) durable rooms one host may hold, in memory or stored. */
export const MAX_DURABLE_PER_HOST = 5;
/** The hours an async room's player has for a move; anything else asked for is the default. */
export const DEADLINE_HOURS = [12, 24, 48] as const;
export const DEFAULT_DEADLINE_HOURS = 24;
/** How long `flush` holds an answer waiting for its write. */
export const FLUSH_MS = 3_000;
/** A player's open durable rooms are looked up at most this often by their lobby poll. */
const HYDRATE_MS = 60_000;
/** A durable room nobody has touched for this long, saved and with no deadline soon, leaves memory. */
export const EVICT_IDLE_MS = 6 * 3_600_000;
const EVICT_DEADLINE_MS = 3_600_000;
export const SWEEP_MS = 5 * 60_000;
const SWEEP_FIRST_MS = 30_000;
/** Backoff for a write the database refused or never answered: then every minute. */
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
/** Node's timers overflow past 2^31 - 1 ms (24.8 days). */
const MAX_TIMER_MS = 2 ** 31 - 1;

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
  /** The create request's option keys: what the recorder reads back off the room. */
  optionKeys: string[];
  /** Finishes so far: "Play again" in the same room records the next round. */
  round: number;
  /** This finish has been handed to the recorder; cleared when the room leaves `finished`. */
  recorded: boolean;
  /** Who set a new family high score in this finish, once the recorder has said. */
  records: Record<string, Window> | null;

  // ── durable rooms only (all inert for a game that is not durable) ──
  durable: boolean;
  /** Bumped on every change written; the wire's `version`. */
  version: number;
  /** The last version the table confirmed. */
  savedVersion: number;
  /** The row exists (the first write inserts it). */
  stored: boolean;
  writing: Promise<void> | null;
  /** A change landed while a write was in flight: write again when it lands. */
  dirty: boolean;
  /** Consecutive failed writes; the retry timer while there are any. */
  failures: number;
  retry: ReturnType<typeof setTimeout> | null;
  /** Dropped (erased, purged, evicted, reset): writes stop, nothing re-arms. */
  dead: boolean;
  /** `flush` callers waiting for a version to be saved. */
  waiters: { version: number; resolve: () => void }[];
  /** Open streams per player: a player watching the room is not pushed. */
  subscribers: Map<string, number>;
  /** The "your move" push for the current decision, persisted so a restart never rings twice. */
  turnPushed: { key: string; ids: string[] } | null;
  /** Tried this decision in this process (reached or not), so a phone with no token is not retried every change. */
  turnTried: Set<string>;
  finishPushed: boolean;
  /** When the room last changed or was opened, for the lobby's `updatedAt` and eviction. */
  updatedAt: number;
  touchedAt: number;
  /** When this finish happened, for retention. */
  finishedAt: number | null;
}

/** Writes a finished round and says who set a record; `results.server` unless a test swaps it. */
type Recorder = (rows: RoundRow[]) => Promise<Record<string, Window>>;
const defaultRecorder: Recorder = async (rows) => (await import('./results.server')).recordRound(rows);
let recorder: Recorder = defaultRecorder;

/** Tests only: swap the recorder (null puts the database one back). */
export function _setRecorder(fn: Recorder | null): void {
  recorder = fn ?? defaultRecorder;
}

/**
 * The room as `playerId` sees it, with who has had their invite. `since` is
 * what their phone already holds, for a game that sends itself as changes.
 */
function wire(live: Live, playerId: string, now = Date.now(), since: number | null = null): WireRoom {
  let out = live.rules.toWire(live.room, playerId, now, since) as WireRoom & {
    players?: { id: string }[];
    records?: Record<string, Window>;
    durable?: true;
    pace?: Pace;
    version?: number;
  };
  // A finished room says who set a new family high score, once the recorder has answered.
  if (live.room.phase === 'finished' && live.records) out = { ...out, records: live.records };
  if (live.durable) out = { ...out, durable: true, pace: live.room.pace ?? 'live', version: live.version };
  if (!Array.isArray(out.players)) return out;
  return { ...out, players: out.players.map((p) => ({ ...p, sawInvite: live.sawInvite.has(p.id) })) } as WireRoom;
}

/**
 * Hand a room that has just reached `finished` to the recorder, once per
 * finish. Fire-and-forget: a failure is logged and the game never hears of
 * it. When the recorder names a record the room is re-sent with it.
 */
function record(live: Live, now: number): void {
  const { room } = live;
  if (room.phase !== 'finished') {
    if (live.recorded) {
      live.recorded = false;
      live.records = null;
    }
    live.finishedAt = null;
    return;
  }
  if (live.recorded) return;
  live.recorded = true;
  live.finishedAt = now;
  live.round += 1;
  let rows: RoundRow[];
  try {
    rows = roundRows(room, live.rules, live.round, now, live.optionKeys);
  } catch (err) {
    console.error(`[games] ${room.id}: could not read the result`, err);
    return;
  }
  if (!rows.length) return;
  const round = live.round;
  const pending: Promise<void> = recorder(rows)
    .then((records) => {
      if (!Object.keys(records).length) return;
      // Still the same finish: a room that went again, or went away, is not told.
      if (rooms.get(room.id) !== live || live.round !== round || live.room.phase !== 'finished') return;
      live.records = records;
      emit(live);
    })
    .catch((err) => console.error(`[games] ${room.id}: could not record round ${round}`, err))
    .finally(() => recording.delete(pending));
  recording.add(pending);
}

/** Result writes still in flight, so a shutdown can wait for them. */
const recording = new Set<Promise<void>>();

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
  if (live.dead) return;
  const now = Date.now();
  if (live.rules.advance(live.room, now, Math.random)) changed = true;
  record(live, now);
  // Written before it is sent, so the wire's `version` is the one being saved.
  if (changed) persist(live);
  if (changed) emit(live);
  if (live.durable && notifyTurn(live) && !changed) persist(live);
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
  // An async deadline is hours away; a timer that would overflow is re-armed when it fires.
  live.timer = setTimeout(() => settle(live, false), Math.min(MAX_TIMER_MS, Math.max(0, due - Date.now())));
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
  live.touchedAt = Date.now();
  return live;
}

function makeLive(room: RoomBase, rules: GameRules, optionKeys: string[]): Live {
  const now = Date.now();
  const live: Live = {
    room,
    rules,
    emitter: new EventEmitter(),
    timer: null,
    sawInvite: new Set(),
    pushed: new Set(),
    optionKeys,
    round: 0,
    recorded: false,
    records: null,
    durable: !!rules.durable,
    version: 0,
    savedVersion: 0,
    stored: false,
    writing: null,
    dirty: false,
    failures: 0,
    retry: null,
    dead: false,
    waiters: [],
    subscribers: new Map(),
    turnPushed: null,
    turnTried: new Set(),
    finishPushed: false,
    updatedAt: now,
    touchedAt: now,
    finishedAt: null,
  };
  live.emitter.setMaxListeners(20);
  return live;
}

// ── the store ────────────────────────────────────────────────────────────────

/** Answers as if every write landed and nothing was ever stored: durable games play as in-memory ones. */
const NO_STORE: RoomStore = {
  insert: async () => true,
  save: async () => 'ok',
  load: async () => null,
  openFor: async () => [],
  countOpenByHost: async () => 0,
  due: async () => [],
  purge: async () => [],
};
let storeOverride: RoomStore | null = null;
let dbStore: Promise<RoomStore> | null = null;
let warnedNoStore = false;

/**
 * The table, unless a test swapped in its own. With no database configured —
 * or under vitest, where a test that wants rooms stored passes a store — it
 * is the no-op store, said once.
 */
async function store(): Promise<RoomStore> {
  if (storeOverride) return storeOverride;
  if (!env.DATABASE_URL || process.env.VITEST) {
    if (!warnedNoStore && !process.env.VITEST) console.warn('[games] no DATABASE_URL: durable rooms are kept in memory only');
    warnedNoStore = true;
    return NO_STORE;
  }
  dbStore ??= import('./room-store.server').then((m) => m.dbRoomStore);
  return dbStore;
}

/** Tests only: swap the store (null puts the database one back). */
export function _setRoomStore(next: RoomStore | null): void {
  storeOverride = next;
}

/** Whether any game the registry hosts is durable; when none is, nothing here touches the store. */
function anyDurable(): boolean {
  return Object.values(GAMES).some((r) => !!r?.durable);
}

function metaOf(live: Live): RoomMeta {
  return {
    optionKeys: live.optionKeys,
    round: live.round,
    recorded: live.recorded,
    sawInvite: [...live.sawInvite],
    pushed: [...live.pushed],
    turnPushed: live.turnPushed ? { key: live.turnPushed.key, ids: [...live.turnPushed.ids] } : null,
    finishPushed: live.finishPushed,
  };
}

/** The row for the room as it is now. The state is a JSON copy: what is stored is what a restart reads back. */
function snapshot(live: Live): StoredRoom {
  const { room, rules } = live;
  const due = rules.deadline(room);
  const now = Date.now();
  return {
    id: room.id,
    game: room.game,
    stateSchema: rules.durable?.schema ?? 1,
    pace: room.pace ?? 'live',
    phase: room.phase,
    hostId: room.hostId,
    playerIds: room.players.map((p) => p.id),
    state: JSON.parse(JSON.stringify(room)) as Record<string, unknown>,
    meta: metaOf(live),
    version: live.version,
    dueAt: due === null || !Number.isFinite(due) ? null : new Date(due),
    updatedAt: new Date(live.updatedAt),
    finishedAt: room.phase === 'finished' ? new Date(live.finishedAt ?? live.updatedAt) : null,
    closedAt: room.phase === 'closed' ? new Date(now) : null,
  };
}

/**
 * Count a change to a durable room and see that it is written. Writes are one
 * at a time per room; a change while one is in flight is picked up by the
 * next, so a burst of moves is one or two writes, each of the latest room.
 */
function persist(live: Live): void {
  if (!live.durable || live.dead) return;
  live.version += 1;
  live.updatedAt = Date.now();
  live.touchedAt = live.updatedAt;
  live.dirty = true;
  if (live.retry) {
    clearTimeout(live.retry);
    live.retry = null;
  }
  startWriting(live);
}

function startWriting(live: Live): void {
  if (live.writing || live.dead) return;
  live.writing = writeLoop(live).finally(() => {
    live.writing = null;
    // A change that landed after the loop's last look (between its end and
    // this callback) is written now; a pending retry has it otherwise.
    if (live.dirty && !live.retry && !live.dead) startWriting(live);
  });
}

function settleWaiters(live: Live): void {
  const done = live.dead || !live.durable;
  live.waiters = live.waiters.filter((w) => {
    if (!done && w.version > live.savedVersion) return true;
    w.resolve();
    return false;
  });
}

async function writeLoop(live: Live): Promise<void> {
  const id = live.room.id;
  while (live.dirty && !live.dead) {
    live.dirty = false;
    let row: StoredRoom;
    let result: SaveResult | 'taken';
    try {
      const s = await store();
      row = snapshot(live);
      if (live.stored) result = await s.save(row, live.savedVersion);
      else result = (await s.insert(row)) ? 'ok' : 'taken';
    } catch (err) {
      live.dirty = true;
      retryLater(live, err);
      return;
    }
    if (live.dead) return;
    if (live.failures) {
      console.log(`[games] ${id}: saved again after ${live.failures} failed write(s)`);
      live.failures = 0;
    }
    if (result === 'ok') {
      live.stored = true;
      live.savedVersion = row.version;
      settleWaiters(live);
      continue;
    }
    if (result === 'taken') {
      // Another room already holds this id (48 random bits: not expected). Play on unsaved.
      console.error(`[games] ${id}: a stored room already has this id; this one is kept in memory only`);
      live.durable = false;
      settleWaiters(live);
      return;
    }
    if (result === 'missing') {
      // Erased or purged under us: the game is over for everyone in it.
      console.error(`[games] ${id}: its stored row is gone; closing the room`);
      drop(live);
      return;
    }
    // 'stale': somebody else wrote this room. Theirs wins; ours is dropped.
    console.error(`[games] ${id}: lost a write race; reloading the stored room`);
    await reload(live);
    return;
  }
}

function retryLater(live: Live, err: unknown): void {
  if (!live.failures) {
    console.error(`[games] ${live.room.id}: could not save the room (play goes on in memory; retrying)`, (err as Error)?.message ?? err);
  }
  const delay = RETRY_MS[Math.min(live.failures, RETRY_MS.length - 1)];
  live.failures += 1;
  if (live.retry) clearTimeout(live.retry);
  live.retry = setTimeout(() => {
    live.retry = null;
    startWriting(live);
  }, delay);
  live.retry.unref?.();
}

/** The stored room as this game can play it now, or null (unknown schema and no `revive`). */
function revived(rules: GameRules, row: StoredRoom): RoomBase | null {
  if (!rules.durable) return null;
  if (row.stateSchema === rules.durable.schema) return row.state as unknown as RoomBase;
  try {
    return rules.durable.revive?.(row.state, row.stateSchema) ?? null;
  } catch (err) {
    console.error(`[games] ${row.id}: could not revive schema ${row.stateSchema}`, err);
    return null;
  }
}

function applyRow(live: Live, row: StoredRoom, room: RoomBase): void {
  const meta = (row.meta ?? {}) as Partial<RoomMeta>;
  live.room = room;
  live.optionKeys = Array.isArray(meta.optionKeys) ? meta.optionKeys : [];
  live.round = typeof meta.round === 'number' ? meta.round : 0;
  live.recorded = meta.recorded === true;
  live.sawInvite = new Set(Array.isArray(meta.sawInvite) ? meta.sawInvite : []);
  live.pushed = new Set(Array.isArray(meta.pushed) ? meta.pushed : []);
  live.turnPushed =
    meta.turnPushed && typeof meta.turnPushed.key === 'string' && Array.isArray(meta.turnPushed.ids)
      ? { key: meta.turnPushed.key, ids: [...meta.turnPushed.ids] }
      : null;
  live.turnTried = new Set();
  live.finishPushed = meta.finishPushed === true;
  live.version = live.savedVersion = row.version;
  live.stored = true;
  live.dirty = false;
  live.updatedAt = row.updatedAt.getTime();
  live.finishedAt = row.finishedAt ? row.finishedAt.getTime() : null;
}

/** After a lost write race: take the stored room as the truth and tell the phones. */
async function reload(live: Live): Promise<void> {
  let row: StoredRoom | null;
  try {
    row = await (await store()).load(live.room.id);
  } catch (err) {
    live.dirty = true;
    retryLater(live, err);
    return;
  }
  if (live.dead) return;
  const room = row ? revived(live.rules, row) : null;
  if (!row || !room) {
    drop(live);
    return;
  }
  applyRow(live, row, room);
  settleWaiters(live);
  emit(live);
  settle(live, false);
}

/** Close a room in memory now and tell its phones it is gone; the row is not touched. */
function drop(live: Live): void {
  live.dead = true;
  if (live.timer) clearTimeout(live.timer);
  if (live.retry) clearTimeout(live.retry);
  live.timer = live.retry = null;
  if (rooms.get(live.room.id) === live) rooms.delete(live.room.id);
  settleWaiters(live);
  live.emitter.emit('gone');
  live.emitter.removeAllListeners();
}

/** Rooms whose stored rows were erased or purged: closed in memory, their phones told `gone`. */
export function dropRooms(ids: readonly string[]): void {
  for (const id of ids) {
    const live = rooms.get(id);
    if (live) drop(live);
  }
}

/**
 * Resolves once this room's changes so far are saved, or after `ms` (the
 * answer then goes anyway and the write keeps retrying). Immediate for a
 * room that is not durable.
 */
export function flush(id: string, ms = FLUSH_MS): Promise<void> {
  const live = rooms.get(id);
  if (!live || !live.durable || live.dead || live.savedVersion >= live.version) return Promise.resolve();
  const version = live.version;
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref?.();
    function done() {
      clearTimeout(timer);
      resolve();
    }
    live.waiters.push({ version, resolve: done });
  });
}

/**
 * Shutdown: write every durable room's unsaved changes now (a retry waiting
 * on its back-off goes at once) and wait for them, and for result rows still
 * being written, for at most `ms`. Without this a deploy's SIGTERM drops the
 * last move, or a timer's auto-move, made just before it.
 */
export async function drainRoomWrites(ms = 2_000): Promise<void> {
  const waits: Promise<void>[] = [...recording];
  for (const live of rooms.values()) {
    if (!live.durable || live.dead || live.savedVersion >= live.version) continue;
    if (live.retry) {
      clearTimeout(live.retry);
      live.retry = null;
    }
    live.dirty = true;
    startWriting(live);
    waits.push(flush(live.room.id, ms));
  }
  if (!waits.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  await Promise.race([Promise.allSettled(waits), deadline]);
  clearTimeout(timer);
}

// ── reading rooms back ───────────────────────────────────────────────────────

const loading = new Map<string, Promise<void>>();
/** When each player's lobby last looked their stored rooms up. */
const hydrated = new Map<string, number>();
const ROOM_ID = /^g_[0-9a-f]{12}$/;

/**
 * Make sure a stored room is in memory before it is read, moved or followed.
 * A room already here, an id that is not a room's, or one not stored (or
 * closed) is left as it is — the synchronous call after it answers 404 as
 * today. A database that cannot be reached is a 503, not "finished".
 */
export async function ensureRoom(id: string): Promise<void> {
  if (rooms.has(id) || !ROOM_ID.test(id) || !anyDurable()) return;
  let pending = loading.get(id);
  if (!pending) {
    pending = loadRoom(id).finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  await pending;
}

/** Postgres "permission denied" (42501) or "no such table" (42P01), however the driver wraps it. */
export function storeUnusable(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | null, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === '42501' || e.code === '42P01') return true;
  }
  return false;
}

async function loadRoom(id: string): Promise<void> {
  const s = await store();
  let row: StoredRoom | null;
  try {
    row = await s.load(id);
  } catch (err) {
    console.error(`[games] ${id}: could not read the stored room`, (err as Error)?.message ?? err);
    // No table yet, or no grant on it (the window between the release that
    // creates it and the hand-applied GRANT): nothing durable can have been
    // stored, so the room is simply not here — the old 404, which a phone holding
    // a quick game from before a restart reads as "ended" rather than retrying.
    if (storeUnusable(err)) return;
    throw new GameError(503, "Games can't be reached right now. Try again shortly.");
  }
  if (!row || rooms.has(id)) return;
  const rules = (GAMES as Record<string, GameRules | undefined>)[row.game];
  if (!rules?.durable) {
    console.error(`[games] ${id}: stored as ${row.game}, which is not a durable game here`);
    return;
  }
  const room = revived(rules, row);
  if (!room) {
    console.error(`[games] ${id}: stored under schema ${row.stateSchema}, which ${row.game} cannot read; closing it`);
    const now = new Date();
    await s
      .save({ ...row, phase: 'closed', closedAt: now, updatedAt: now, version: row.version + 1 }, row.version)
      .catch(() => {});
    return;
  }
  const live = makeLive(room, rules, []);
  applyRow(live, row, room);
  rooms.set(id, live);
  const now = Date.now();
  // A live game was paused by the restart, not timed out: its clock restarts now.
  let resumed = false;
  if (room.pace !== 'async' && room.phase !== 'lobby' && room.phase !== 'finished' && rules.resume) {
    rules.resume(room, now, Math.max(0, now - row.updatedAt.getTime()));
    resumed = true;
  }
  // An async deadline that passed while nobody was here is caught up now: one step.
  settle(live, resumed);
}

/**
 * Bring this player's open stored rooms into memory, so the lobby (invites,
 * "Your games") reads them as it reads any other. At most once a minute per
 * player; a database that is down is logged and the lobby answers from memory.
 */
export async function hydrateFor(playerId: string, now = Date.now()): Promise<void> {
  if (!anyDurable()) return;
  const last = hydrated.get(playerId);
  if (last !== undefined && now - last < HYDRATE_MS) return;
  hydrated.set(playerId, now);
  try {
    const ids = await (await store()).openFor(playerId, 20);
    for (const id of ids) await ensureRoom(id).catch(() => {});
  } catch (err) {
    // A table not yet granted (or not yet created) stays throttled: the lobby
    // would otherwise query and log on every poll until the GRANT lands.
    if (!storeUnusable(err)) hydrated.delete(playerId);
    console.error('[games] could not list stored rooms for the lobby', (err as Error)?.message ?? err);
  }
}

// ── "your move" pushes ───────────────────────────────────────────────────────

/** Rings phones for a room; returns the player ids reached. `invite-push.server` unless a test swaps it. */
type TurnPusher = (kind: 'turn' | 'finished', roomId: string, ids: string[]) => Promise<string[]>;
const defaultTurnPusher: TurnPusher = async (kind, roomId, ids) => {
  const m = await import('./invite-push.server');
  return kind === 'turn' ? m.pushTurn(roomId, ids) : m.pushFinished(roomId, ids);
};
let turnPusher: TurnPusher = defaultTurnPusher;

/** Tests only: swap the turn pusher (null puts APNs back). */
export function _setTurnPusher(fn: TurnPusher | null): void {
  turnPusher = fn ?? defaultTurnPusher;
}

const watching = (live: Live, id: string) => (live.subscribers.get(id) ?? 0) > 0;
const joinedIds = (room: RoomBase) => room.players.filter((p) => p.status === 'joined').map((p) => p.id);

/**
 * After a change to an async durable room: push whoever it now waits on (once
 * per decision, never to a phone streaming the room), or everyone once when
 * it finishes. True when the push bookkeeping changed and needs writing.
 */
function notifyTurn(live: Live): boolean {
  const { room, rules } = live;
  if (room.pace !== 'async' || live.dead) return false;
  if (room.phase === 'finished') {
    if (live.finishPushed) return false;
    live.finishPushed = true;
    const ids = joinedIds(room).filter((id) => !watching(live, id));
    if (ids.length) {
      void turnPusher('finished', room.id, ids).catch((err) => console.error(`[games] ${room.id}: finish push failed`, err));
    }
    return true;
  }
  let changed = false;
  if (live.finishPushed) {
    live.finishPushed = false;
    changed = true;
  }
  const waiting = rules.waitingOn?.(room) ?? null;
  if (!waiting) return changed;
  if (live.turnPushed?.key !== waiting.key) {
    live.turnPushed = { key: waiting.key, ids: [] };
    live.turnTried = new Set();
    changed = true;
  }
  const turn = live.turnPushed!;
  const joined = new Set(joinedIds(room));
  const ids = waiting.ids.filter((id) => joined.has(id) && !turn.ids.includes(id) && !live.turnTried.has(id) && !watching(live, id));
  if (!ids.length) return changed;
  for (const id of ids) live.turnTried.add(id);
  void turnPusher('turn', room.id, ids)
    .then((reached) => {
      if (live.dead || live.turnPushed !== turn) return;
      const fresh = reached.filter((id) => !turn.ids.includes(id));
      if (!fresh.length) return;
      turn.ids.push(...fresh);
      persist(live);
    })
    .catch((err) => console.error(`[games] ${room.id}: turn push failed`, err));
  return changed;
}

/** What a "your move" banner says about a room, or null when it waits on nobody. */
export function turnFor(id: string): { roomId: string; game: GameId; line: string | null; dueAt: number | null } | null {
  const live = rooms.get(id);
  if (!live) return null;
  const waiting = live.rules.waitingOn?.(live.room) ?? null;
  if (!waiting) return null;
  return { roomId: id, game: live.room.game, line: waiting.line ?? null, dueAt: live.rules.deadline(live.room) };
}

/** Who won a finished room, by name, for its "is over" banner. Null unless finished. */
export function finishFor(id: string): { roomId: string; game: GameId; winners: string[] } | null {
  const live = rooms.get(id);
  if (!live || live.room.phase !== 'finished') return null;
  const { room } = live;
  let winnerIds: string[] = [];
  try {
    const w = live.rules.toWire(room, room.hostId, Date.now()) as { winnerIds?: unknown };
    if (Array.isArray(w.winnerIds)) winnerIds = w.winnerIds.filter((x): x is string => typeof x === 'string');
  } catch {
    winnerIds = [];
  }
  const winners = winnerIds.map((pid) => room.players.find((p) => p.id === pid)?.name).filter((n): n is string => !!n);
  return { roomId: id, game: room.game, winners };
}

// ── the sweep ────────────────────────────────────────────────────────────────

/**
 * One pass: wake stored rooms whose deadline has come (rehydrating settles
 * them, so the auto-move happens and the push goes), drop idle saved rooms
 * from memory, and delete rows past retention.
 */
export async function sweepRooms(now = Date.now()): Promise<{ woken: number; evicted: number; purged: number }> {
  const out = { woken: 0, evicted: 0, purged: 0 };
  if (!anyDurable()) return out;
  const s = await store();
  for (const id of await s.due(new Date(now + 60_000), 50)) {
    if (rooms.has(id)) continue; // its own timer has it
    await ensureRoom(id).catch(() => {});
    if (rooms.has(id)) out.woken += 1;
  }
  for (const live of [...rooms.values()]) {
    if (!live.durable || live.dead || live.writing || live.dirty) continue;
    if (live.savedVersion !== live.version || live.room.phase === 'closed') continue;
    if ([...live.subscribers.values()].some((n) => n > 0)) continue;
    if (now - live.touchedAt < EVICT_IDLE_MS) continue;
    const due = live.rules.deadline(live.room);
    if (due !== null && due <= now + EVICT_DEADLINE_MS) continue;
    // The row stays; the next access reads it back. No `gone`: nothing ended.
    live.dead = true;
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
    rooms.delete(live.room.id);
    live.emitter.removeAllListeners();
    for (const p of live.room.players) hydrated.delete(p.id);
    out.evicted += 1;
  }
  const purged = await s.purge(new Date(now));
  dropRooms(purged);
  out.purged = purged.length;
  return out;
}

let sweeping: ReturnType<typeof setInterval> | null = null;

/** Every five minutes, and once 30 s after boot. The web process only (`runsService('background')`). */
export function startGameRoomSweep(): void {
  if (sweeping) return;
  const run = () => void sweepRooms().catch((err) => console.error('[games] room sweep failed', (err as Error)?.message ?? err));
  sweeping = setInterval(run, SWEEP_MS);
  sweeping.unref?.();
  setTimeout(run, SWEEP_FIRST_MS).unref?.();
}

function inRoom(room: RoomBase, playerId: string): boolean {
  return room.players.some((p) => p.id === playerId);
}

/**
 * Throw the refusal `createGame` would, without creating anything — so a
 * caller that meters creation (Quiz Night's daily cap) can ask first and not
 * charge for a game that was never going to start.
 */
export function canCreate(hostId: string, game?: GameId): void {
  const durable = !!(game && GAMES[game]?.durable);
  const open = [...rooms.values()].filter(
    (l) => l.durable === durable && l.room.phase !== 'closed' && l.room.phase !== 'finished',
  );
  if (open.length >= (durable ? MAX_DURABLE_ROOMS : MAX_ROOMS)) {
    throw new GameError(409, 'Too many games running. Try again shortly.');
  }
  // A durable game's own cap is `canCreateDurable` (its rooms last days, not minutes).
  if (durable) return;
  if (open.filter((l) => !l.durable && l.room.hostId === hostId).length >= MAX_OPEN_PER_HOST) {
    throw new GameError(409, 'Finish one of your games first.');
  }
}

/**
 * The cap on a host's open durable rooms, counted in the table (evicted async
 * games included) and in memory. A database that cannot answer refuses the
 * game rather than start one that cannot be saved.
 */
export async function canCreateDurable(hostId: string): Promise<void> {
  let stored: number;
  try {
    stored = await (await store()).countOpenByHost(hostId);
  } catch (err) {
    console.error('[games] could not count stored rooms', (err as Error)?.message ?? err);
    throw new GameError(503, "Games can't be saved right now. Try again shortly.");
  }
  const here = [...rooms.values()].filter(
    (l) => l.durable && !l.dead && l.room.hostId === hostId && l.room.phase !== 'finished' && l.room.phase !== 'closed',
  ).length;
  if (Math.max(stored, here) >= MAX_DURABLE_PER_HOST) throw new GameError(409, 'Finish one of your games first.');
}

/**
 * A game's pace options, made safe: `pace` only as one this game offers
 * (otherwise 'live'), and `deadlineHours` only for async, as 12, 24 or 48.
 * Keys not sent stay unsent, so a game that knows nothing of pace sees what it always did.
 */
function paceOptions(rules: GameRules, options: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!options || !('pace' in options)) return options;
  const offered: readonly Pace[] = rules.paces ?? ['live'];
  const asked = (PACES as readonly unknown[]).includes(options.pace) ? (options.pace as Pace) : 'live';
  const pace: Pace = offered.includes(asked) ? asked : 'live';
  const hours = (DEADLINE_HOURS as readonly unknown[]).includes(options.deadlineHours)
    ? (options.deadlineHours as number)
    : DEFAULT_DEADLINE_HOURS;
  return { ...options, pace, deadlineHours: pace === 'async' ? hours : undefined };
}

export function createGame(input: {
  game: GameId;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
}): WireRoom {
  // A finished game waits ten minutes for "Play again"; it is not one the host is still running.
  canCreate(input.host.id, input.game);
  const now = Date.now();
  const rules = GAMES[input.game];
  const room = rules.createRoom({
    id: 'g_' + randomBytes(6).toString('hex'),
    host: input.host,
    invite: input.invite,
    difficulty: input.difficulty,
    options: paceOptions(rules, input.options),
    now,
  });
  const live = makeLive(room, rules, Object.keys(input.options ?? {}));
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
  // A round that finished in that catch-up is recorded before the action can
  // move the room on ("Play again" leaves `finished` at once).
  record(live, now);
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
      live.turnPushed = null;
      live.turnTried = new Set();
    }
  } catch (err) {
    settle(live, moved);
    throw err;
  }
  settle(live, true);
  // A phone that says what it holds (`since`) is answered with only what is new.
  const since = typeof body.since === 'number' && Number.isInteger(body.since) ? body.since : null;
  return wire(live, playerId, Date.now(), since);
}

/**
 * The API has checked `playerId` is a parent: a game that cares (Manhunt)
 * remembers it for the host handoff. Nothing on the wire changes.
 */
export function noteParent(id: string, playerId: string): void {
  const live = get(id);
  if (inRoom(live.room, playerId)) live.rules.noteParent?.(live.room, playerId);
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
  const cap = live.rules.maxPlayers ?? MAX_PLAYERS;
  if (room.players.filter((p) => inPlay(p.status)).length + adding.length > cap) {
    throw refuse(400, `Up to ${cap} players.`);
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
      persist(live);
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
  const fresh = playerIds.filter((p) => !live.pushed.has(p));
  for (const p of fresh) live.pushed.add(p);
  if (fresh.length) persist(live);
}

/** One row of the lobby's `rooms`; a durable room also says whose move it is. */
export interface RoomSummary {
  id: string;
  game: GameId;
  phase: string;
  hostName: string;
  durable?: true;
  pace?: Pace;
  myTurn?: boolean;
  waitingFor?: string[] | null;
  dueAt?: number | null;
  updatedAt?: number;
}

/**
 * Rooms this player is sitting in, so a phone that lost its screen can find
 * its way back — and, for durable rooms, resume a game days later. A room
 * that is not durable is listed exactly as before (the app defaults the
 * durable fields when they are absent).
 */
export function roomsFor(playerId: string): RoomSummary[] {
  const out: RoomSummary[] = [];
  for (const live of rooms.values()) {
    const { room } = live;
    if (room.phase === 'closed') continue;
    if (!room.players.some((p) => p.id === playerId && p.status === 'joined')) continue;
    const host = room.players.find((p) => p.id === room.hostId);
    const row: RoomSummary = { id: room.id, game: room.game, phase: room.phase, hostName: host?.name ?? 'Someone' };
    if (!live.durable) {
      out.push(row);
      continue;
    }
    const waiting = live.rules.waitingOn?.(room) ?? null;
    const names = (waiting?.ids ?? [])
      .map((id) => room.players.find((p) => p.id === id)?.name)
      .filter((n): n is string => !!n);
    out.push({
      ...row,
      durable: true,
      pace: room.pace ?? 'live',
      myTurn: !!waiting?.ids.includes(playerId),
      waitingFor: names.length ? names : null,
      dueAt: live.rules.deadline(room),
      updatedAt: live.updatedAt,
    });
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
  // Frames on one stream arrive in order, so after the first (the whole room)
  // each can carry only what changed since the last — for a game that can.
  let since: number | null = null;
  const change = () => {
    onRoom(wire(live, playerId, Date.now(), since));
    since = live.rules.revision?.(live.room) ?? null;
  };
  live.emitter.on('change', change);
  live.emitter.once('gone', onGone);
  // A player watching the room is not pushed about it.
  live.subscribers.set(playerId, (live.subscribers.get(playerId) ?? 0) + 1);
  change();
  let open = true;
  return () => {
    live.emitter.off('change', change);
    live.emitter.off('gone', onGone);
    if (!open) return;
    open = false;
    const n = (live.subscribers.get(playerId) ?? 1) - 1;
    if (n > 0) live.subscribers.set(playerId, n);
    else live.subscribers.delete(playerId);
    live.touchedAt = Date.now();
  };
}

/** Tests only. */
export function _resetRooms(): void {
  for (const live of rooms.values()) {
    live.dead = true;
    if (live.timer) clearTimeout(live.timer);
    if (live.retry) clearTimeout(live.retry);
    settleWaiters(live);
  }
  rooms.clear();
  loading.clear();
  hydrated.clear();
  recording.clear();
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
