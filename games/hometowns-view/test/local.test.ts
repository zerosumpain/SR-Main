// Harness mode's solo county (spec §9.16): founded and played by hand
// through the engine's own moves, on a local clock with a dev speed, kept in
// the browser and caught up on return.

import { describe, expect, it } from 'vitest';
import { COUNTY_ROAD_X, population } from '../src/engine';
import { LocalCounty, SPEEDS } from '../src/harness/local';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('LocalCounty', () => {
  it('founds a town by hand and refuses a second one with the engine’s sentence', () => {
    const l = new LocalCounty({ seed: 3 });
    expect(l.town).toBeNull();
    expect(l.found({ site: 1, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 }).ok).toBe(true);
    expect(l.town?.name).toBe('Oakvale');
    const again = l.found({ site: 2, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 });
    expect(again).toEqual({ ok: false, error: 'You already have a town.' });
  });

  it('plays the Founding Fortnight with taps that never wait, then joins the clock', () => {
    const l = new LocalCounty({ seed: 3 });
    l.found({ site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 });
    const lane = l.act({ type: 'build', planId: 'p1', plan: [{ op: 'road', kind: 'lane', path: [COUNTY_ROAD_X, 46, COUNTY_ROAD_X - 6, 46] }, { op: 'zone', zone: 'homes', rect: [COUNTY_ROAD_X - 6, 45, 6, 1] }] });
    expect(lane.ok).toBe(true);
    expect(lane.result?.cost).toBeGreaterThan(0);
    expect(l.sprint().ok).toBe(true);
    expect(l.sprint().ok).toBe(true); // a second tap at once: the clock steps over the 10-second gap
    expect(l.inFortnight).toBe(true);
    expect(l.sprintAll()).toBeGreaterThan(0);
    expect(l.inFortnight).toBe(false);
    expect(population(l.town!)).toBeGreaterThan(0);
  });

  it('runs whole ticks at the chosen speed, inside the frame budget', () => {
    const l = new LocalCounty({ seed: 4 });
    l.found({ site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 });
    l.sprintAll();
    l.speed = SPEEDS[3]; // 4 weeks a second
    const t0 = l.town!.tick;
    let ran = 0;
    for (let k = 0; k < 10; k++) ran += l.advance(250, 1000, () => performance.now());
    expect(ran).toBeGreaterThanOrEqual(9);
    expect(l.town!.tick - t0).toBe(ran);
    l.speed = 0;
    expect(l.advance(1000, 1000, () => performance.now())).toBe(0);
  });

  it('undoes today’s plan in full, as the server would', () => {
    const l = new LocalCounty({ seed: 5 });
    l.found({ site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 });
    const money = l.town!.money.reserves;
    l.act({ type: 'build', planId: 'p1', plan: [{ op: 'road', kind: 'lane', path: [COUNTY_ROAD_X, 46, COUNTY_ROAD_X - 4, 46] }] });
    expect(l.town!.money.reserves).toBeLessThan(money);
    const u = l.act({ type: 'undo', moveId: 'u1', planId: 'p1' });
    expect(u.ok).toBe(true);
    expect(l.town!.money.reserves).toBe(money);
  });

  it('keeps the county in the browser and catches up the time away at the Live rate', () => {
    const store = memoryStorage();
    const saved = globalThis.localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = store;
    try {
      let real = 1_000_000;
      const a = new LocalCounty({ seed: 6, storageKey: 'k', realNow: () => real });
      a.found({ site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 2 });
      a.sprintAll();
      a.save(true);
      const tick = a.town!.tick;
      real += 10 * 60_000; // ten minutes away = 20 dev-clock weeks
      const b = new LocalCounty({ seed: 6, storageKey: 'k', realNow: () => real });
      expect(b.restored).toBe(true);
      expect(b.town!.tick).toBe(tick);
      expect(b.catchingUp).toBe(true);
      while (b.catchingUp) b.advance(0, 50, () => performance.now());
      expect(b.town!.tick - tick).toBeGreaterThanOrEqual(19);
      expect(b.town!.tick - tick).toBeLessThanOrEqual(21);
      // Another seed is another county.
      expect(new LocalCounty({ seed: 7, storageKey: 'k', realNow: () => real }).restored).toBe(false);
      b.forget();
      expect(store.getItem('k')).toBeNull();
      // "Start a new county" reloads the page, whose beforeunload saves: nothing comes back.
      b.save(true);
      expect(store.getItem('k')).toBeNull();
      // A county another engine saved starts afresh instead of failing to start.
      a.save(true);
      const raw = JSON.parse(store.getItem('k')!);
      store.setItem('k', JSON.stringify({ ...raw, engine: 'another-engine' }));
      expect(new LocalCounty({ seed: 6, storageKey: 'k', realNow: () => real }).restored).toBe(false);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = saved;
    }
  });

  it('lets the harness bot play on autopilot (?bot=1)', () => {
    const l = new LocalCounty({ seed: 8 });
    l.autopilot = true;
    l.speed = SPEEDS[5];
    for (let k = 0; k < 60 && (l.inFortnight || !l.town); k++) l.advance(1000, 1000, () => performance.now());
    expect(l.town).not.toBeNull();
    expect(l.inFortnight).toBe(false);
    expect(l.town!.tick).toBeGreaterThan(12);
  });
});
