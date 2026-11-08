// The durable rooms' table (`game_rooms`) behind the registry's `RoomStore`.
// One statement per write, so a room's state, meta, phase and version always
// change together; every save is compare-and-set on `version`.
//
// Players are the games' hashed ids, never an email. Read and written by
// Main's runtime role: `scripts/migrations/2026-10-22-game-rooms-runtime-grant.sql`.

import { and, arrayContains, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { gameRooms } from '$lib/db/schema';
import { ABANDONED_KEEP_MS, CLOSED_KEEP_MS, FINISHED_KEEP_MS, type RoomMeta, type RoomStore, type StoredRoom } from './room-store';
import type { Pace } from './catalogue';

const values = (row: StoredRoom) => ({
  id: row.id,
  game: row.game,
  stateSchema: row.stateSchema,
  pace: row.pace,
  phase: row.phase,
  hostId: row.hostId,
  playerIds: row.playerIds,
  state: row.state,
  meta: row.meta,
  version: row.version,
  dueAt: row.dueAt,
  updatedAt: row.updatedAt,
  finishedAt: row.finishedAt,
  closedAt: row.closedAt,
});

export const dbRoomStore: RoomStore = {
  async insert(row) {
    const made = await db.insert(gameRooms).values(values(row)).onConflictDoNothing().returning({ id: gameRooms.id });
    return made.length > 0;
  },

  async save(row, expected) {
    const { id: _id, ...set } = values(row);
    const done = await db
      .update(gameRooms)
      .set(set)
      .where(and(eq(gameRooms.id, row.id), eq(gameRooms.version, expected)))
      .returning({ id: gameRooms.id });
    if (done.length) return 'ok';
    const [have] = await db.select({ version: gameRooms.version }).from(gameRooms).where(eq(gameRooms.id, row.id)).limit(1);
    return have ? 'stale' : 'missing';
  },

  async load(id) {
    const [r] = await db
      .select()
      .from(gameRooms)
      .where(and(eq(gameRooms.id, id), isNull(gameRooms.closedAt)))
      .limit(1);
    if (!r) return null;
    return {
      id: r.id,
      game: r.game,
      stateSchema: r.stateSchema,
      pace: (r.pace === 'async' ? 'async' : 'live') as Pace,
      phase: r.phase,
      hostId: r.hostId,
      playerIds: r.playerIds,
      state: r.state as Record<string, unknown>,
      meta: (r.meta ?? {}) as RoomMeta,
      version: r.version,
      dueAt: r.dueAt,
      updatedAt: r.updatedAt,
      finishedAt: r.finishedAt,
      closedAt: r.closedAt,
    };
  },

  async openFor(playerId, limit) {
    const rows = await db
      .select({ id: gameRooms.id })
      .from(gameRooms)
      .where(and(isNull(gameRooms.closedAt), arrayContains(gameRooms.playerIds, [playerId])))
      .orderBy(desc(gameRooms.updatedAt))
      .limit(limit);
    return rows.map((r) => r.id);
  },

  async countOpenByHost(hostId) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(gameRooms)
      .where(and(eq(gameRooms.hostId, hostId), isNull(gameRooms.closedAt), isNull(gameRooms.finishedAt)));
    return Number(r?.n ?? 0);
  },

  async due(before, limit) {
    const rows = await db
      .select({ id: gameRooms.id })
      .from(gameRooms)
      .where(and(isNull(gameRooms.closedAt), lte(gameRooms.dueAt, before)))
      .orderBy(asc(gameRooms.dueAt))
      .limit(limit);
    return rows.map((r) => r.id);
  },

  async purge(now) {
    const t = now.getTime();
    const rows = await db
      .delete(gameRooms)
      .where(
        sql`(${gameRooms.finishedAt} is not null and ${gameRooms.finishedAt} < ${new Date(t - FINISHED_KEEP_MS)})
          or (${gameRooms.finishedAt} is null and ${gameRooms.closedAt} is not null and ${gameRooms.closedAt} < ${new Date(t - CLOSED_KEEP_MS)})
          or (${gameRooms.updatedAt} < ${new Date(t - ABANDONED_KEEP_MS)})`,
      )
      .returning({ id: gameRooms.id });
    return rows.map((r) => r.id);
  },
};
