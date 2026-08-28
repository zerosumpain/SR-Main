import { describe, it, expect, vi, beforeEach } from 'vitest';

// $env/dynamic/private is not resolvable outside a SvelteKit build, and the
// secret registry drags in the database — both are mocked so the resolution
// ORDER (registry first, env fallback, mis-binding surfaced) can be asserted
// without either.
const envMock: { env: Record<string, string | undefined> } = { env: {} };
vi.mock('$env/dynamic/private', () => envMock);

const resolveSecretForUrl = vi.fn();
const getSecretMeta = vi.fn();
vi.mock('$lib/secrets/registry', () => ({ resolveSecretForUrl, getSecretMeta }));

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/foot-hiking/geojson';

async function loadOrs() {
  vi.resetModules();
  return import('./ors');
}

beforeEach(() => {
  envMock.env = {};
  resolveSecretForUrl.mockReset();
  getSecretMeta.mockReset();
});

describe('orsConfigured', () => {
  it('is true when the registry holds an available secret', async () => {
    getSecretMeta.mockResolvedValue({ handle: 'openrouteservice', available: true });
    const { orsConfigured } = await loadOrs();
    expect(await orsConfigured()).toBe(true);
  });

  it('is false when the registered secret cannot be resolved on this host', async () => {
    getSecretMeta.mockResolvedValue({ handle: 'openrouteservice', available: false });
    const { orsConfigured } = await loadOrs();
    expect(await orsConfigured()).toBe(false);
  });

  it('is true from the env fallback alone', async () => {
    envMock.env = { ORS_API_KEY: 'k' };
    const { orsConfigured } = await loadOrs();
    expect(await orsConfigured()).toBe(true);
  });

  it('is false with neither, and does not throw when the registry is absent', async () => {
    getSecretMeta.mockRejectedValue(new Error('registry disabled on this host'));
    const { orsConfigured } = await loadOrs();
    expect(await orsConfigured()).toBe(false);
  });
});

describe('credential resolution order', () => {
  it('prefers the registry over the env var', async () => {
    envMock.env = { ORS_API_KEY: 'from-env' };
    resolveSecretForUrl.mockResolvedValue({
      handle: 'openrouteservice',
      headers: { Authorization: 'from-registry' },
      query: {},
      plaintexts: ['from-registry'],
    });

    const { roundTrip } = await loadOrs();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ features: [{ geometry: { coordinates: [[0, 0]] }, properties: {} }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await roundTrip({ profile: 'foot-hiking', start: [-1.5, 53.4], lengthM: 5000, seed: 1 });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('from-registry');
    // The binding is checked against the exact request URL and method, so both
    // must be passed through — a GET-only secret must not authenticate a POST.
    expect(resolveSecretForUrl).toHaveBeenCalledWith('openrouteservice', ORS_URL, 'POST');
    vi.unstubAllGlobals();
  });

  it('falls back to the env var when nothing is registered', async () => {
    envMock.env = { ORS_API_KEY: 'from-env' };
    resolveSecretForUrl.mockRejectedValue(
      new Error('no secret registered under the handle "openrouteservice"'),
    );

    const { roundTrip } = await loadOrs();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ features: [{ geometry: { coordinates: [[0, 0]] }, properties: {} }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await roundTrip({ profile: 'foot-hiking', start: [-1.5, 53.4], lengthM: 5000, seed: 1 });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('from-env');
    vi.unstubAllGlobals();
  });

  it('surfaces a mis-binding instead of reporting "no key"', async () => {
    // The trap this guards: an empty allowedMethods list means read-only, and
    // directions is a POST. Saying "no key configured" would send you looking
    // for a key that is already there.
    envMock.env = { ORS_API_KEY: 'from-env' };
    resolveSecretForUrl.mockRejectedValue(
      new Error('secret "openrouteservice" does not permit method POST'),
    );

    const { roundTrip } = await loadOrs();
    await expect(
      roundTrip({ profile: 'foot-hiking', start: [-1.5, 53.4], lengthM: 5000, seed: 1 }),
    ).rejects.toThrow(/does not permit method POST/);
  });

  it('explains where to put the key when there is none at all', async () => {
    resolveSecretForUrl.mockRejectedValue(
      new Error('no secret registered under the handle "openrouteservice"'),
    );

    const { roundTrip } = await loadOrs();
    await expect(
      roundTrip({ profile: 'foot-hiking', start: [-1.5, 53.4], lengthM: 5000, seed: 1 }),
    ).rejects.toThrow(/\/admin\/ai\/apis/);
  });
});
