// Where a durable room is kept between processes: the shape of a stored row
// and the store the registry writes it through (`rooms.server`). The database
// store is `room-store.server.ts`; this file also holds the in-memory store
// the tests use, which keeps the same contract (compare-and-set on `version`,
// closed rows never loaded, the retention windows).
//
// Spec: docs/superpowers/specs/2026-10-22-family-games-durable-rooms.md.

import type { Pace } from './catalogue';

/** What the registry keeps beside a room that must outlive a restart. */
export interface RoomMeta {
  optionKeys: string[];
  round: number;
  recorded: boolean;
  sawInvite: string[];
  pushed: string[];
  /** The "your move" push: which decision it was for, and whose phones it reached. */
  turnPushed: { key: string; ids: string[] } | null;
  finishPushed: boolean;
}

export interface StoredRoom {
  id: string;
  game: string;
  stateSchema: number;
  pace: Pace;
  phase: string;
  hostId: string;
  playerIds: string[];
  state: Record<string, unknown>;
  meta: RoomMeta;
  version: number;
  dueAt: Date | null;
  updatedAt: Date;
  finishedAt: Date | null;
  closedAt: Date | null;
}

export type SaveResult = 'ok' | 'stale' | 'missing';

export interface RoomStore {
  /** The first write of a room. False: that id already exists. */
  insert(row: StoredRoom): Promise<boolean>;
  /** Compare-and-set: written only when the stored version is `expected`. */
  save(row: StoredRoom, expected: number): Promise<SaveResult>;
  /** Null for a missing or closed room. */
  load(id: string): Promise<StoredRoom | null>;
  /** Not-closed rooms with this player in them, most recently written first. */
  openFor(playerId: string, limit: number): Promise<string[]>;
  /** Rooms this host holds that are neither finished nor closed. */
  countOpenByHost(hostId: string): Promise<number>;
  /** Not-closed rooms whose deadline is at or before `before`, soonest first. */
  due(before: Date, limit: number): Promise<string[]>;
  /** The retention delete; returns the ids removed. */
  purge(now: Date): Promise<string[]>;
}

const DAY_MS = 86_400_000;
/** A finished room is kept a week after it finished. */
export const FINISHED_KEEP_MS = 7 * DAY_MS;
/** A room nobody has written to in a month is abandoned. */
export const ABANDONED_KEEP_MS = 30 * DAY_MS;
/** A room that closed without finishing (lobby expired, everyone left) is kept a day. */
export const CLOSED_KEEP_MS = DAY_MS;

/** Whether the retention rules remove this row at `now`. PURE; the SQL in `room-store.server` says the same. */
export function expired(row: Pick<StoredRoom, 'finishedAt' | 'closedAt' | 'updatedAt'>, now: number): boolean {
  if (row.finishedAt && row.finishedAt.getTime() < now - FINISHED_KEEP_MS) return true;
  if (!row.finishedAt && row.closedAt && row.closedAt.getTime() < now - CLOSED_KEEP_MS) return true;
  return row.updatedAt.getTime() < now - ABANDONED_KEEP_MS;
}

const copy = (row: StoredRoom): StoredRoom => ({
  ...row,
  playerIds: [...row.playerIds],
  state: structuredClone(row.state),
  meta: structuredClone(row.meta),
});

/** The table in a Map, for tests. `rows` is exposed so a test can read or tamper with what is stored. */
export function memoryRoomStore(): RoomStore & { rows: Map<string, StoredRoom> } {
  const rows = new Map<string, StoredRoom>();
  return {
    rows,
    async insert(row) {
      if (rows.has(row.id)) return false;
      rows.set(row.id, copy(row));
      return true;
    },
    async save(row, expected) {
      const have = rows.get(row.id);
      if (!have) return 'missing';
      if (have.version !== expected) return 'stale';
      rows.set(row.id, copy(row));
      return 'ok';
    },
    async load(id) {
      const row = rows.get(id);
      return row && !row.closedAt ? copy(row) : null;
    },
    async openFor(playerId, limit) {
      return [...rows.values()]
        .filter((r) => !r.closedAt && r.playerIds.includes(playerId))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit)
        .map((r) => r.id);
    },
    async countOpenByHost(hostId) {
      return [...rows.values()].filter((r) => r.hostId === hostId && !r.closedAt && !r.finishedAt).length;
    },
    async due(before, limit) {
      return [...rows.values()]
        .filter((r) => !r.closedAt && r.dueAt && r.dueAt.getTime() <= before.getTime())
        .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
        .slice(0, limit)
        .map((r) => r.id);
    },
    async purge(now) {
      const gone = [...rows.values()].filter((r) => expired(r, now.getTime())).map((r) => r.id);
      for (const id of gone) rows.delete(id);
      return gone;
    },
  };
}
