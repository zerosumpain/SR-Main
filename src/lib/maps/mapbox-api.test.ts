import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same mocking shape as the old ors-auth test: `$env/dynamic/private` does not
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
