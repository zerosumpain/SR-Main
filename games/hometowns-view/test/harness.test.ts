// The page makes no network calls (spec §9.1, §9.16, WP6's acceptance list):
// fetch, XMLHttpRequest, WebSocket and EventSource are replaced by throwing
// stubs while a county is founded and played by hand in harness mode, the
// harness bot plays, a plan is forecast, and app mode takes server frames,
// predicts and commits. Any call would fail the test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const saved: Record<string, unknown> = {};
const NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;

beforeAll(() => {
  for (const n of NAMES) {
    saved[n] = (globalThis as Record<string, unknown>)[n];
    (globalThis as Record<string, unknown>)[n] = function blocked() {
      throw new Error(`the page called ${n}`);
    };
  }
});
afterAll(() => {
  for (const n of NAMES) (globalThis as Record<string, unknown>)[n] = saved[n];
});

describe('no network', () => {
  it('founds, plans, forecasts and plays a solo county by hand', async () => {
    const { LocalCounty } = await import('../src/harness/local');
    const { COUNTY_ROAD_X, USE_EMPTY, buildable, parcelOpen, planesOf, stateHash, terrainOf, tileIndex } = await import('../src/engine');
    const { previewPlan } = await import('../src/plan/plan');
    const { handleForecast } = await import('../src/forecast/core');
    const l = new LocalCounty({ seed: 5 });
    expect(l.found({ site: 1, nameParts: ['Fox', 'ton'], avatar: 'badger', flag: 0 }).ok).toBe(true);
    const t = l.town!;
    const free = (x: number, y: number) => parcelOpen(t, x, y) && planesOf(t).use[tileIndex(x, y)] === USE_EMPTY && buildable(terrainOf(t)[tileIndex(x, y)]);
    const y = [...Array(28).keys()].map((k) => 17 + k).find((r) => [1, 2, 3, 4, 5].every((d) => free(COUNTY_ROAD_X - d, r) && free(COUNTY_ROAD_X - d, r + 1)))!;
    const ops = [
      { op: 'road' as const, kind: 'lane' as const, path: [COUNTY_ROAD_X, y, COUNTY_ROAD_X - 5, y] },
      { op: 'zone' as const, zone: 'homes' as const, rect: [COUNTY_ROAD_X - 5, y + 1, 5, 1] as [number, number, number, number] },
    ];
    const preview = previewPlan(t, ops, { params: l.params, dayIndex: l.county.dayIndex, profile: 'adult' });
    const ctx = { townIndex: 0, dayIndex: l.county.dayIndex, rivalry: 'friendly' as const, mishaps: 'mild' as const, paramsVersion: l.county.paramsVersion, profile: 'adult' as const };
    const f = handleForecast({ id: 1, kind: 'plan', key: stateHash(t), town: t, snapshot: l.county.snapshot, ctx, plan: { type: 'build', planId: 'n1', plan: ops }, seeds: [1, 2] }, { key: '', baseline: null });
    expect(f.kind).toBe('plan');
    expect(preview.refused).toBeNull();
    expect(l.act({ type: 'build', planId: 'n1', plan: ops }).ok).toBe(true);
    l.sprintAll();
    l.runDays(1);
    expect(l.population()).toBeGreaterThan(0);
  });

  it('lets the harness bot play two days', async () => {
    const { HarnessSession } = await import('../src/harness/session');
    const s = new HarnessSession({ seed: 5, site: 1 });
    s.runDays(2);
    expect(s.stats().population).toBeGreaterThan(0);
    expect(s.county.dayIndex).toBeGreaterThanOrEqual(1);
  });

  it('runs whole bot ticks under a frame budget and stops when the budget is spent', async () => {
    const { HarnessSession } = await import('../src/harness/session');
    const s = new HarnessSession({ seed: 5 });
    let fake = 0;
    const ran = s.run(100, 10, () => (fake += 4)); // each clock read "takes" 4 ms
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(100);
    expect(s.run(5)).toBe(5);
  });

  it('takes server frames, predicts and commits in app mode', async () => {
    const HT = await import('../../../src/lib/games/hometowns/hometowns');
    const { AppSession } = await import('../src/app');
    const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);
    const room = HT.createRoom({ id: 'offline-1', host: { id: 'h', name: 'Mayor' }, invite: [], difficulty: 'easy' as never, now: T0 });
    HT.start(room, 'h', T0);
    HT.moves.found(room, 'h', { site: 2, nameParts: ['Fox', 'ton'], avatar: 'badger', flag: 0 }, T0 + 1000);
    const sources: unknown[] = [];
    const posts: unknown[] = [];
    const fake = { setSource: (x: unknown) => sources.push(x), noteCanary() {}, stats: () => ({}), settings() {}, timelapse: () => false, setTool() {} };
    const s = new AppSession(fake as never, (m) => posts.push(m));
    s.boot({ bridge: 1, engineHash: 'x', wire: HT.toWire(room, 'h', T0 + 2000) as never, copyLevel: 'adult', theme: 'light', reduceMotion: true, locale: 'en-GB' });
    s.beforeFrame();
    expect(sources.length).toBeGreaterThan(0);
  });
});
