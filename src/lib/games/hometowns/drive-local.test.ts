// scripts/hometowns/drive-local.ts played in-process: the same driver the
// local stack runs over HTTP, here over rooms.server with the in-memory store
// and fake timers. A solo county is founded, played by the Balanced bot for a
// dev-clock day and a half with a restart in the middle, and every frame is
// checked: deltas merge to the server's town hash, and the phone's exact
// prediction matches the server at every view (the canary, M1's exit). A
// second run loses the last session's writes in its restart: the driver must
// see the whole frame that follows and post the lost moves again (A28).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../quiz-night.server', () => ({ writeQuiz: async () => {} }));
import { _resetRooms, _setRecorder, _setRoomStore, _setTurnPusher, act, createGame, ensureRoom, flush, roomFor, subscribe } from '../rooms.server';
import { memoryRoomStore } from '../room-store';
import { GameError } from '../tap-duel';
import { DriveError, driveSolo, type Transport } from '../../../../scripts/hometowns/drive-local';
import type { HometownsWire } from './engine/wire';

const T0 = 1_792_497_600_000;
const host = { id: 'p_host', name: 'Host' };
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let store: ReturnType<typeof memoryRoomStore>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  process.env.HOMETOWNS_DEV_CLOCK = '1';
  store = memoryRoomStore();
  _setRoomStore(store);
  _setRecorder(async () => ({}));
  _setTurnPusher(async (_kind, _room, ids) => ids);
});
afterEach(() => {
  _resetRooms();
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  delete process.env.HOMETOWNS_DEV_CLOCK;
  vi.useRealTimers();
});

/** The phone's four calls, made straight into the registry as the API would (frames copied, as JSON would). */
function inProcess(): Transport {
  const asDrive = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof GameError) throw new DriveError(e.status, e.message);
      throw e;
    }
  };
  return {
    async start(body) {
      const w = createGame({ game: 'hometowns', host, invite: [], difficulty: 'easy', options: { pace: body.pace, county: body.county } });
      await flush(w.id);
      return copy(w) as unknown as HometownsWire;
    },
    async act(id, body) {
      await ensureRoom(id);
      const w = asDrive(() => act(id, host.id, String(body.action), body));
      await flush(id);
      return copy(w) as unknown as HometownsWire;
    },
    async view(id) {
      await ensureRoom(id);
      return copy(asDrive(() => roomFor(id, host.id))) as unknown as HometownsWire;
    },
    stream(id, onFrame) {
      return subscribe(id, host.id, (w) => onFrame(copy(w) as unknown as HometownsWire), () => {});
    },
  };
}

describe('drive-local, in process', () => {
  it('plays a solo county through the API with a restart, with no canary or delta mismatch', async () => {
    let roomId = '';
    const transport = inProcess();
    const start = transport.start.bind(transport);
    transport.start = async (body) => {
      const w = await start(body);
      roomId = w.id;
      return w;
    };
    const report = await driveSolo({
      transport,
      clock: { now: () => Date.now(), wait: (ms) => vi.advanceTimersByTimeAsync(ms).then(() => {}) },
      days: 1.1,
      devTickMs: 30_000,
      seed: 3,
      restart: async () => {
        await flush(roomId);
        _resetRooms();
        await ensureRoom(roomId);
      },
    });
    expect(report.restarts).toBe(1);
    expect(report.regionalDays).toBeGreaterThanOrEqual(1);
    expect(report.moves.accepted).toBeGreaterThan(20);
    expect(report.frames.deltas).toBeGreaterThan(0);
    expect(report.frames.stream).toBeGreaterThan(0);
    expect(report.delta.checked).toBeGreaterThan(20);
    expect(report.delta.mismatches).toBe(0);
    expect(report.canary.checked).toBeGreaterThan(3);
    expect(report.canary.mismatches).toBe(0);
    expect(report.final!.tick).toBeGreaterThan(48);
  }, 60_000);

  it('posts again the moves a restart lost, and still never mismatches', async () => {
    let roomId = '';
    const transport = inProcess();
    const start = transport.start.bind(transport);
    transport.start = async (body) => {
      const w = await start(body);
      roomId = w.id;
      return w;
    };
    // The row as it was at the start of each session: the restart puts it back, losing what came after.
    let earlier: ReturnType<typeof store.rows.get> = undefined;
    const view = transport.view.bind(transport);
    transport.view = async (id) => {
      await flush(id);
      earlier = structuredClone(store.rows.get(id));
      return view(id);
    };
    const report = await driveSolo({
      transport,
      clock: { now: () => Date.now(), wait: (ms) => vi.advanceTimersByTimeAsync(ms).then(() => {}) },
      days: 1.1,
      devTickMs: 30_000,
      seed: 3,
      restart: async () => {
        await flush(roomId);
        _resetRooms();
        if (earlier) store.rows.set(roomId, earlier);
        await ensureRoom(roomId);
      },
    });
    expect(report.restarts).toBe(1);
    expect(report.moves.reposted).toBeGreaterThan(0);
    expect(report.delta.mismatches).toBe(0);
    expect(report.canary.mismatches).toBe(0);
  }, 60_000);
});
