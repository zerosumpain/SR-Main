// Homestead over days through the real durable-room registry: saved after each
// move, read back after a restart, one "your move" push per decision, and an
// overdue move made exactly once on reload. Uses the in-memory room store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
import {
  _resetRooms,
  _setRecorder,
  _setRoomStore,
  _setTurnPusher,
  act,
  createGame,
  ensureRoom,
  flush,
  roomFor,
  roomsFor,
} from './rooms.server';
import { memoryRoomStore } from './room-store';
import { COUNTDOWN_MS, type WireRoom } from './homestead';

const HOUR = 3_600_000;
const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };
const ids = ['p_john', 'p_sam', 'p_kim'];

let store: ReturnType<typeof memoryRoomStore>;
const pushes: { kind: string; ids: string[] }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  store = memoryRoomStore();
  _setRoomStore(store);
  _setRecorder(async () => ({}));
  pushes.length = 0;
  _setTurnPusher(async (kind, _roomId, to) => {
    pushes.push({ kind, ids: to });
    return to;
  });
});
afterEach(() => {
  _resetRooms();
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  vi.useRealTimers();
});

const view = (id: string, who = 'p_john') => roomFor(id, who) as unknown as WireRoom;

/** One setup placement by whoever is to move. */
function place(id: string) {
  const who = view(id).activeId!;
  const w = view(id, who);
  if (w.legal.cottage.length) act(id, who, 'build', { piece: 'cottage', at: w.legal.cottage[0] });
  else act(id, who, 'build', { piece: 'road', at: w.legal.road[0] });
}

async function asyncGame() {
  const { id } = createGame({
    game: 'homestead',
    host: john,
    invite: [sam, kim],
    difficulty: 'easy',
    options: { seed: 7, pace: 'async', deadlineHours: 24, island: 'standard' },
  });
  act(id, 'p_sam', 'join');
  act(id, 'p_kim', 'join');
  act(id, 'p_john', 'start');
  vi.advanceTimersByTime(COUNTDOWN_MS);
  await flush(id);
  return id;
}

/** Drop the moves' wall-clock parts that a reload may restate. */
const shape = (w: WireRoom) => {
  const { phaseEndsAt: _p, ...rest } = w as unknown as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest));
};

describe('Homestead as a durable room', () => {
  it('saves each move, survives a restart unchanged and keeps playing', async () => {
    const id = await asyncGame();
    expect(view(id).phase).toBe('playing');
    expect(view(id).step).toBe('setup');
    for (let i = 0; i < 4; i++) place(id);
    await flush(id);
    expect(store.rows.has(id)).toBe(true);
    const before = ids.map((p) => shape(view(id, p)));

    _resetRooms();
    await ensureRoom(id);
    expect(ids.map((p) => shape(view(id, p)))).toEqual(before);
    expect(roomsFor('p_kim')).toEqual([expect.objectContaining({ id, game: 'homestead', durable: true })]);

    // Play carries on after the reload.
    place(id);
    await flush(id);
    expect(view(id).buildings.length + view(id).roads.length).toBe(5);
  });

  it('rings the player whose move it is, once per decision', async () => {
    const id = await asyncGame();
    const first = view(id).activeId!;
    expect(pushes.filter((p) => p.kind === 'turn').flatMap((p) => p.ids)).toEqual([first]);
    // Another change to the room for the same decision does not ring again.
    _resetRooms();
    await ensureRoom(id);
    await flush(id);
    expect(pushes.filter((p) => p.kind === 'turn').flatMap((p) => p.ids)).toEqual([first]);
  });

  it('makes an overdue move exactly once when read back after a restart', async () => {
    const id = await asyncGame();
    const placer = view(id).activeId!;
    _resetRooms();
    vi.setSystemTime(Date.now() + 25 * HOUR);
    await ensureRoom(id);
    await flush(id);
    const after = view(id, placer);
    // The timed-out setup turn places both its cottage and its road.
    expect(after.buildings.filter((b) => b.owner === placer)).toHaveLength(1);
    expect(after.roads.filter((r) => r.owner === placer)).toHaveLength(1);
    expect(after.activeId).not.toBe(placer);
    _resetRooms();
    await ensureRoom(id);
    expect(view(id).buildings).toHaveLength(1);
  });
});
