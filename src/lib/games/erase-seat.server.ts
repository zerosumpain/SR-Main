// The database half of erasing one seat (`erase-seat.ts` holds the rules):
// inside the account erasure's transaction, rewrite each stored room of a
// game that keeps its rooms through an erasure, so the delete that follows
// in `$lib/people/erase` no longer matches it. Every other room is left for
// that delete exactly as before — and when no game defines `erasePlayer`,
// this reads nothing at all.

import { and, arrayOverlaps, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '$lib/db';
import { gameRooms } from '$lib/db/schema';
import { GAMES, type GameRules, type Pace } from './catalogue';
import { keepSeat } from './erase-seat';
import type { RoomMeta, StoredRoom } from './room-store';

/** The games whose rooms an erasure keeps. */
export function keepingGames(games: Record<string, GameRules | undefined> = GAMES): string[] {
  return Object.entries(games)
    .filter(([, rules]) => !!rules?.durable?.erasePlayer)
    .map(([id]) => id);
}

/**
 * Take `players` (every id of the person being erased) out of the stored
 * rooms that keep their seat, locking each row for the transaction so a
 * concurrent save waits and then loses its compare-and-set. Returns the ids
 * of the rooms kept; the caller reloads their in-memory copies once the
 * transaction commits. A room the game cannot erase a seat from is not
 * touched here, and the caller's delete removes it.
 */
export async function keepErasedSeats(
  tx: DbExecutor,
  players: readonly string[],
  now = Date.now(),
  games: Record<string, GameRules | undefined> = GAMES,
): Promise<string[]> {
  const keeping = keepingGames(games);
  if (!players.length || !keeping.length) return [];
  const held = await tx
    .select()
    .from(gameRooms)
    .where(and(inArray(gameRooms.game, keeping), arrayOverlaps(gameRooms.playerIds, [...players])))
    .for('update');
  const kept: string[] = [];
  for (const r of held) {
    const row: StoredRoom = {
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
    const next = keepSeat(row, players, now, games[r.game]);
    if (!next) continue;
    const wrote = await tx
      .update(gameRooms)
      .set({
        stateSchema: next.stateSchema,
        phase: next.phase,
        hostId: next.hostId,
        playerIds: next.playerIds,
        state: next.state,
        meta: next.meta,
        version: next.version,
        dueAt: next.dueAt,
        updatedAt: next.updatedAt,
        finishedAt: next.finishedAt,
        closedAt: next.closedAt,
      })
      .where(and(eq(gameRooms.id, r.id), eq(gameRooms.version, r.version)))
      .returning({ id: gameRooms.id });
    // Not written (the row moved under the lock: not expected): the delete has it.
    if (wrote.length) kept.push(r.id);
  }
  return kept;
}
