// App mode against the real server adapter (WP4's frames, spec §10.7,
// §10.9): a mock app boots the page with a whole frame, forwards deltas,
// posts the page's plans and answers with commitResult. The page must rebuild
// exactly the server's town from every frame, predict the next ticks to the
// server's hash (the canary), apply a plan at once and roll it back on a
// refusal, and ask for a whole frame or another page version when it must.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as HT from '../../../src/lib/games/hometowns/hometowns';
import { COUNTY_ROAD_X, ENGINE_HASH, USE_EMPTY, buildable, parcelOpen, planesOf, stateHash, terrainOf, tileIndex, type Op, type TownState } from '../src/engine';
import { AppSession } from '../src/app';
import { RELOAD_GAP_MS, resetReloadMemo } from '../src/bridge/bridge';
import { PAGE_HASH } from '../src/version';
import type { PageMessage } from '../src/bridge/protocol';
import type { Controller, Source } from '../src/controller';
import type { WireFrame } from '../src/core/frames';

/** The controller as far as the session sees it: it records what it was given. */
function fakeController() {
  const c = {
    sources: [] as Source[],
    canary: [] as unknown[],
    restored: [] as { planId: string; ops: readonly Op[] }[],
    restorePlan(planId: string, ops: readonly Op[]) {
      c.restored.push({ planId, ops });
    },
    setSource(s: Source) {
      c.sources.push(s);
    },
    noteCanary(r: unknown) {
      c.canary.push(r);
    },
    stats: () => ({ fps: 60, minFps: 55, simMs: 1, thermal: 'nominal' as const, canary: null }),
    settings() {},
    timelapse: () => false,
    setTool() {},
    get last(): Source {
      return c.sources[c.sources.length - 1];
    },
  };
  return c;
}

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0); // a Tuesday morning: the Regional Day is hours away
const lane = (y: number): Op => ({ op: 'road', kind: 'lane', path: [COUNTY_ROAD_X, y, COUNTY_ROAD_X - 5, y] });
/** Rows beside the County Road with five free, buildable tiles west of it. */
const freeRows = (t: TownState): number[] =>
  [...Array(30).keys()].map((k) => 17 + k).filter((y) => [1, 2, 3, 4, 5].every((d) => parcelOpen(t, COUNTY_ROAD_X - d, y) && planesOf(t).use[tileIndex(COUNTY_ROAD_X - d, y)] === USE_EMPTY && buildable(terrainOf(t)[tileIndex(COUNTY_ROAD_X - d, y)])));

describe('app mode against the server adapter', () => {
  const room = HT.createRoom({ id: 'contract-1', host: { id: 'h', name: 'Mayor' }, invite: [], difficulty: 'easy' as never, now: T0 });
  HT.start(room, 'h', T0);
  HT.moves.found(room, 'h', { site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 1 }, T0 + 1000);
  HT.moves.build(room, 'h', { planId: 'seed-1', plan: [lane(46), { op: 'zone', zone: 'homes', rect: [COUNTY_ROAD_X - 5, 45, 5, 1] }] }, T0 + 2000);
  for (let k = 0; k < 12; k++) HT.moves.sprint(room, 'h', { moveId: `sp-${k}` }, T0 + 3000 + k * 11_000);
  const tick = room.county.tickMs;
  let now = T0 + 3000 + 12 * 11_000 + 1000;

  const posted: PageMessage[] = [];
  const c = fakeController();
  const s = new AppSession(c as unknown as Controller, (m) => posted.push(m));
  let held: WireFrame;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    resetReloadMemo();
  });
  afterAll(() => vi.useRealTimers());

  it('boots on a whole frame and draws exactly the server’s town', () => {
    held = HT.toWire(room, 'h', now) as WireFrame;
    expect(held.base).toBeNull();
    s.boot({ bridge: 1, engineHash: ENGINE_HASH, wire: held, copyLevel: 'adult', theme: 'light', reduceMotion: true, locale: 'en-GB' });
    expect(c.last.town.tick).toBe(held.me!.town!.tick);
    expect(stateHash(c.last.town)).toBe(held.me!.townHash);
    expect(posted.filter((m) => m.type === 'needResync' || m.type === 'error')).toEqual([]);
  });

  it('predicts the next ticks on its own, and the next frame’s canary agrees', () => {
    const before = c.last.town.tick;
    now += 3 * tick;
    vi.setSystemTime(now);
    s.beforeFrame();
    // Two or three ticks, depending on where the first grid tick after the fortnight fell (§2.3).
    const ticked = c.last.town.tick;
    expect(ticked - before).toBeGreaterThanOrEqual(2);
    const predicted = stateHash(c.last.town);
    const f = HT.toWire(room, 'h', now, held.rev) as WireFrame;
    expect(f.base).toBe(held.rev); // a delta
    s.apply(f);
    held = s.held!;
    expect(held.me!.town!.tick).toBe(ticked);
    expect(held.me!.townHash).toBe(predicted);
    expect(c.canary[c.canary.length - 1]).toEqual({ tick: ticked, ok: true, hash: predicted });
  });

  it('applies a plan at once, posts it, and keeps it until a frame lists it', () => {
    const op = lane(freeRows(c.last.town)[0]);
    const before = stateHash(c.last.town);
    expect(s.commit('plan-a', [op])).toBeNull();
    expect(posted[posted.length - 1]).toEqual({ type: 'commit', planId: 'plan-a', ops: [op] });
    expect(stateHash(c.last.town)).not.toBe(before);
    // The app posts the move; the server's next frame lists it, and the page then shows the server's town.
    HT.moves.build(room, 'h', { planId: 'plan-a', plan: [op] }, now);
    s.commitResult({ planId: 'plan-a', ok: true });
    s.apply(HT.toWire(room, 'h', now, s.held!.rev) as WireFrame);
    expect(stateHash(c.last.town)).toBe(s.held!.me!.townHash);
    expect(s.held!.me!.moves!.some((m) => m.id === 'plan-a')).toBe(true);
  });

  it('rolls a refused plan back to the server’s town and says why', () => {
    const server = s.held!.me!.townHash;
    expect(s.commit('plan-b', [lane(freeRows(c.last.town)[0])])).toBeNull();
    expect(stateHash(c.last.town)).not.toBe(server);
    const op = (posted[posted.length - 1] as { ops: Op[] }).ops;
    s.commitResult({ planId: 'plan-b', ok: false, error: 'Kingsport is just finishing the day. Trying again…' });
    expect(stateHash(c.last.town)).toBe(server);
    expect(posted.slice(-2)).toEqual([
      { type: 'haptic', kind: 'bad' },
      { type: 'error', msg: 'Kingsport is just finishing the day. Trying again…' },
    ]);
    // The plan comes back as ghosts, under its own id, to be fixed and built again.
    expect(c.restored[c.restored.length - 1]).toEqual({ planId: 'plan-b', ops: op });
  });

  it('stops showing a plan the server took but no frame lists, and asks for a whole frame', () => {
    expect(s.commit('plan-z', [lane(freeRows(c.last.town)[0])])).toBeNull();
    s.commitResult({ planId: 'plan-z', ok: true });
    const server = s.held!.me!.townHash;
    for (let k = 0; k < 3; k++) {
      now += 1000;
      vi.setSystemTime(now);
      s.apply(HT.toWire(room, 'h', now, s.held!.rev) as WireFrame);
    }
    expect(stateHash(c.last.town)).toBe(server);
    expect(posted.some((m) => m.type === 'needResync')).toBe(true);
  });

  it('leaves the page as it was on a malformed visit or frame, and says so', () => {
    const rev = s.held!.rev;
    const drawn = c.sources.length;
    const n = posted.length;
    expect(() => s.api().visit({ planes: 'abc', buildings: 7 } as never)).not.toThrow();
    expect(() => s.apply({ ...s.held!, clock: undefined } as never)).not.toThrow();
    expect(s.held!.rev).toBe(rev);
    expect(c.sources.length).toBe(drawn);
    expect(posted.slice(n).map((m) => m.type)).toEqual(['error', 'error']);
    // Still home: tools and plans work.
    expect(s.commit('plan-y', [lane(freeRows(c.last.town)[0])])).toBeNull();
    s.commitResult({ planId: 'plan-y', ok: false });
  });

  it('refuses a plan the engine refuses, before anything is posted', () => {
    const n = posted.length;
    expect(s.commit('plan-c', [{ op: 'place', id: 'pocketPark', x: 0, y: 0, rot: 0 }])).toMatch(/does not fit/);
    expect(posted.length).toBe(n);
  });

  it('asks for a whole frame when a delta does not fit what it holds (at most once every few seconds)', () => {
    now += 6000;
    vi.setSystemTime(now);
    const f = HT.toWire(room, 'h', now, s.held!.rev) as WireFrame;
    s.apply({ ...f, base: (f.base ?? 0) + 1000, rev: f.rev + 1000 });
    expect(posted[posted.length - 1]).toEqual({ type: 'needResync', have: s.held!.rev });
  });

  it('names this page on the wire, so its own frames never ask for a reload', () => {
    expect(held.client.page).toBe(`/projects/hometowns/${PAGE_HASH}/mobile.html`);
    expect(held.client.engineHash).toBe(ENGINE_HASH);
    expect(posted.filter((m) => m.type === 'needReload')).toEqual([]);
  });

  it('asks the app for the page that matches a different engine, once, and never throws on its frames', () => {
    const f = HT.toWire(room, 'h', now, null) as WireFrame;
    const page = '/projects/hometowns/ffff0000ffff0000/mobile.html';
    const other = { ...f, client: { ...f.client, engineHash: 'ffffffffffff', page }, me: { ...f.me!, predict: { ...f.me!.predict!, paramsVersion: 'v99' as never } } };
    const n = posted.length;
    expect(() => s.apply(other)).not.toThrow();
    expect(() => s.apply(other)).not.toThrow();
    expect(posted.filter((m) => m.type === 'needReload')).toEqual([{ type: 'needReload', engineHash: 'ffffffffffff', pageHash: 'ffff0000ffff0000', page }]);
    // Held for the next delta, with no resync and no error: the reload is the answer.
    expect(s.held!.rev).toBe(other.rev);
    expect(posted.slice(n).filter((m) => m.type === 'needResync' || m.type === 'error')).toEqual([]);
  });

  it('reloads for a page-only change (same engine, new page) at most once a minute, and keeps predicting meanwhile', () => {
    resetReloadMemo();
    const p: PageMessage[] = [];
    const c3 = fakeController();
    const s3 = new AppSession(c3 as unknown as Controller, (m) => p.push(m));
    const page = '/projects/hometowns/0123456789abcdef/mobile.html';
    const whole = HT.toWire(room, 'h', now, null) as WireFrame;
    s3.boot({ bridge: 1, engineHash: ENGINE_HASH, wire: { ...whole, client: { ...whole.client, page } }, copyLevel: 'adult', theme: 'light', reduceMotion: true, locale: 'en-GB' });
    expect(p.filter((m) => m.type === 'needReload')).toEqual([{ type: 'needReload', engineHash: ENGINE_HASH, pageHash: '0123456789abcdef', page }]);
    // The engine is the same, so the frame was taken as usual: the server's town, no error, no resync.
    expect(stateHash(c3.last.town)).toBe(whole.me!.townHash);
    expect(p.filter((m) => m.type === 'needResync' || m.type === 'error')).toEqual([]);
    // Another page within the minute waits (A39); after it, it is asked for.
    const later = '/projects/hometowns/1111222233334444/mobile.html';
    s3.apply({ ...whole, client: { ...whole.client, page: later } });
    expect(p.filter((m) => m.type === 'needReload')).toHaveLength(1);
    now += RELOAD_GAP_MS + 1;
    vi.setSystemTime(now);
    s3.apply({ ...whole, client: { ...whole.client, page: later } });
    expect(p.filter((m) => m.type === 'needReload').map((m) => (m as { pageHash: string }).pageHash)).toEqual(['0123456789abcdef', '1111222233334444']);
    // A path that is not a Hometowns page names nothing.
    now += RELOAD_GAP_MS + 1;
    vi.setSystemTime(now);
    s3.apply({ ...whole, client: { ...whole.client, page: 'https://elsewhere.test/x.html' } });
    expect(p.filter((m) => m.type === 'needReload')).toHaveLength(2);
  });

  it('asks for the page a boot or frame names even when it cannot take that frame', () => {
    resetReloadMemo();
    const p: PageMessage[] = [];
    const s4 = new AppSession(fakeController() as unknown as Controller, (m) => p.push(m));
    const page = '/projects/hometowns/5555666677778888/mobile.html';
    const whole = HT.toWire(room, 'h', now, null) as WireFrame;
    // A newer server changed the clock's shape: this page cannot read the frame, but it names the page that can.
    const unreadable = { ...whole, clock: { ...whole.clock, tickMs: 'fast' }, client: { ...whole.client, page } } as unknown as WireFrame;
    s4.boot({ bridge: 1, engineHash: ENGINE_HASH, wire: unreadable, copyLevel: 'adult', theme: 'light', reduceMotion: true, locale: 'en-GB' });
    expect(p.filter((m) => m.type === 'needReload')).toEqual([{ type: 'needReload', engineHash: ENGINE_HASH, pageHash: '5555666677778888', page }]);
    expect(p.filter((m) => m.type === 'error')).toHaveLength(1);
    // The same after boot, once the minute has passed (A39).
    const next = '/projects/hometowns/9999aaaabbbbcccc/mobile.html';
    now += RELOAD_GAP_MS + 1;
    vi.setSystemTime(now);
    s4.apply({ ...unreadable, client: { ...whole.client, page: next } });
    expect(p.filter((m) => m.type === 'needReload').map((m) => (m as { pageHash: string }).pageHash)).toEqual(['5555666677778888', '9999aaaabbbbcccc']);
  });

  it('checks every call the app makes before acting on it', () => {
    const api = s.api();
    expect(api.bridge).toBe(1);
    expect(api.engineHash).toBe(ENGINE_HASH);
    expect(api.pageHash).toBe(PAGE_HASH);
    expect(() => api.tool({ kind: 'launch' } as never)).not.toThrow();
    expect(() => api.ghost({ plan: 'nope' } as never)).not.toThrow();
    expect(() => api.focus({ x: -1, y: 99 })).not.toThrow();
    expect(() => api.commitResult({ planId: '<x>', ok: false })).not.toThrow();
  });

  it('reports an older app’s bridge as an error', () => {
    const p2: PageMessage[] = [];
    const s2 = new AppSession(fakeController() as unknown as Controller, (m) => p2.push(m));
    s2.boot({ bridge: 0, engineHash: ENGINE_HASH, wire: held, copyLevel: 'kid', theme: 'dark', reduceMotion: false, locale: 'en-GB' });
    expect(p2[0]).toMatchObject({ type: 'error' });
    expect(s2.isBooted).toBe(false);
  });

  it('never needed its own town object to stay the server’s: every frame replaced it', () => {
    const t: TownState = c.last.town;
    expect(t).not.toBe(s.held!.me!.town);
  });
});
