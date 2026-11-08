// The settle guard (spec 2026-10-24 Hometowns §10.12 F4): every `advance` is
// timed and every stored row measured, and a room over either line is named
// in one log line. A test-only game ("gauge") whose `advance` costs what the
// test says on the guard's clock, and whose room carries padding to size its
// row, through the registry and the in-memory store.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));

import {
  _resetRooms,
  _setRecorder,
  _setRoomStore,
  _setSettleClock,
  _setTurnPusher,
  act,
  createGame,
  flush,
  LARGE_ROW_BYTES,
  roomFor,
  settleStats,
  SLOW_SETTLE_MS,
} from './rooms.server';
import { GAMES, type GameId, type GameRules, type RoomBase } from './catalogue';
import { memoryRoomStore } from './room-store';
import type { PlayerStatus } from './tap-duel';

interface Gauge extends RoomBase {
  /** What the next `advance` costs on the guard's clock, in ms. */
  costMs: number;
  padding: string;
  ticks: number;
}

/** The guard's clock: moved only by the gauge's own `advance`. */
let clock = 0;

const gauge: GameRules = {
  createRoom({ id, host, difficulty, now }) {
    const room: Gauge = {
      id,
      game: 'gauge' as GameId,
      difficulty,
      hostId: host.id,
      phase: 'lobby',
      players: [{ id: host.id, name: host.name, status: 'joined' as PlayerStatus }],
      phaseEndsAt: now + 3_600_000,
      costMs: 0,
      padding: '',
      ticks: 0,
    };
    return room;
  },
  player: (id: string, name: string, status: PlayerStatus) => ({ id, name, status }),
  join() {},
  decline() {},
  leave() {},
  start() {},
  again() {},
  advance(r) {
    const room = r as Gauge;
    clock += room.costMs;
    room.ticks += 1;
    return false;
  },
  deadline: () => null,
  toWire: (r, _meId, now) => ({ id: r.id, phase: r.phase, serverNow: now, ticks: (r as Gauge).ticks }),
  moves: {
    // Sets what the room's next `advance` costs and how big its row is.
    tune: (r, _playerId, body) => {
      const room = r as Gauge;
      room.costMs = Number(body.costMs ?? 0);
      room.padding = 'x'.repeat(Number(body.bytes ?? 0));
    },
  },
  durable: { schema: 1 },
};

const GAUGE = 'gauge' as GameId;
const john = { id: 'p_john', name: 'John' };
let warn: { mock: { calls: unknown[][] }; mockRestore(): void };

const slowLines = () =>
  warn.mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.startsWith('[games] slow settle '))
    .map((l) => JSON.parse(l.slice('[games] slow settle '.length)) as Record<string, unknown>);

function newGauge(): string {
  return (createGame({ game: GAUGE, host: john, invite: [], difficulty: 'easy' }) as { id: string }).id;
}

beforeAll(() => {
  (GAMES as Record<string, GameRules>)[GAUGE] = gauge;
});
afterAll(() => {
  delete (GAMES as Record<string, GameRules>)[GAUGE];
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  clock = 0;
  _setSettleClock(() => clock);
  _setRoomStore(memoryRoomStore());
  _setRecorder(async () => ({}));
  _setTurnPusher(async (_kind, _roomId, ids) => ids);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  _resetRooms();
  _setSettleClock(null);
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  warn.mockRestore();
  vi.useRealTimers();
});

describe('the settle guard', () => {
  it('names an advance over the line, with the game, the room, the row and the p95', async () => {
    const id = newGauge();
    await flush(id);
    expect(slowLines()).toEqual([]);
    // The move sets the cost; the settle after it pays it.
    act(id, 'p_john', 'tune', { costMs: SLOW_SETTLE_MS + 13 });
    const lines = slowLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ game: 'gauge', room: id, ms: SLOW_SETTLE_MS + 13 });
    expect(lines[0].bytes as number).toBeGreaterThan(0);
    expect(lines[0].p95).toBe(SLOW_SETTLE_MS + 13);
  });

  it('says nothing at or under the lines', async () => {
    const id = newGauge();
    act(id, 'p_john', 'tune', { costMs: SLOW_SETTLE_MS, bytes: 300 * 1024 });
    act(id, 'p_john', 'tune', { costMs: SLOW_SETTLE_MS, bytes: 300 * 1024 });
    await flush(id);
    expect(slowLines()).toEqual([]);
  });

  it('names a stored row over 400 KB when it is written, and not one under', async () => {
    const id = newGauge();
    act(id, 'p_john', 'tune', { bytes: LARGE_ROW_BYTES - 2_048 });
    await flush(id);
    expect(slowLines()).toEqual([]);
    act(id, 'p_john', 'tune', { bytes: LARGE_ROW_BYTES + 1 });
    await flush(id);
    const lines = slowLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ game: 'gauge', room: id, ms: 0 });
    expect(lines[0].bytes as number).toBeGreaterThan(LARGE_ROW_BYTES);
  });

  it('keeps a rolling p95 per game over the recent advances', async () => {
    const id = newGauge();
    // Each action advances twice (before the move, and the settle after it),
    // so this is 300 advances at 1 ms or less and then 9 at 40 ms: the last
    // 200 are kept, and fewer than one in twenty of them is slow.
    for (let i = 0; i < 150; i++) act(id, 'p_john', 'tune', { costMs: 1 });
    act(id, 'p_john', 'tune', { costMs: 40 });
    for (let i = 0; i < 4; i++) act(id, 'p_john', 'tune', { costMs: 40 });
    await flush(id);
    const stats = settleStats().gauge;
    expect(stats.samples).toBe(200);
    expect(stats.maxMs).toBe(40);
    expect(stats.p95Ms).toBe(1);
    expect(stats.maxRowBytes).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) act(id, 'p_john', 'tune', { costMs: 40 });
    expect(settleStats().gauge.p95Ms).toBe(40);
    // Under the line throughout: nothing was logged.
    expect(slowLines()).toEqual([]);
  });
});
