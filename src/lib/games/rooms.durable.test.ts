// Durable rooms through the registry, with a test-only game ("relay": players
// take turns pressing on, four turns and it is over) and the in-memory store.
// Spec: docs/superpowers/specs/2026-10-22-family-games-durable-rooms.md.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));

import {
  _resetRooms,
  _setRecorder,
  _setRoomStore,
  _setTurnPusher,
  act,
  canCreate,
  canCreateDurable,
  createGame,
  ensureRoom,
  flush,
  hydrateFor,
  invitesFor,
  MAX_DURABLE_PER_HOST,
  MAX_DURABLE_ROOMS,
  roomFor,
  roomsFor,
  subscribe,
  sweepRooms,
} from './rooms.server';
import { GAMES, type GameId, type GameRules, type Pace, type RoomBase } from './catalogue';
import { memoryRoomStore, type RoomStore, type StoredRoom } from './room-store';
import { GameError, type PlayerStatus } from './tap-duel';

// ── the fixture game ────────────────────────────────────────────────────────

const TURN_MS = 30_000;
const HOUR = 3_600_000;
const LOBBY_MS = 3 * 60_000;
const FINISHED_MS = 10 * 60_000;
const TURNS = 4;

interface Relay extends RoomBase {
  pace: Pace;
  deadlineHours: number;
  turn: number;
  order: string[];
  idx: number;
  log: string[];
  resumed: number;
}

const turnMs = (room: Relay) => (room.pace === 'async' ? room.deadlineHours * HOUR : TURN_MS);

function step(room: Relay, by: string, now: number, auto: boolean) {
  room.log.push(`${by}${auto ? ' (auto)' : ''}`);
  room.turn += 1;
  room.idx = (room.idx + 1) % room.order.length;
  if (room.turn > TURNS) {
    room.phase = 'finished';
    room.phaseEndsAt = now + (room.pace === 'async' ? 72 * HOUR : FINISHED_MS);
  } else room.phaseEndsAt = now + turnMs(room);
}

const relay: GameRules = {
  createRoom({ id, host, invite, difficulty, options, now }) {
    const pace: Pace = options?.pace === 'async' ? 'async' : 'live';
    const room: Relay = {
      id,
      game: 'relay' as GameId,
      difficulty,
      hostId: host.id,
      phase: 'lobby',
      players: [
        { id: host.id, name: host.name, status: 'joined' as PlayerStatus },
        ...invite.map((p) => ({ id: p.id, name: p.name, status: 'invited' as PlayerStatus })),
      ],
      pace,
      deadlineHours: typeof options?.deadlineHours === 'number' ? options.deadlineHours : 24,
      phaseEndsAt: now + (pace === 'async' ? 24 * HOUR : LOBBY_MS),
      turn: 0,
      order: [],
      idx: 0,
      log: [],
      resumed: 0,
    };
    return room;
  },
  player: (id: string, name: string, status: PlayerStatus) => ({ id, name, status }),
  join(room, playerId) {
    const p = room.players.find((q) => q.id === playerId);
    if (p) p.status = 'joined';
  },
  decline(room, playerId) {
    const p = room.players.find((q) => q.id === playerId);
    if (p) p.status = 'declined';
  },
  leave(room, playerId) {
    const p = room.players.find((q) => q.id === playerId);
    if (p) p.status = 'left';
  },
  start(r, _playerId, now) {
    const room = r as Relay;
    room.phase = 'playing';
    room.order = room.players.filter((p) => p.status === 'joined').map((p) => p.id);
    room.idx = 0;
    room.turn = 1;
    room.phaseEndsAt = now + turnMs(room);
  },
  again(r, _playerId, now) {
    const room = r as Relay;
    room.phase = 'lobby';
    room.turn = 0;
    room.log = [];
    room.phaseEndsAt = now + LOBBY_MS;
  },
  advance(r, now) {
    const room = r as Relay;
    if (!Number.isFinite(now) || room.phaseEndsAt === null || now < room.phaseEndsAt) return false;
    if (room.phase === 'playing') step(room, room.order[room.idx], now, true);
    else {
      room.phase = 'closed';
      room.phaseEndsAt = null;
    }
    return true;
  },
  deadline: (room) => (room.phase === 'closed' ? null : room.phaseEndsAt),
  toWire(r, meId, now) {
    const room = r as Relay;
    return {
      id: room.id,
      phase: room.phase,
      serverNow: now,
      meId,
      turn: room.turn,
      log: room.log,
      resumed: room.resumed,
      deadlineHours: room.deadlineHours,
      phaseEndsAt: room.phaseEndsAt,
      players: room.players.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      standings: room.phase === 'finished' ? room.order.map((id) => ({ id, score: room.log.filter((l) => l === id).length })) : null,
      winnerIds: room.phase === 'finished' ? [room.order[0]] : null,
    };
  },
  moves: {
    step: (r, playerId, _body, now) => {
      const room = r as Relay;
      if (room.phase !== 'playing') throw new GameError(409, 'Not now.');
      if (room.order[room.idx] !== playerId) throw new GameError(409, 'Not your turn.');
      step(room, playerId, now, false);
    },
  },
  durable: {
    schema: 2,
    revive: (state, from) => (from === 1 ? ({ ...state, resumed: 0, log: ['revived'] } as unknown as RoomBase) : null),
  },
  paces: ['live', 'async'],
  waitingOn(r) {
    const room = r as Relay;
    if (room.phase !== 'playing') return null;
    const who = room.order[room.idx];
    return { ids: [who], key: `${room.turn}:${who}`, line: `Turn ${room.turn}.` };
  },
  resume(r, now) {
    const room = r as Relay;
    room.resumed += 1;
    room.phaseEndsAt = now + turnMs(room);
  },
};

const RELAY = 'relay' as GameId;
const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };

type Wire = Record<string, any>;
const view = (id: string, who = 'p_john') => roomFor(id, who) as unknown as Wire;

function newRelay(options: Record<string, unknown> = {}, invite = [sam]) {
  return createGame({ game: RELAY, host: john, invite, difficulty: 'easy', options }) as unknown as Wire;
}

/** A relay with John and Sam playing, John to move. */
async function playing(options: Record<string, unknown> = {}) {
  const { id } = newRelay(options);
  act(id, 'p_sam', 'join');
  act(id, 'p_john', 'start');
  await flush(id);
  return id;
}

/** A process restart: memory gone, the table kept. */
function restart() {
  _resetRooms();
}

let store: ReturnType<typeof memoryRoomStore>;
const pushes: { kind: string; roomId: string; ids: string[] }[] = [];

beforeAll(() => {
  (GAMES as Record<string, GameRules>)[RELAY] = relay;
});
afterAll(() => {
  delete (GAMES as Record<string, GameRules>)[RELAY];
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  store = memoryRoomStore();
  _setRoomStore(store);
  _setRecorder(async () => ({}));
  pushes.length = 0;
  _setTurnPusher(async (kind, roomId, ids) => {
    pushes.push({ kind, roomId, ids });
    return ids;
  });
});
afterEach(() => {
  _resetRooms();
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  vi.useRealTimers();
});

// ── writes ──────────────────────────────────────────────────────────────────

describe('writing a durable room', () => {
  it('writes after every accepted move, with a monotonic version the wire carries', async () => {
    const created = newRelay();
    expect(created).toMatchObject({ durable: true, pace: 'live', version: 1 });
    await flush(created.id);
    expect(store.rows.get(created.id)).toMatchObject({ version: 1, phase: 'lobby', hostId: 'p_john', playerIds: ['p_john', 'p_sam'] });

    const versions: number[] = [];
    for (const [who, action] of [['p_sam', 'join'], ['p_john', 'start'], ['p_john', 'step']] as const) {
      const w = act(created.id, who, action) as unknown as Wire;
      await flush(created.id);
      versions.push(w.version);
      expect(store.rows.get(created.id)!.version).toBe(w.version);
    }
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    const row = store.rows.get(created.id)!;
    expect(row.phase).toBe('playing');
    expect((row.state as Wire).log).toEqual(['p_john']);
    expect(row.dueAt!.getTime()).toBe(Date.now() + TURN_MS);
    // The stored state is the room exactly, through JSON.
    expect(JSON.parse(JSON.stringify(row.state))).toEqual(row.state);
  });

  it('refused moves write nothing', async () => {
    const id = await playing();
    const before = store.rows.get(id)!.version;
    expect(() => act(id, 'p_sam', 'step')).toThrow(/Not your turn/);
    await flush(id);
    expect(store.rows.get(id)!.version).toBe(before);
  });

  it('never touches the store for a game that is not durable', async () => {
    const spy: RoomStore = {
      insert: vi.fn(store.insert),
      save: vi.fn(store.save),
      load: vi.fn(store.load),
      openFor: vi.fn(store.openFor),
      countOpenByHost: vi.fn(store.countOpenByHost),
      due: vi.fn(store.due),
      purge: vi.fn(store.purge),
    };
    _setRoomStore(spy);
    const { id } = createGame({ game: 'tap-duel', host: john, invite: [sam], difficulty: 'easy' });
    act(id, 'p_sam', 'join');
    act(id, 'p_john', 'start');
    await flush(id);
    expect((roomFor(id, 'p_john') as unknown as Wire).durable).toBeUndefined();
    expect(roomsFor('p_john')).toEqual([{ id, game: 'tap-duel', phase: 'countdown', hostName: 'John' }]);
    await ensureRoom(id); // in memory already: no read
    expect(spy.insert).not.toHaveBeenCalled();
    expect(spy.save).not.toHaveBeenCalled();
    expect(spy.load).not.toHaveBeenCalled();
  });

  it('coalesces a burst of moves under a slow store into the latest room', async () => {
    let release: () => void = () => {};
    const slow: RoomStore = {
      ...store,
      save: vi.fn(async (row: StoredRoom, expected: number) => {
        await new Promise<void>((r) => (release = r));
        return store.save(row, expected);
      }),
    };
    _setRoomStore(slow);
    const { id } = newRelay();
    await flush(id); // the insert is not slow
    // Three moves in one tick: one write, of the room after all three.
    act(id, 'p_sam', 'join');
    act(id, 'p_john', 'start');
    act(id, 'p_john', 'step');
    await vi.waitFor(() => expect(slow.save).toHaveBeenCalledTimes(1));
    // Two more while it is in flight: they wait, as one write.
    act(id, 'p_sam', 'step');
    act(id, 'p_john', 'step');
    const latest = (view(id) as Wire).version;
    release();
    await vi.waitFor(() => expect(slow.save).toHaveBeenCalledTimes(2));
    release();
    await flush(id);
    expect(slow.save).toHaveBeenCalledTimes(2);
    expect(store.rows.get(id)!.version).toBe(latest);
    expect((store.rows.get(id)!.state as Wire).log).toEqual(['p_john', 'p_sam', 'p_john']);
  });

  it('takes the stored room when it loses a write race', async () => {
    const id = await playing();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Another process moved the room on.
    const row = store.rows.get(id)!;
    store.rows.set(id, { ...row, version: row.version + 5, state: { ...row.state, log: ['elsewhere'], turn: 2, idx: 1 } });
    const seen: Wire[] = [];
    subscribe(id, 'p_sam', (r) => seen.push(r as unknown as Wire), () => {});
    act(id, 'p_john', 'step');
    await vi.waitFor(() => expect(view(id).log).toEqual(['elsewhere']));
    expect(view(id).version).toBe(row.version + 5);
    expect(seen.at(-1)!.log).toEqual(['elsewhere']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('lost a write race'));
    error.mockRestore();
  });

  it('closes the room when its row was erased under it', async () => {
    const id = await playing();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.rows.delete(id);
    const gone = vi.fn();
    subscribe(id, 'p_sam', () => {}, gone);
    act(id, 'p_john', 'step');
    await vi.waitFor(() => expect(gone).toHaveBeenCalledOnce());
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
    error.mockRestore();
  });

  it('keeps playing while the database is down, and saves when it is back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let down = true;
    const flaky: RoomStore = {
      ...store,
      save: vi.fn(async (row: StoredRoom, expected: number) => {
        if (down) throw new Error('db down');
        return store.save(row, expected);
      }),
    };
    const id = await playing();
    _setRoomStore(flaky);
    act(id, 'p_john', 'step');
    await vi.advanceTimersByTimeAsync(0);
    act(id, 'p_sam', 'step'); // the game goes on in memory
    await vi.advanceTimersByTimeAsync(0);
    expect(view(id).log).toEqual(['p_john', 'p_sam']);
    expect(store.rows.get(id)!.version).toBeLessThan(view(id).version);
    expect(error).toHaveBeenCalledTimes(1); // once per outage, not per write
    down = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.rows.get(id)!.version).toBe(view(id).version);
    expect((store.rows.get(id)!.state as Wire).log).toEqual(['p_john', 'p_sam']);
    error.mockRestore();
    log.mockRestore();
  });

  it('answers after the flush wait even when the write never lands', async () => {
    const id = await playing();
    _setRoomStore({ ...store, save: () => new Promise(() => {}) });
    act(id, 'p_john', 'step');
    let done = false;
    void flush(id, 3_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

// ── reading back ────────────────────────────────────────────────────────────

describe('after a restart', () => {
  it('reads a live game back on first access and restarts its clock (a deploy is a pause)', async () => {
    const id = await playing();
    act(id, 'p_john', 'step');
    await flush(id);
    restart();
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
    vi.setSystemTime(Date.now() + 10 * 60_000); // down for ten minutes: far past the 30 s turn
    await ensureRoom(id);
    const w = view(id, 'p_sam');
    expect(w.log).toEqual(['p_john']); // no auto-move for the downtime
    expect(w.resumed).toBe(1);
    expect(w.phaseEndsAt).toBe(Date.now() + TURN_MS);
    // And it plays on, timers armed.
    await vi.advanceTimersByTimeAsync(TURN_MS);
    expect(view(id).log).toEqual(['p_john', 'p_sam (auto)']);
  });

  it('honours an async deadline as written: one auto-move for a three-day absence, then a fresh deadline', async () => {
    const id = await playing({ pace: 'async', deadlineHours: 24 });
    restart();
    vi.setSystemTime(Date.now() + 3 * 24 * HOUR);
    await ensureRoom(id);
    const w = view(id);
    expect(w.resumed).toBe(0); // async rooms are not resumed
    expect(w.log).toEqual(['p_john (auto)']);
    expect(w.phaseEndsAt).toBe(Date.now() + 24 * HOUR);
    await flush(id);
    expect(store.rows.get(id)!.dueAt!.getTime()).toBe(Date.now() + 24 * HOUR);
  });

  it('loads a room once however many ask at the same time', async () => {
    const id = await playing();
    restart();
    const load = vi.spyOn(store, 'load');
    await Promise.all([ensureRoom(id), ensureRoom(id), ensureRoom(id)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lists an async invite again after a restart, once the lobby has looked', async () => {
    const { id } = newRelay({ pace: 'async' });
    await flush(id);
    restart();
    expect(invitesFor('p_sam')).toEqual([]);
    await hydrateFor('p_sam');
    expect(invitesFor('p_sam')).toEqual([expect.objectContaining({ roomId: id, hostName: 'John' })]);
    // Seeing it is recorded, and survives the next restart too.
    await flush(id);
    expect(store.rows.get(id)!.meta.sawInvite).toEqual(['p_sam']);
  });

  it('revives a room stored under an older schema, and closes one it cannot read', async () => {
    const id = await playing();
    const row = store.rows.get(id)!;
    store.rows.set(id, { ...row, stateSchema: 1 });
    restart();
    await ensureRoom(id);
    expect(view(id).log).toEqual(['revived']);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = await playing();
    store.rows.set(other, { ...store.rows.get(other)!, stateSchema: 0 });
    restart();
    await ensureRoom(other);
    expect(() => roomFor(other, 'p_john')).toThrow(/finished/);
    expect(store.rows.get(other)!.closedAt).not.toBeNull();
    error.mockRestore();
  });

  it('says 503, not "finished", when the table cannot be read', async () => {
    const id = await playing();
    restart();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    _setRoomStore({ ...store, load: async () => Promise.reject(new Error('db down')) });
    await expect(ensureRoom(id)).rejects.toMatchObject({ status: 503 });
    error.mockRestore();
  });

  it('answers "not here" (404), not 503, while the table is missing or not yet granted', async () => {
    restart();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const denied = Object.assign(new Error('permission denied for table game_rooms'), { code: '42501' });
    _setRoomStore({ ...store, load: async () => Promise.reject(new Error('Failed query', { cause: denied })) });
    await expect(ensureRoom('g_0123456789ab')).resolves.toBeUndefined();
    expect(() => roomFor('g_0123456789ab', 'p_john')).toThrow(expect.objectContaining({ status: 404 }));
    const missing = Object.assign(new Error('relation "game_rooms" does not exist'), { code: '42P01' });
    _setRoomStore({ ...store, load: async () => Promise.reject(missing) });
    await expect(ensureRoom('g_0123456789ac')).resolves.toBeUndefined();
    error.mockRestore();
  });

  it('never reads a closed room back', async () => {
    const { id } = newRelay();
    vi.advanceTimersByTime(LOBBY_MS);
    await flush(id);
    expect(store.rows.get(id)!.closedAt).not.toBeNull();
    restart();
    await ensureRoom(id);
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
  });
});

// ── the lobby ───────────────────────────────────────────────────────────────

describe('the lobby', () => {
  it('lists a durable room with whose move it is and when it is due', async () => {
    const id = await playing({ pace: 'async', deadlineHours: 12 });
    expect(roomsFor('p_john')).toEqual([
      {
        id,
        game: RELAY,
        phase: 'playing',
        hostName: 'John',
        durable: true,
        pace: 'async',
        myTurn: true,
        waitingFor: ['John'],
        dueAt: Date.now() + 12 * HOUR,
        updatedAt: Date.now(),
      },
    ]);
    expect(roomsFor('p_sam')[0]).toMatchObject({ myTurn: false, waitingFor: ['John'] });
  });

  it('only offers a pace the game has, and only 12, 24 or 48 hours', () => {
    expect(newRelay({ pace: 'weekly' }).pace).toBe('live');
    const r = newRelay({ pace: 'async', deadlineHours: 7 });
    expect(r.pace).toBe('async');
    expect(r.deadlineHours).toBe(24);
    expect(newRelay({ pace: 'async', deadlineHours: 48 }).deadlineHours).toBe(48);
  });

  it('caps a host at five open durable games, counting the stored ones', async () => {
    for (let i = 0; i < MAX_DURABLE_PER_HOST; i++) newRelay({}, []);
    await expect(canCreateDurable('p_john')).rejects.toThrow(/Finish one/);
    await expect(canCreateDurable('p_sam')).resolves.toBeUndefined();
    // Evicted or not, a stored room counts.
    for (const id of [...store.rows.keys()]) await flush(id);
    restart();
    await expect(canCreateDurable('p_john')).rejects.toThrow(/Finish one/);
    _setRoomStore({ ...store, countOpenByHost: async () => Promise.reject(new Error('down')) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(canCreateDurable('p_john')).rejects.toMatchObject({ status: 503 });
    error.mockRestore();
  });

  it('does not count durable rooms against the three-game cap of quick games', () => {
    for (let i = 0; i < 3; i++) newRelay({}, []);
    expect(() => createGame({ game: 'tap-duel', host: john, invite: [], difficulty: 'easy' })).not.toThrow();
  });

  it('keeps durable rooms out of the global quick-game budget, with a budget of their own', () => {
    const host = (i: number) => ({ id: `p_h${i}`, name: `H${i}` });
    for (let i = 0; i < 60; i++) createGame({ game: RELAY, host: host(i), invite: [], difficulty: 'easy', options: {} });
    // Sixty games lasting days do not block a Tap Duel.
    expect(() => canCreate('p_new', 'tap-duel')).not.toThrow();
    expect(() => canCreate('p_new')).not.toThrow();
    for (let i = 60; i < MAX_DURABLE_ROOMS; i++) createGame({ game: RELAY, host: host(i), invite: [], difficulty: 'easy', options: {} });
    expect(() => canCreate('p_new', RELAY)).toThrow(/Too many games/);
    expect(() => canCreate('p_new', 'tap-duel')).not.toThrow();
  });
});

// ── pushes ──────────────────────────────────────────────────────────────────

describe('"your move" pushes', () => {
  it('pushes whoever an async room waits on, once per decision', async () => {
    const id = await playing({ pace: 'async' });
    expect(pushes).toEqual([{ kind: 'turn', roomId: id, ids: ['p_john'] }]);
    view(id);
    act(id, 'p_sam', 'leave'); // a change that is not a new decision
    act(id, 'p_sam', 'join');
    await flush(id);
    expect(pushes).toHaveLength(1);
    act(id, 'p_john', 'step');
    expect(pushes.at(-1)).toEqual({ kind: 'turn', roomId: id, ids: ['p_sam'] });
    expect(pushes).toHaveLength(2);
  });

  it('never pushes a player who is watching the room', async () => {
    const id = await playing({ pace: 'async' });
    const off = subscribe(id, 'p_sam', () => {}, () => {});
    act(id, 'p_john', 'step');
    expect(pushes.map((p) => p.ids)).toEqual([['p_john']]);
    off();
    // Watching stopped: the next decision of Sam's rings.
    act(id, 'p_sam', 'leave');
    act(id, 'p_sam', 'join');
    expect(pushes.map((p) => p.ids)).toEqual([['p_john'], ['p_sam']]);
  });

  it('never rings twice for one decision across a restart', async () => {
    const id = await playing({ pace: 'async' });
    await vi.waitFor(() => expect(store.rows.get(id)!.meta.turnPushed).toEqual({ key: '1:p_john', ids: ['p_john'] }));
    restart();
    await ensureRoom(id);
    expect(pushes).toHaveLength(1);
  });

  it('pushes nothing for a live room', async () => {
    const id = await playing();
    act(id, 'p_john', 'step');
    expect(pushes).toEqual([]);
  });

  it('tells everyone not watching, once, when an async game is over', async () => {
    const id = await playing({ pace: 'async' });
    for (const who of ['p_john', 'p_sam', 'p_john', 'p_sam']) act(id, who, 'step');
    expect(view(id).phase).toBe('finished');
    expect(pushes.filter((p) => p.kind === 'finished')).toEqual([{ kind: 'finished', roomId: id, ids: ['p_john', 'p_sam'] }]);
    view(id);
    await flush(id);
    expect(store.rows.get(id)!.meta.finishPushed).toBe(true);
    expect(store.rows.get(id)!.finishedAt!.getTime()).toBe(Date.now());
    restart();
    await ensureRoom(id);
    expect(pushes.filter((p) => p.kind === 'finished')).toHaveLength(1);
  });
});

// ── the sweep ───────────────────────────────────────────────────────────────

describe('the sweep', () => {
  it('wakes a stored async game whose deadline has passed, with nobody asking', async () => {
    const id = await playing({ pace: 'async' });
    restart();
    vi.setSystemTime(Date.now() + 25 * HOUR);
    expect(await sweepRooms()).toMatchObject({ woken: 1 });
    expect(view(id).log).toEqual(['p_john (auto)']);
    expect(pushes.at(-1)).toEqual({ kind: 'turn', roomId: id, ids: ['p_sam'] });
  });

  it('drops an idle saved room from memory, and the next access reads it back', async () => {
    const id = await playing({ pace: 'async', deadlineHours: 48 });
    const gone = vi.fn();
    const off = subscribe(id, 'p_john', () => {}, gone);
    vi.setSystemTime(Date.now() + 7 * HOUR);
    expect(await sweepRooms()).toMatchObject({ evicted: 0 }); // somebody is watching
    off();
    vi.setSystemTime(Date.now() + 7 * HOUR);
    expect(await sweepRooms()).toMatchObject({ evicted: 1 });
    expect(gone).not.toHaveBeenCalled();
    expect(() => roomFor(id, 'p_john')).toThrow(/finished/);
    await ensureRoom(id);
    expect(view(id).phase).toBe('playing');
  });

  it('keeps a room in memory whose deadline is near', async () => {
    const id = await playing({ pace: 'async', deadlineHours: 12 });
    vi.setSystemTime(Date.now() + 11.5 * HOUR);
    expect(await sweepRooms()).toMatchObject({ evicted: 0 });
    expect(view(id).phase).toBe('playing');
  });

  it('deletes a finished room after a week and closes it in memory', async () => {
    const id = await playing({ pace: 'async' });
    for (const who of ['p_john', 'p_sam', 'p_john', 'p_sam']) act(id, who, 'step');
    await flush(id);
    const gone = vi.fn();
    subscribe(id, 'p_john', () => {}, gone);
    vi.setSystemTime(Date.now() + 6 * 24 * HOUR);
    expect(await sweepRooms()).toMatchObject({ purged: 0 });
    vi.setSystemTime(Date.now() + 2 * 24 * HOUR);
    expect(await sweepRooms()).toMatchObject({ purged: 1 });
    expect(store.rows.has(id)).toBe(false);
    expect(gone).toHaveBeenCalledOnce();
  });

  it('does nothing at all when no game is durable', async () => {
    // Set aside every durable game, the real ones (Homestead) as well as the relay.
    const games = GAMES as Record<string, GameRules>;
    const aside = Object.entries(games).filter(([, rules]) => rules.durable);
    for (const [id] of aside) delete games[id];
    try {
      const due = vi.spyOn(store, 'due');
      expect(await sweepRooms()).toEqual({ woken: 0, evicted: 0, purged: 0 });
      await hydrateFor('p_john');
      expect(due).not.toHaveBeenCalled();
    } finally {
      for (const [id, rules] of aside) games[id] = rules;
    }
  });
});
