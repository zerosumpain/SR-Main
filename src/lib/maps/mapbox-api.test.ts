import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same mocking shape as ors-auth.test.ts: `$env/dynamic/private` does not
// resolve outside a SvelteKit build, and the secret registry drags in the
// database. Both are stubbed so the resolution ORDER and the composed URLs can
// be asserted without either.
const envMock: { env: Record<string, string | undefined> } = { env: {} };
vi.mock('$env/dynamic/private', () => envMock);

const resolveSecretForUrl = vi.fn();
const getSecretMeta = vi.fn();
vi.mock('$lib/secrets/registry', () => ({ resolveSecretForUrl, getSecretMeta }));

async function loadMapbox() {
  vi.resetModules();
  return import('./mapbox-api');
}

/** Every call goes out as a GET, so one fetch stub serves the whole file. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URL the last stubbed fetch was called with. */
function calledUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  return new URL(String(fetchMock.mock.calls[0][0]));
}

function withToken(token = 'pk.test-token') {
  resolveSecretForUrl.mockResolvedValue({
    handle: 'mapbox-api',
    headers: {},
    query: { access_token: token },
    plaintexts: [token],
  });
}

beforeEach(() => {
  envMock.env = {};
  resolveSecretForUrl.mockReset();
  getSecretMeta.mockReset();
});

/** `mapboxApiConfigured` memoises a miss for a minute; clear it between cases. */
async function freshConfigured() {
  const mod = await loadMapbox();
  mod.resetMapboxConfiguredCache();
  return mod;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('token resolution', () => {
  it('prefers the registry over the env var', async () => {
    envMock.env = { MAPBOX_API_TOKEN: 'from-env' };
    withToken('from-registry');
    const fetchMock = stubFetch({ features: [] });
    const { forwardGeocode } = await loadMapbox();

    await forwardGeocode('Norwich');

    expect(calledUrl(fetchMock).searchParams.get('access_token')).toBe('from-registry');
  });

  it('falls back to the env var when nothing is registered', async () => {
    envMock.env = { MAPBOX_API_TOKEN: 'from-env' };
    resolveSecretForUrl.mockRejectedValue(new Error('no secret registered under the handle "mapbox-api"'));
    const fetchMock = stubFetch({ features: [] });
    const { forwardGeocode } = await loadMapbox();

    await forwardGeocode('Norwich');

    expect(calledUrl(fetchMock).searchParams.get('access_token')).toBe('from-env');
  });

  it('surfaces a mis-bound credential instead of reporting it as unconfigured', async () => {
    // The distinction that matters: "not set up" sends you to the token page,
    // "bound to the wrong host" sends you to the binding. Reporting the first
    // when it is the second is the whole reason this branch exists.
    envMock.env = { MAPBOX_API_TOKEN: 'from-env' };
    resolveSecretForUrl.mockRejectedValue(
      new Error('secret "mapbox-api" is bound to example.com and will not be sent to api.mapbox.com'),
    );
    stubFetch({ features: [] });
    const { forwardGeocode, MapboxApiError, MapboxNotConfiguredError } = await loadMapbox();

    const err = await forwardGeocode('Norwich').catch((e) => e);
    expect(err).toBeInstanceOf(MapboxApiError);
    expect(err).not.toBeInstanceOf(MapboxNotConfiguredError);
    expect(String(err.message)).toMatch(/bound to example\.com/);
  });

  it('throws MapboxNotConfiguredError with neither, so a caller can fall back', async () => {
    resolveSecretForUrl.mockRejectedValue(new Error('no secret registered under the handle "mapbox-api"'));
    const { forwardGeocode, MapboxNotConfiguredError } = await loadMapbox();

    await expect(forwardGeocode('Norwich')).rejects.toBeInstanceOf(MapboxNotConfiguredError);
  });

  it('never puts the token in the URL it hands the registry to bind-check', async () => {
    withToken();
    stubFetch({ features: [] });
    const { forwardGeocode } = await loadMapbox();

    await forwardGeocode('Norwich');

    const [, boundUrl] = resolveSecretForUrl.mock.calls[0];
    expect(String(boundUrl)).not.toContain('access_token');
    expect(String(boundUrl)).toContain('api.mapbox.com/search/searchbox/v1/forward');
  });

  it('scrubs the token out of an error body', async () => {
    withToken('pk.secret-value');
    stubFetch({}, { ok: false, status: 401, text: 'Not Authorized: pk.secret-value is invalid' });
    const { forwardGeocode } = await loadMapbox();

    const err = await forwardGeocode('Norwich').catch((e) => e);
    expect(err.message).not.toContain('pk.secret-value');
    expect(err.message).toContain('[redacted]');
  });
});

describe('mapboxApiConfigured', () => {
  it('is true when the registry holds an available secret', async () => {
    getSecretMeta.mockResolvedValue({ handle: 'mapbox-api', available: true });
    const { mapboxApiConfigured } = await freshConfigured();
    expect(await mapboxApiConfigured()).toBe(true);
  });

  it('is false when the registry is absent entirely', async () => {
    getSecretMeta.mockRejectedValue(new Error('registry disabled on this host'));
    const { mapboxApiConfigured } = await freshConfigured();
    expect(await mapboxApiConfigured()).toBe(false);
  });

  it('is true from the env fallback alone', async () => {
    envMock.env = { MAPBOX_API_TOKEN: 'k' };
    const { mapboxApiConfigured } = await freshConfigured();
    expect(await mapboxApiConfigured()).toBe(true);
  });

  it('memoises a MISS, so an unconfigured host does not re-query per lookup', async () => {
    // The unconfigured state is the normal one until a token is registered, and
    // a twelve-place map would otherwise cost twelve registry reads in front of
    // the Nominatim path that was going to answer anyway.
    getSecretMeta.mockResolvedValue({ handle: 'mapbox-api', available: false });
    const { mapboxApiConfigured } = await freshConfigured();

    expect(await mapboxApiConfigured()).toBe(false);
    expect(await mapboxApiConfigured()).toBe(false);
    expect(await mapboxApiConfigured()).toBe(false);
    expect(getSecretMeta).toHaveBeenCalledTimes(1);
  });

  it('does NOT memoise a hit, so a revoked token is noticed', async () => {
    getSecretMeta.mockResolvedValue({ handle: 'mapbox-api', available: true });
    const { mapboxApiConfigured } = await freshConfigured();

    await mapboxApiConfigured();
    await mapboxApiConfigured();
    expect(getSecretMeta).toHaveBeenCalledTimes(2);
  });
});

describe('forwardGeocode', () => {
  const poi = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [1.2939, 52.6323] },
    properties: {
      name: 'Norwich Cathedral',
      full_address: 'Norwich Cathedral, 65 The Close, Norwich, NR1 4DH, United Kingdom',
      place_formatted: 'Norwich, NR1 4DH, United Kingdom',
      feature_type: 'poi',
      poi_category: ['historic site', 'church'],
      coordinates: { longitude: 1.2939, latitude: 52.6323 },
      context: { country: { country_code: 'gb' } },
    },
  };

  it('goes to Search Box, not the Geocoding API — v6 has no POIs', async () => {
    // The single most load-bearing assertion in this file. Nearly everything
    // jkai geocodes is a POI; on /search/geocode/v6 they all resolve to nothing
    // and silently fall through to Nominatim on every call.
    withToken();
    const fetchMock = stubFetch({ features: [poi] });
    const { forwardGeocode } = await loadMapbox();

    await forwardGeocode('Norwich Cathedral');

    expect(calledUrl(fetchMock).pathname).toBe('/search/searchbox/v1/forward');
  });

  it('parses a POI into coordinates, a label and its own name', async () => {
    withToken();
    stubFetch({ features: [poi] });
    const { forwardGeocode } = await loadMapbox();

    const [hit] = await forwardGeocode('Norwich Cathedral');

    expect(hit.lat).toBeCloseTo(52.6323);
    expect(hit.lng).toBeCloseTo(1.2939);
    expect(hit.name).toBe('Norwich Cathedral');
    expect(hit.label).toMatch(/^Norwich Cathedral, 65 The Close/);
    expect(hit.featureType).toBe('poi');
    expect(hit.poiCategories).toEqual(['historic site', 'church']);
    expect(hit.countryCode).toBe('GB');
  });

  it('sends `near` as proximity in lng,lat order', async () => {
    // Our callers speak [lat, lng] throughout; Mapbox wants lng,lat. Getting
    // this backwards biases toward the sea off Somalia and is invisible.
    withToken();
    const fetchMock = stubFetch({ features: [poi] });
    const { forwardGeocode } = await loadMapbox();

    await forwardGeocode('the station', { near: [52.63, 1.29] });

    expect(calledUrl(fetchMock).searchParams.get('proximity')).toBe('1.29,52.63');
  });

  it('returns nothing for a query too short to mean anything', async () => {
    withToken();
    const fetchMock = stubFetch({ features: [poi] });
    const { forwardGeocode } = await loadMapbox();

    expect(await forwardGeocode(' a ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops a feature with no usable coordinates rather than plotting 0,0', async () => {
    withToken();
    stubFetch({ features: [{ properties: { name: 'nowhere' } }, poi] });
    const { forwardGeocode } = await loadMapbox();

    const hits = await forwardGeocode('Norwich Cathedral', { limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Norwich Cathedral');
  });

  it('marks a 429 retryable so a caller knows the fallback is worth trying', async () => {
    withToken();
    stubFetch({}, { ok: false, status: 429, text: 'rate limit exceeded' });
    const { forwardGeocode } = await loadMapbox();

    const err = await forwardGeocode('Norwich').catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
  });
});

describe('reverseGeocode', () => {
  it('asks Search Box reverse with longitude and latitude as named params', async () => {
    withToken();
    const fetchMock = stubFetch({
      features: [
        {
          properties: {
            name: 'Costa Coffee',
            full_address: 'Costa Coffee, 5 High Street, Darlington, DL1 1AB',
            poi_category: ['coffee shop', 'cafe'],
            coordinates: { longitude: -1.5533, latitude: 54.5253 },
          },
        },
      ],
    });
    const { reverseGeocode } = await loadMapbox();

    const hit = await reverseGeocode(54.5253, -1.5533);

    const url = calledUrl(fetchMock);
    expect(url.pathname).toBe('/search/searchbox/v1/reverse');
    expect(url.searchParams.get('latitude')).toBe('54.5253');
    expect(url.searchParams.get('longitude')).toBe('-1.5533');
    expect(hit?.name).toBe('Costa Coffee');
    expect(hit?.poiCategories).toContain('cafe');
  });

  it('returns null for a nonsense coordinate without calling out', async () => {
    withToken();
    const fetchMock = stubFetch({ features: [] });
    const { reverseGeocode } = await loadMapbox();

    expect(await reverseGeocode(Number.NaN, 0)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('directions', () => {
  const route = {
    distance: 42_000,
    duration: 2_820,
    duration_typical: 2_100,
    weight_name: 'auto',
    geometry: { coordinates: [[-1.5, 53.4], [-1.48, 53.38], [-1.47, 53.37]] },
    legs: [
      {
        distance: 42_000,
        duration: 2_820,
        summary: 'A1(M)',
        steps: [{ distance: 400, duration: 60, name: 'High Street', maneuver: { instruction: 'Turn left' } }],
      },
    ],
  };

  it('uses the traffic profile for `drive`', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({ mode: 'drive', coordinates: [[-1.5, 53.4], [-1.47, 53.37]] });

    expect(calledUrl(fetchMock).pathname).toContain('/directions/v5/mapbox/driving-traffic/');
  });

  it('uses the plain driving profile for `drive_free_flow`', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({ mode: 'drive_free_flow', coordinates: [[-1.5, 53.4], [-1.47, 53.37]] });

    const path = calledUrl(fetchMock).pathname;
    expect(path).toContain('/directions/v5/mapbox/driving/');
    expect(path).not.toContain('driving-traffic');
  });

  it('puts coordinates in the path as lng,lat pairs joined by semicolons', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({
      mode: 'walk',
      coordinates: [[-1.5, 53.4], [-1.49, 53.39], [-1.47, 53.37]],
    });

    expect(decodeURIComponent(calledUrl(fetchMock).pathname)).toContain(
      '-1.5,53.4;-1.49,53.39;-1.47,53.37',
    );
  });

  it('carries the traffic delta through, which is the point of the drive profile', async () => {
    withToken();
    stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    const [best] = await directions({ mode: 'drive', coordinates: [[-1.5, 53.4], [-1.47, 53.37]] });

    expect(best.durationS).toBe(2_820);
    expect(best.durationTypicalS).toBe(2_100);
    expect(best.legs[0].steps[0].instruction).toBe('Turn left');
  });

  it('refuses a single waypoint rather than asking Mapbox to route from nowhere', async () => {
    withToken();
    stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await expect(directions({ mode: 'walk', coordinates: [[-1.5, 53.4]] })).rejects.toThrow(
      /at least two waypoints/,
    );
  });

  it('enforces the tighter 10-waypoint cap on the traffic profile', async () => {
    // driving-traffic allows 10 where the others allow 25. Sending 12 gets a
    // 422 whose message says nothing about waypoints.
    withToken();
    stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();
    const twelve = Array.from({ length: 12 }, (_, i) => [-1.5 + i * 0.01, 53.4] as [number, number]);

    await expect(directions({ mode: 'drive', coordinates: twelve })).rejects.toThrow(/allows 10 waypoints/);
    await expect(directions({ mode: 'cycle', coordinates: twelve })).resolves.toBeTruthy();
  });

  it('reports a non-Ok response code rather than returning an empty route', async () => {
    withToken();
    stubFetch({ code: 'NoRoute', message: 'no route found' });
    const { directions } = await loadMapbox();

    await expect(
      directions({ mode: 'drive', coordinates: [[-1.5, 53.4], [-1.47, 53.37]] }),
    ).rejects.toThrow(/NoRoute/);
  });
});

describe('isochrone', () => {
  const contour = (minutes: number) => ({
    properties: { contour: minutes },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-1.51, 53.41], [-1.49, 53.41], [-1.49, 53.39], [-1.51, 53.39], [-1.51, 53.41]]],
    },
  });

  it('sends ascending contour minutes, which Mapbox requires', async () => {
    withToken();
    const fetchMock = stubFetch({ features: [contour(30), contour(15)] });
    const { isochrone } = await loadMapbox();

    await isochrone({ mode: 'walk', centre: [-1.5, 53.4], contours: [30, 15] });

    expect(calledUrl(fetchMock).searchParams.get('contours_minutes')).toBe('15,30');
  });

  it('caps at four contours and drops values outside the allowed range', async () => {
    withToken();
    const fetchMock = stubFetch({ features: [contour(5)] });
    const { isochrone } = await loadMapbox();

    await isochrone({ mode: 'drive', centre: [-1.5, 53.4], contours: [5, 10, 15, 20, 25, 90, 0] });

    expect(calledUrl(fetchMock).searchParams.get('contours_minutes')).toBe('5,10,15,20');
  });

  it('rejects a request with no usable contour rather than sending an empty one', async () => {
    withToken();
    stubFetch({ features: [] });
    const { isochrone } = await loadMapbox();

    await expect(
      isochrone({ mode: 'walk', centre: [-1.5, 53.4], contours: [0, 999] }),
    ).rejects.toThrow(/contours must hold/);
  });

  it('returns bands smallest-first with a plausible area', async () => {
    withToken();
    stubFetch({ features: [contour(30), contour(15)] });
    const { isochrone } = await loadMapbox();

    const bands = await isochrone({ mode: 'walk', centre: [-1.5, 53.4], contours: [15, 30] });

    expect(bands.map((b) => b.value)).toEqual([15, 30]);
    // The stub ring is 0.02° × 0.02°, about 1.3 km × 2.2 km at this latitude.
    expect(bands[0].areaKm2).toBeGreaterThan(1);
    expect(bands[0].areaKm2).toBeLessThan(10);
  });
});

describe('matrix', () => {
  it('passes source and destination indices through', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', durations: [[0, 600], [600, 0]] });
    const { matrix } = await loadMapbox();

    await matrix({
      mode: 'cycle',
      coordinates: [[-1.5, 53.4], [-1.47, 53.37], [-1.4, 53.3]],
      sources: [0],
      destinations: [1, 2],
    });

    const url = calledUrl(fetchMock);
    expect(url.pathname).toContain('/directions-matrix/v1/mapbox/cycling/');
    expect(url.searchParams.get('sources')).toBe('0');
    expect(url.searchParams.get('destinations')).toBe('1;2');
    expect(url.searchParams.get('annotations')).toBe('duration');
  });

  it('asks for distance only when the caller wants it', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', durations: [[0]], distances: [[0]] });
    const { matrix } = await loadMapbox();

    await matrix({
      mode: 'walk',
      coordinates: [[-1.5, 53.4], [-1.47, 53.37]],
      includeDistance: true,
    });

    expect(calledUrl(fetchMock).searchParams.get('annotations')).toBe('duration,distance');
  });

  it('preserves a null cell — unreachable is an answer, not a zero', async () => {
    withToken();
    stubFetch({ code: 'Ok', durations: [[0, null]] });
    const { matrix } = await loadMapbox();

    const result = await matrix({ mode: 'drive', coordinates: [[-1.5, 53.4], [-1.47, 53.37]] });
    expect(result.durations[0][1]).toBeNull();
  });
});

describe('parameters a profile will not accept', () => {
  const route = {
    distance: 1_000,
    duration: 600,
    geometry: { coordinates: [[-1.5, 53.4], [-1.49, 53.39]] },
    legs: [],
  };

  it('drops motorway/toll exclusions on foot rather than letting Mapbox 422', async () => {
    // "a 20-minute walk avoiding unpaved paths" is a reasonable thing to ask and
    // an error from Mapbox is a useless answer to it.
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({
      mode: 'walk',
      coordinates: [[-1.5, 53.4], [-1.49, 53.39]],
      exclude: ['motorway', 'toll', 'unpaved', 'ferry'],
    });

    expect(calledUrl(fetchMock).searchParams.get('exclude')).toBe('ferry');
  });

  it('keeps every driving exclusion', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({
      mode: 'drive',
      coordinates: [[-1.5, 53.4], [-1.49, 53.39]],
      exclude: ['motorway', 'toll'],
    });

    expect(calledUrl(fetchMock).searchParams.get('exclude')).toBe('motorway,toll');
  });

  it('omits depart_at on a profile with no traffic model', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({
      mode: 'cycle',
      coordinates: [[-1.5, 53.4], [-1.49, 53.39]],
      departAt: '2026-09-08T08:30',
    });

    expect(calledUrl(fetchMock).searchParams.get('depart_at')).toBeNull();
  });

  it('keeps depart_at for driving', async () => {
    withToken();
    const fetchMock = stubFetch({ code: 'Ok', routes: [route] });
    const { directions } = await loadMapbox();

    await directions({
      mode: 'drive',
      coordinates: [[-1.5, 53.4], [-1.49, 53.39]],
      departAt: '2026-09-08T08:30',
    });

    expect(calledUrl(fetchMock).searchParams.get('depart_at')).toBe('2026-09-08T08:30');
  });

  it('refuses distances on the traffic matrix, naming the profile that has them', async () => {
    // Mapbox rejects the whole request rather than returning durations alone,
    // and `drive` is the default — so this is the first thing anyone hits who
    // ticks "also return road distance".
    withToken();
    stubFetch({ code: 'Ok', durations: [[0]] });
    const { matrix } = await loadMapbox();

    await expect(
      matrix({
        mode: 'drive',
        coordinates: [[-1.5, 53.4], [-1.49, 53.39]],
        includeDistance: true,
      }),
    ).rejects.toThrow(/drive_free_flow/);
  });
});

describe('the request timeout', () => {
  it('survives a caller-supplied signal instead of being replaced by it', async () => {
    withToken();
    const fetchMock = stubFetch({ features: [] });
    const { forwardGeocode } = await loadMapbox();

    const controller = new AbortController();
    await forwardGeocode('Norwich', { signal: controller.signal });

    const passed = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed).not.toBe(controller.signal);
    // Still live: composing must not abort the request before it is sent.
    expect(passed.aborted).toBe(false);
  });
});
