import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// What is under test is the ORDER — Mapbox, then cache, then Nominatim — and the
// licence rule that only a Nominatim hit is ever written back. Everything either
// side of that is stubbed: the database, the cache writer, and both providers.

const h = vi.hoisted(() => ({ cacheRows: [] as Array<{ value: unknown }> }));

vi.mock('$lib/db', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.where = () => builder;
  builder.limit = () => Promise.resolve(h.cacheRows);
  return { db: { select: () => builder } };
});

vi.mock('$lib/db/schema', () => ({
  appSettings: { key: 'key', value: 'value', updatedAt: 'updated_at' },
}));

const setSetting = vi.fn();
vi.mock('$lib/server/models/settings', () => ({ setSetting }));

const forwardGeocode = vi.fn();
const mapboxApiConfigured = vi.fn();
class MapboxNotConfiguredError extends Error {}
vi.mock('$lib/maps/mapbox-api', () => ({
  forwardGeocode,
  mapboxApiConfigured,
  MapboxNotConfiguredError,
}));

async function loadGeocode() {
  vi.resetModules();
  return import('./geocode');
}

/** One Nominatim search result, in its own wire shape. */
function nominatimHit(name = 'Norwich Cathedral, Norfolk, England') {
  return [{ lat: '52.6323', lon: '1.2939', display_name: name }];
}

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  h.cacheRows = [];
  setSetting.mockReset();
  forwardGeocode.mockReset();
  mapboxApiConfigured.mockReset();
  mapboxApiConfigured.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider order', () => {
  it('answers from Mapbox without touching Nominatim', async () => {
    forwardGeocode.mockResolvedValue([
      { lat: 52.6323, lng: 1.2939, label: 'Norwich Cathedral, Norwich', name: 'Norwich Cathedral', poiCategories: [], featureType: 'poi', countryCode: 'GB' },
    ]);
    const fetchMock = stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    const hit = await geocodePlace('Norwich Cathedral');

    expect(hit).toMatchObject({ lat: 52.6323, lng: 1.2939, source: 'mapbox' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers Mapbox over a cached Nominatim answer', async () => {
    // The assertion that makes "primary" true rather than decorative: a
    // cache-first lookup would let one old Nominatim answer outrank Mapbox for
    // the full ninety days of the TTL.
    h.cacheRows = [{ value: { lat: 1, lng: 1, label: 'stale', source: 'nominatim' } }];
    forwardGeocode.mockResolvedValue([
      { lat: 52.6323, lng: 1.2939, label: 'Norwich Cathedral', name: 'Norwich Cathedral', poiCategories: [], featureType: 'poi', countryCode: 'GB' },
    ]);
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    const hit = await geocodePlace('Norwich Cathedral');
    expect(hit?.source).toBe('mapbox');
    expect(hit?.lat).toBeCloseTo(52.6323);
  });

  it('falls back to Nominatim when Mapbox has no token', async () => {
    forwardGeocode.mockRejectedValue(new MapboxNotConfiguredError('no token'));
    const fetchMock = stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    const hit = await geocodePlace('Norwich Cathedral');

    expect(hit?.source).toBe('nominatim');
    expect(String(fetchMock.mock.calls[0][0])).toContain('nominatim.openstreetmap.org');
  });

  it('does not even attempt Mapbox on an unconfigured host', async () => {
    // The unconfigured state is the normal one until a token is registered.
    // Attempting anyway costs a registry read and a thrown exception per
    // lookup, in front of the path that was going to answer regardless.
    mapboxApiConfigured.mockResolvedValue(false);
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    expect((await geocodePlace('Norwich Cathedral'))?.source).toBe('nominatim');
    expect(forwardGeocode).not.toHaveBeenCalled();
  });

  it('falls back to Nominatim when Mapbox errors, and says so in a log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forwardGeocode.mockRejectedValue(new Error('Mapbox 429: rate limit exceeded'));
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    expect((await geocodePlace('Norwich Cathedral'))?.source).toBe('nominatim');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back when Mapbox simply does not know the place', async () => {
    forwardGeocode.mockResolvedValue([]);
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    expect((await geocodePlace('Norwich Cathedral'))?.source).toBe('nominatim');
  });

  it('serves the cache when Mapbox is unavailable, without calling Nominatim', async () => {
    h.cacheRows = [{ value: { lat: 52.6, lng: 1.29, label: 'cached', source: 'nominatim' } }];
    forwardGeocode.mockRejectedValue(new MapboxNotConfiguredError('no token'));
    const fetchMock = stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    expect((await geocodePlace('Norwich Cathedral'))?.source).toBe('cache');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when both providers fail rather than inventing a coordinate', async () => {
    forwardGeocode.mockResolvedValue([]);
    stubFetch([], false);
    const { geocodePlace } = await loadGeocode();

    expect(await geocodePlace('a place that is not real')).toBeNull();
  });
});

describe('the caching rule', () => {
  it('NEVER writes a Mapbox result to the cache — its terms forbid storing one', async () => {
    forwardGeocode.mockResolvedValue([
      { lat: 52.6323, lng: 1.2939, label: 'Norwich Cathedral', name: 'Norwich Cathedral', poiCategories: [], featureType: 'poi', countryCode: 'GB' },
    ]);
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    await geocodePlace('Norwich Cathedral');

    expect(setSetting).not.toHaveBeenCalled();
  });

  it('does write a Nominatim result, which its policy asks for', async () => {
    forwardGeocode.mockResolvedValue([]);
    stubFetch(nominatimHit());
    const { geocodePlace } = await loadGeocode();

    await geocodePlace('Norwich Cathedral');

    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting.mock.calls[0][1]).toMatchObject({ source: 'nominatim' });
  });
});

describe('geocodePlaces', () => {
  it('resolves a repeated place once', async () => {
    forwardGeocode.mockResolvedValue([
      { lat: 52.6323, lng: 1.2939, label: 'Norwich', name: 'Norwich', poiCategories: [], featureType: 'place', countryCode: 'GB' },
    ]);
    stubFetch(nominatimHit());
    const { geocodePlaces } = await loadGeocode();

    const out = await geocodePlaces(['Norwich', 'norwich ', 'Norwich']);

    expect(out).toHaveLength(3);
    expect(out.every((r) => r.hit?.source === 'mapbox')).toBe(true);
    expect(forwardGeocode).toHaveBeenCalledTimes(1);
  });
});
