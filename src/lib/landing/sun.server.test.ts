import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VitalsLocation } from '$lib/vitals/location';

// Home Assistant's config row: absent (cold start) or present, per test.
const ha = vi.hoisted(() => ({ config: null as null | { url: string; token: string } }));

vi.mock('$lib/db/schema', () => ({ homeAssistantConfig: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (ha.config ? [{ id: 'default', ...ha.config }] : []),
        }),
      }),
    }),
  },
}));

const NOW = new Date('2026-10-10T11:00:00Z');

/** Fresh copies of the location (and its caches) and the sun module. */
async function fresh() {
  vi.resetModules();
  const location = await import('$lib/vitals/location');
  const sun = await import('./sun.server');
  return { ...location, ...sun };
}

beforeEach(() => {
  ha.config = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ownerSun', () => {
  it('answers null for the cold-start default, so the page draws its old sky', async () => {
    const { ownerSun, getVitalsLocation, isColdFallback } = await fresh();
    expect(isColdFallback(await getVitalsLocation())).toBe(true);
    expect(await ownerSun(NOW, { wait: true })).toBeNull();
  });

  it("works out the sun from Home Assistant's position, rounded first, and sends two keys", async () => {
    ha.config = { url: 'http://ha.test', token: 't' };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://ha.test/api/states/'))
        return new Response(JSON.stringify({ attributes: { latitude: 35.6812, longitude: 139.7671 } }));
      return new Response(JSON.stringify({ address: { city: 'Tokyo' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ownerSun, sunAt, getVitalsLocation, isColdFallback } = await fresh();
    const { sunFrom } = await import('./sun');

    const sun = await ownerSun(new Date('2026-10-10T03:00:00Z'), { wait: true });
    expect(sun).not.toBeNull();
    expect(Object.keys(sun!).sort()).toEqual(['alt', 'rising']);
    // Tokyo's midday, from the half-degree point, not the exact one.
    expect(sun).toEqual(sunFrom(35.5, 140, Date.parse('2026-10-10T03:00:00Z')));
    expect(sun!.alt).toBeGreaterThan(40);
    const json = JSON.stringify(sun);
    expect(json).not.toMatch(/35\.|139|140|lat|lon|Tokyo/);

    const loc = await getVitalsLocation();
    expect(isColdFallback(loc)).toBe(false);
    expect(sunAt(loc, NOW.getTime())).toEqual(sunFrom(35.5, 140, NOW.getTime()));
  });

  it('a position Home Assistant gave once is still used (with no town) after it goes quiet', async () => {
    const { sunAt, isColdFallback } = await fresh();
    const known: VitalsLocation = { lat: 51.5, lon: -0.1, town: null };
    // Equal to the fallback by value, but a real reading: only the fallback itself is unknown.
    expect(isColdFallback(known)).toBe(false);
    expect(sunAt(known, NOW.getTime())).not.toBeNull();
  });

  it('gives up after its budget and answers null', async () => {
    vi.useFakeTimers();
    const { ownerSun } = await fresh();
    const slow = () => new Promise<VitalsLocation>(() => {});
    const p = ownerSun(NOW, { wait: true, peek: () => null, locate: slow });
    await vi.advanceTimersByTimeAsync(401);
    expect(await p).toBeNull();
  });

  it('answers null when the location read fails', async () => {
    const { ownerSun } = await fresh();
    const down = () => Promise.reject(new Error('down'));
    expect(await ownerSun(NOW, { wait: true, peek: () => null, locate: down })).toBeNull();
  });

  it('never waits for a view that does not draw the sky', async () => {
    const { ownerSun } = await fresh();
    const locate = vi.fn(() => new Promise<VitalsLocation>(() => {}));
    expect(await ownerSun(NOW, { peek: () => null, locate })).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it('uses a known position at once, even one past its ten minutes', async () => {
    const { ownerSun } = await fresh();
    const { sunFrom } = await import('./sun');
    const locate = vi.fn(() => new Promise<VitalsLocation>(() => {}));
    const known: VitalsLocation = { lat: 53.48, lon: -2.24, town: 'Manchester' };
    expect(await ownerSun(NOW, { wait: true, peek: () => known, locate })).toEqual(sunFrom(53.5, -2, NOW.getTime()));
    expect(locate).not.toHaveBeenCalled();
  });

  it('shares one Home Assistant read between callers on a cold cache', async () => {
    ha.config = { url: 'http://ha.test', token: 't' };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://ha.test/api/states/'))
        return new Response(JSON.stringify({ attributes: { latitude: 53.4808, longitude: -2.2426 } }));
      return new Response(JSON.stringify({ address: { city: 'Manchester' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ownerSun, getVitalsLocation } = await fresh();

    // Two page loads and the vitals endpoint, all at once on a cold cache.
    const [a, b, loc] = await Promise.all([
      ownerSun(NOW, { wait: true }),
      ownerSun(NOW, { wait: true }),
      getVitalsLocation(),
    ]);
    const haCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('http://ha.test/'));
    const geocodes = fetchMock.mock.calls.filter(([u]) => String(u).includes('nominatim'));
    expect(haCalls).toHaveLength(1);
    expect(geocodes).toHaveLength(1);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(loc.town).toBe('Manchester');

    // Warm: no further reads.
    await ownerSun(NOW, { wait: true });
    await getVitalsLocation();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('/api/vitals/state', () => {
  it('carries the sun as two keys and never the position', async () => {
    ha.config = { url: 'http://ha.test', token: 't' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('http://ha.test/api/states/'))
          return new Response(JSON.stringify({ attributes: { latitude: 53.4808, longitude: -2.2426 } }));
        if (url.includes('open-meteo'))
          return new Response(JSON.stringify({ current: { temperature_2m: 12, weather_code: 0, wind_speed_10m: 3, wind_direction_10m: 90, is_day: 1 } }));
        return new Response(JSON.stringify({ address: { city: 'Manchester' } }));
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fresh();
    const { GET } = await import('../../routes/api/vitals/state/+server');
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(Object.keys(body.sun).sort()).toEqual(['alt', 'rising']);
    expect(Number.isInteger(body.sun.alt)).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/53\.4|2\.24|latitude|longitude|"lat"|"lon"/);
  });

  it('works the sun out afresh on every GET, not from the cached state', async () => {
    ha.config = { url: 'http://ha.test', token: 't' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('http://ha.test/api/states/'))
          return new Response(JSON.stringify({ attributes: { latitude: 53.4808, longitude: -2.2426 } }));
        if (url.includes('open-meteo'))
          return new Response(JSON.stringify({ current: { temperature_2m: 12, weather_code: 0, wind_speed_10m: 3, wind_direction_10m: 90, is_day: 1 } }));
        return new Response(JSON.stringify({ address: { city: 'Manchester' } }));
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    // Manchester, a winter evening around sunset, when the sun moves fastest.
    vi.setSystemTime(new Date('2026-12-21T15:00:00Z'));
    await fresh();
    const { sunFrom } = await import('./sun');
    const { GET } = await import('../../routes/api/vitals/state/+server');
    const first = await (await GET({} as Parameters<typeof GET>[0])).json();
    expect(first.sun).toEqual(sunFrom(53.5, -2, Date.parse('2026-12-21T15:00:00Z')));
    // Forty seconds on the state is still cached, but the sun is not.
    vi.setSystemTime(new Date('2026-12-21T15:00:40Z'));
    const second = await (await GET({} as Parameters<typeof GET>[0])).json();
    expect(second.lastUpdated).toBe(first.lastUpdated);
    expect(second.sun).toEqual(sunFrom(53.5, -2, Date.parse('2026-12-21T15:00:40Z')));
  });
});
