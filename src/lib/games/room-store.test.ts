import { describe, expect, it } from 'vitest';
import { expired, memoryRoomStore, type StoredRoom } from './room-store';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

function row(over: Partial<StoredRoom> = {}): StoredRoom {
  return {
    id: 'g_000000000001',
    game: 'homestead',
    stateSchema: 1,
    pace: 'async',
    phase: 'playing',
    hostId: 'p_john',
    playerIds: ['p_john', 'p_sam'],
    state: { turn: 1 },
    meta: { optionKeys: [], round: 0, recorded: false, sawInvite: [], pushed: [], turnPushed: null, finishPushed: false },
    version: 1,
    dueAt: new Date(NOW + DAY),
    updatedAt: new Date(NOW),
    finishedAt: null,
    closedAt: null,
    ...over,
  };
}

describe('retention', () => {
  it('keeps a finished room a week, a closed one a day, anything else a month without a write', () => {
    expect(expired(row({ finishedAt: new Date(NOW - 6 * DAY), updatedAt: new Date(NOW - 6 * DAY) }), NOW)).toBe(false);
    expect(expired(row({ finishedAt: new Date(NOW - 8 * DAY), updatedAt: new Date(NOW - 8 * DAY) }), NOW)).toBe(true);
    expect(expired(row({ closedAt: new Date(NOW - 2 * DAY), updatedAt: new Date(NOW - 2 * DAY) }), NOW)).toBe(true);
    expect(expired(row({ closedAt: new Date(NOW - DAY / 2) }), NOW)).toBe(false);
    expect(expired(row({ updatedAt: new Date(NOW - 29 * DAY) }), NOW)).toBe(false);
    expect(expired(row({ updatedAt: new Date(NOW - 31 * DAY) }), NOW)).toBe(true);
  });
});

describe('the in-memory store keeps the table contract', () => {
  it('inserts once, then writes only against the version it holds', async () => {
    const s = memoryRoomStore();
    expect(await s.insert(row())).toBe(true);
    expect(await s.insert(row())).toBe(false);
    expect(await s.save(row({ version: 2 }), 1)).toBe('ok');
    expect(await s.save(row({ version: 3 }), 1)).toBe('stale');
    expect(await s.save(row({ id: 'g_000000000002', version: 2 }), 1)).toBe('missing');
  });

  it('never loads a closed room, and lists open ones by player, host and deadline', async () => {
    const s = memoryRoomStore();
    await s.insert(row());
    await s.insert(row({ id: 'g_000000000002', closedAt: new Date(NOW) }));
    await s.insert(row({ id: 'g_000000000003', finishedAt: new Date(NOW), dueAt: null, playerIds: ['p_john'] }));
    expect(await s.load('g_000000000002')).toBeNull();
    expect(await s.openFor('p_john', 20)).toEqual(['g_000000000001', 'g_000000000003']);
    expect(await s.openFor('p_sam', 20)).toEqual(['g_000000000001']);
    expect(await s.countOpenByHost('p_john')).toBe(1);
    expect(await s.due(new Date(NOW + DAY), 50)).toEqual(['g_000000000001']);
    expect(await s.due(new Date(NOW), 50)).toEqual([]);
  });
});
