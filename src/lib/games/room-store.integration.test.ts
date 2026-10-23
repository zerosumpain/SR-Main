/**
 * The durable rooms' table against the disposable integration database: the
 * compare-and-set write, closed rows never loaded, the lobby's containment
 * lookup, the sweep's deadline index and the retention delete. Rows are
 * identified by an id prefix and removed after every case; run only in the
 * hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { db } from '$lib/db';
import { gameRooms } from '$lib/db/schema';
import { dbRoomStore as store } from './room-store.server';
import type { StoredRoom } from './room-store';

const PREFIX = 'itest_game_rooms:';
const NOW = Date.parse('2026-10-22T12:00:00Z');
const DAY = 86_400_000;

async function cleanup(): Promise<void> {
  await db.delete(gameRooms).where(like(gameRooms.id, `${PREFIX}%`));
}

beforeEach(cleanup);
afterEach(cleanup);

function row(id: string, over: Partial<StoredRoom> = {}): StoredRoom {
  return {
    id: `${PREFIX}${id}`,
    game: 'homestead',
    stateSchema: 1,
    pace: 'async',
    phase: 'playing',
    hostId: 'p_itest_john',
    playerIds: ['p_itest_john', 'p_itest_sam'],
    state: { turn: 3, hands: { p_itest_john: ['timber'] } },
    meta: { optionKeys: ['pace'], round: 0, recorded: false, sawInvite: [], pushed: [], turnPushed: null, finishPushed: false },
    version: 1,
    dueAt: new Date(NOW + DAY),
    updatedAt: new Date(NOW),
    finishedAt: null,
    closedAt: null,
    ...over,
  };
}

describe('game rooms table', () => {
  it('inserts once, writes only against the version it holds, and reads back what it wrote', async () => {
    expect(await store.insert(row('a'))).toBe(true);
    expect(await store.insert(row('a'))).toBe(false);
    expect(await store.save(row('a', { version: 2, state: { turn: 4 } }), 1)).toBe('ok');
    expect(await store.save(row('a', { version: 3 }), 1)).toBe('stale');
    expect(await store.save(row('b', { version: 2 }), 1)).toBe('missing');
    const back = await store.load(`${PREFIX}a`);
    expect(back).toMatchObject({ version: 2, state: { turn: 4 }, pace: 'async', playerIds: ['p_itest_john', 'p_itest_sam'] });
    expect(back!.dueAt!.getTime()).toBe(NOW + DAY);
  });

  it('never loads a closed room, and finds open ones by player, host and deadline', async () => {
    await store.insert(row('open'));
    await store.insert(row('closed', { closedAt: new Date(NOW) }));
    await store.insert(row('done', { finishedAt: new Date(NOW), dueAt: null, playerIds: ['p_itest_john'], updatedAt: new Date(NOW + 1) }));
    expect(await store.load(`${PREFIX}closed`)).toBeNull();
    expect(await store.openFor('p_itest_john', 20)).toEqual([`${PREFIX}done`, `${PREFIX}open`]);
    expect(await store.openFor('p_itest_sam', 20)).toEqual([`${PREFIX}open`]);
    expect(await store.countOpenByHost('p_itest_john')).toBe(1);
    const due = await store.due(new Date(NOW + DAY), 50);
    expect(due.filter((id) => id.startsWith(PREFIX))).toEqual([`${PREFIX}open`]);
  });

  it('deletes past retention: a week after finishing, a day after closing unfinished, a month idle', async () => {
    await store.insert(row('fresh'));
    await store.insert(row('finished-old', { finishedAt: new Date(NOW - 8 * DAY), updatedAt: new Date(NOW - 8 * DAY) }));
    await store.insert(row('finished-new', { finishedAt: new Date(NOW - 6 * DAY), updatedAt: new Date(NOW - 6 * DAY) }));
    await store.insert(row('closed-old', { closedAt: new Date(NOW - 2 * DAY), updatedAt: new Date(NOW - 2 * DAY) }));
    await store.insert(row('idle', { updatedAt: new Date(NOW - 31 * DAY) }));
    const gone = (await store.purge(new Date(NOW))).filter((id) => id.startsWith(PREFIX)).sort();
    expect(gone).toEqual([`${PREFIX}closed-old`, `${PREFIX}finished-old`, `${PREFIX}idle`]);
  });
});
