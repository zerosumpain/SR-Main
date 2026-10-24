/**
 * Erasing one seat against the disposable integration database: inside one
 * transaction, `keepErasedSeats` rewrites the room of a game that keeps its
 * rooms, and the account erasure's own delete (the statement in
 * `$lib/people/erase`) then removes every other room the person sat in and
 * misses the kept one. Rows are identified by an id prefix and removed after
 * every case; run only in the hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arrayOverlaps, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { gameRooms } from '$lib/db/schema';
import { dbRoomStore as store } from './room-store.server';
import { keepErasedSeats } from './erase-seat.server';
import { mentions } from './erase-seat';
import type { GameRules, RoomBase } from './catalogue';
import type { StoredRoom } from './room-store';

const PREFIX = 'itest_erase_seat:';
const NOW = Date.parse('2026-10-24T12:00:00Z');
const A = 'p_itest_seat_a';
const B = 'p_itest_seat_b';

async function cleanup(): Promise<void> {
  await db.delete(gameRooms).where(like(gameRooms.id, `${PREFIX}%`));
}

beforeEach(cleanup);
afterEach(cleanup);

const keeps: GameRules = {
  deadline: () => null,
  durable: {
    schema: 1,
    erasePlayer: (room: RoomBase, id: string) => ({ ...room, hostId: A, players: room.players.filter((p) => p.id !== id) }),
  },
} as unknown as GameRules;
const games = { 'itest-keeps': keeps, 'itest-ends': { ...keeps, durable: { schema: 1 } } } as Record<string, GameRules>;

function row(id: string, game: string): StoredRoom {
  const state = {
    id: `${PREFIX}${id}`,
    game,
    difficulty: 'easy',
    hostId: B,
    phase: 'playing',
    players: [
      { id: A, name: 'Mayor A', status: 'joined' },
      { id: B, name: 'Mayor B', status: 'joined' },
    ],
    phaseEndsAt: null,
  };
  return {
    id: state.id,
    game,
    stateSchema: 1,
    pace: 'async',
    phase: 'playing',
    hostId: B,
    playerIds: [A, B],
    state,
    meta: { optionKeys: [], round: 0, recorded: false, sawInvite: [B], pushed: [], turnPushed: null, finishPushed: false },
    version: 4,
    dueAt: null,
    updatedAt: new Date(NOW - 60_000),
    finishedAt: null,
    closedAt: null,
  };
}

describe('erasing one seat in the table', () => {
  it('keeps the county, deletes the evening game, and leaves no trace of the erased id', async () => {
    await store.insert(row('county', 'itest-keeps'));
    await store.insert(row('evening', 'itest-ends'));
    const { kept, deleted } = await db.transaction(async (tx) => {
      const kept = await keepErasedSeats(tx, [B], NOW, games);
      const gone = await tx.delete(gameRooms).where(arrayOverlaps(gameRooms.playerIds, [B])).returning({ id: gameRooms.id });
      return { kept, deleted: gone.map((r) => r.id).filter((id) => id.startsWith(PREFIX)) };
    });
    expect(kept).toEqual([`${PREFIX}county`]);
    expect(deleted).toEqual([`${PREFIX}evening`]);
    const back = await store.load(`${PREFIX}county`);
    expect(back).toMatchObject({ version: 5, hostId: A, playerIds: [A] });
    expect(mentions(back, B)).toBe(false);
    // A save from a copy that still held the seat loses its compare-and-set.
    expect(await store.save({ ...row('county', 'itest-keeps'), version: 5 }, 4)).toBe('stale');
  });
});
