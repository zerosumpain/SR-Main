// Hometowns through the real durable-room registry (rooms.server with the
// in-memory store, fake timers): the round trip at every phase, a backlog
// drained in chunks that are not each written, a restart mid-day that ends
// exactly where never stopping does, the paused county's heartbeat woken by
// the sweep, and at most one push a day (WP4 acceptance, spec §13.2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../quiz-night.server', () => ({ writeQuiz: async () => {} }));
import { _resetRooms, _setRecorder, _setRoomStore, _setTurnPusher, act, createGame, ensureRoom, flush, noteParent, roomFor, roomsFor, sweepRooms } from '../rooms.server';
import { memoryRoomStore } from '../room-store';
import { GAMES } from '../catalogue';
import { countyHash } from './engine/index';
import type { Room } from './hometowns';
import type { HometownsWire } from './engine/wire';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TICK = 30_000;
/** Tuesday 20 October 2026, 12:00 UTC. */
const T0 = 1_792_497_600_000;
const host = { id: 'p_host', name: 'Host' };
const kid = { id: 'p_kid', name: 'Kid' };

let store: ReturnType<typeof memoryRoomStore>;
const pushes: { kind: string; ids: string[]; at: number }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  process.env.HOMETOWNS_DEV_CLOCK = '1';
  store = memoryRoomStore();
  _setRoomStore(store);
  _setRecorder(async () => ({}));
  pushes.length = 0;
  _setTurnPusher(async (kind, _roomId, ids) => {
    pushes.push({ kind, ids, at: Date.now() });
    return ids;
  });
});
afterEach(() => {
  _resetRooms();
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  delete process.env.HOMETOWNS_DEV_CLOCK;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const view = (id: string, who = host.id) => JSON.parse(JSON.stringify(roomFor(id, who))) as HometownsWire & { version: number };
const stored = (id: string) => store.rows.get(id)!.state as unknown as Room;

async function county(options: Record<string, unknown> = { devTickMs: TICK, seed: 5 }, invite: { id: string; name: string }[] = []): Promise<string> {
  const { id } = createGame({ game: 'hometowns', host, invite, difficulty: 'easy', options: { pace: 'async', county: options } });
  await flush(id);
  return id;
}

/** Start, found and tap the Founding Fortnight 10.5 s apart on the fake clock. */
async function found(id: string): Promise<void> {
  act(id, host.id, 'start');
  act(id, host.id, 'found', { site: 0, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: 1, moveId: 'f' });
  for (let k = 0; k < 12; k++) {
    await vi.advanceTimersByTimeAsync(10_500);
    act(id, host.id, 'sprint', { moveId: `s${k}` });
  }
  await flush(id);
}

/** Read back as after a restart: the room leaves memory and the next access loads its row. */
async function restart(id: string): Promise<void> {
  await flush(id);
  _resetRooms();
  await ensureRoom(id);
}

/** Lets the registry's "now" timers run (fake timers fire them a millisecond on): a catch-up re-arms one per chunk. */
async function settleChunks(): Promise<void> {
  for (let k = 0; k < 40; k++) await vi.advanceTimersByTimeAsync(1);
}

/** The frame as a phone compares it across a restart (the framework's own `version` included). */
const shape = (w: HometownsWire) => JSON.parse(JSON.stringify({ ...w, rev: 0 }));

describe('Hometowns as a durable room', () => {
  it('round-trips at every phase: lobby, fortnight, on the grid, closed', async () => {
    const id = await county({ devTickMs: TICK, seed: 5 }, [kid]);
    expect(store.rows.get(id)).toMatchObject({ game: 'hometowns', phase: 'lobby', pace: 'async', stateSchema: 1 });
    const lobby = shape(view(id));
    await restart(id);
    expect(shape(view(id))).toEqual(lobby);

    act(id, host.id, 'start');
    act(id, host.id, 'found', { site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 0, moveId: 'f' });
    const fortnight = shape(view(id));
    await restart(id);
    expect(shape(view(id))).toEqual(fortnight);
    expect(view(id).me!.town!.gridBase).toBeNull();

    for (let k = 0; k < 12; k++) {
      await vi.advanceTimersByTimeAsync(10_500);
      act(id, host.id, 'sprint', { moveId: `s${k}` });
    }
    const grid = shape(view(id));
    await restart(id);
    expect(shape(view(id))).toEqual(grid);
    expect(roomsFor(host.id)).toEqual([expect.objectContaining({ id, game: 'hometowns', durable: true, pace: 'async' })]);

    act(id, host.id, 'leave');
    await flush(id);
    expect(store.rows.get(id)!.phase).toBe('closed');
    _resetRooms();
    await ensureRoom(id);
    expect(() => roomFor(id, host.id)).toThrow('That game has finished.');
  });

  it('drains a 100-tick backlog in chunks against the real registry, writing only when a chunk matters', async () => {
    const id = await county();
    await found(id);
    const target = view(id).me!.town!.tick;
    _resetRooms();
    vi.setSystemTime(Date.now() + 100 * TICK);
    const advance = vi.spyOn(GAMES.hometowns, 'advance');
    const save = vi.spyOn(store, 'save');
    await ensureRoom(id);
    await settleChunks();
    await flush(id);
    const calls = advance.mock.results.length;
    expect(calls).toBeGreaterThan(2);
    // A27: a chunk that neither finishes nor runs a Regional Day is not written.
    expect(save.mock.calls.length).toBeLessThan(calls);
    expect(stored(id).behind).toBe(false);
    expect(view(id).me!.town!.tick).toBeGreaterThanOrEqual(target + 90);
  });

  it('ends a restart mid-day exactly where never stopping ends', async () => {
    async function play(withRestart: boolean): Promise<{ county: string; town: string }> {
      _resetRooms();
      vi.setSystemTime(T0);
      const id = await county({ devTickMs: TICK, seed: 9 });
      await found(id);
      const steps: [number, string, Record<string, unknown>][] = [
        [3, 'build', { planId: 'p1', plan: [{ op: 'road', kind: 'lane', path: [30, 40, 24, 40] }, { op: 'zone', zone: 'homes', rect: [24, 38, 6, 2] }] }],
        [5, 'budget', { moveId: 'b1', taxes: { town: 900 } }],
        [9, 'hello', {}],
        [7, 'build', { planId: 'p2', plan: [{ op: 'zone', zone: 'shops', rect: [24, 41, 4, 1] }] }],
        [30, 'seen', { tick: 20 }],
      ];
      for (const [k, [ticks, action, body]] of steps.entries()) {
        await vi.advanceTimersByTimeAsync(ticks * TICK);
        if (withRestart && k === 2) await restart(id);
        act(id, host.id, action, body);
      }
      await vi.advanceTimersByTimeAsync(20 * TICK);
      view(id);
      await flush(id);
      const c = stored(id).county;
      return { county: countyHash(c), town: view(id).me!.townHash };
    }
    const straight = await play(false);
    const restarted = await play(true);
    expect(restarted).toEqual(straight);
  });

  it('a paused county is woken by the sweep for its weekly heartbeat', async () => {
    const id = await county({ seed: 5 });
    await found(id);
    act(id, host.id, 'pause', { moveId: 'p', on: true });
    await flush(id);
    const before = store.rows.get(id)!.updatedAt.getTime();
    _resetRooms();
    vi.setSystemTime(Date.now() + 7 * DAY + MIN);
    const out = await sweepRooms();
    expect(out.woken).toBe(1);
    await flush(id);
    expect(store.rows.get(id)!.updatedAt.getTime()).toBeGreaterThan(before + 7 * DAY);
  });

  it('rings a phone at most once a day: the Sunday Gazette once, nothing for a late day', async () => {
    // Saturday 24 October 2026, 14:00 UTC (15:00 in London): the first Regional Days fall Saturday and Sunday at 18:00.
    vi.setSystemTime(Date.UTC(2026, 9, 24, 14, 0));
    const id = await county({ seed: 4 });
    await found(id);
    act(id, host.id, 'hello');
    // Through Saturday's day (no news) to just after Sunday's (the Gazette).
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 9, 25, 18, 5) - Date.now());
    await flush(id);
    const turn = () => pushes.filter((p) => p.kind === 'turn');
    expect(turn()).toEqual([{ kind: 'turn', ids: [host.id], at: expect.any(Number) }]);
    // A move later that evening, and a restart, ring nothing more.
    act(id, host.id, 'hello');
    await restart(id);
    act(id, host.id, 'budget', { moveId: 'b', taxes: { town: 900 } });
    await flush(id);
    expect(turn()).toHaveLength(1);
    // Monday's day has no news for this town: still one push in all.
    await vi.advanceTimersByTimeAsync(DAY);
    act(id, host.id, 'hello');
    await flush(id);
    expect(turn()).toHaveLength(1);
  });

  it('never rings for a Regional Day run late after an outage', async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 24, 14, 0));
    const id = await county({ seed: 4 });
    await found(id);
    act(id, host.id, 'hello');
    await flush(id);
    _resetRooms();
    // Down from Saturday afternoon until Sunday 21:00: both days run on the next access, late.
    vi.setSystemTime(Date.UTC(2026, 9, 25, 21, 0));
    await ensureRoom(id);
    await settleChunks();
    await flush(id);
    expect(stored(id).county.dayIndex).toBeGreaterThanOrEqual(2);
    expect(pushes).toEqual([]);
  });

  it('keeps a parent who joined a parent across a restart, and answers the join with their adult seat', async () => {
    const gran = { id: 'p_gran', name: 'Gran' };
    const id = await county({ devTickMs: TICK, seed: 5 }, [gran]);
    expect(view(id, gran.id).players.find((p) => p.id === gran.id)?.status).toBe('invited');
    act(id, gran.id, 'join');
    await flush(id);
    // The API checks the family role after the join (a database read), then notes it.
    const answer = JSON.parse(JSON.stringify(noteParent(id, gran.id))) as HometownsWire;
    expect(answer.me).toMatchObject({ profile: 'adult', isParent: true });
    // A second note changes nothing, so nothing more is written.
    expect(noteParent(id, gran.id)).toBeNull();
    await restart(id);
    expect(view(id, gran.id).me).toMatchObject({ profile: 'adult', isParent: true });
  });

  it('moves the rev on past anything a phone held when a row is read back, and fills fields added within the schema', async () => {
    const id = await county();
    await found(id);
    // Views catch the town up and bump the rev in memory without a write: the phone holds more than the row.
    let held = 0;
    for (let k = 0; k < 6; k++) {
      await vi.advanceTimersByTimeAsync(TICK);
      held = view(id).rev;
    }
    expect(stored(id).rev).toBeLessThan(held);
    // A row from an earlier build of this schema, without the push window or the visits.
    const row = store.rows.get(id)!;
    const state = { ...(row.state as Record<string, unknown>) };
    delete state.push;
    delete state.viewing;
    store.rows.set(id, { ...row, state });
    _resetRooms();
    vi.setSystemTime(Date.now() + 40 * TICK);
    await ensureRoom(id);
    await settleChunks();
    const back = view(id);
    expect(back.rev).toBeGreaterThan(held);
    expect(stored(id).push).toEqual(expect.objectContaining({ open: null }));
    // The first frame after the reload is whole even for a phone naming the old rev.
    expect(JSON.parse(JSON.stringify(act(id, host.id, 'hello', { since: held }))).base).toBeNull();
  });

  it("neither writes nor sends a stats report, and keeps only a move's own fields", async () => {
    const id = await county();
    await found(id);
    const save = vi.spyOn(store, 'save');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let k = 0; k < 4; k++) act(id, host.id, 'stats', { canary: { tick: 9, ok: false }, fps: 60 });
    await flush(id);
    expect(save).not.toHaveBeenCalled();
    // One mismatch line for the seat and tick, however often it is relayed.
    expect(warn.mock.calls.filter(([line]) => String(line).includes('canary mismatch'))).toHaveLength(1);
    act(id, host.id, 'budget', { moveId: 'pad', taxes: { town: 900 }, junk: 'x'.repeat(1000) });
    await flush(id);
    const logged = stored(id).county.log.find((r) => r.id === 'pad')!;
    expect(Object.keys(logged.cmd).sort()).toEqual(['moveId', 'taxes', 'type']);
    expect(() => act(id, host.id, 'budget', { moveId: 'big', taxes: { town: 900, junk: 'x'.repeat(3000) } })).toThrow('That move could not be read.');
    // Presence moves are limited per seat (they are never in the engine's log, so its limit cannot count them).
    expect(() => {
      for (let k = 0; k < 30; k++) act(id, host.id, 'hello');
    }).toThrow('Slow down a little');
  });
});
