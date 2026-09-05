import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The cache is a DB read; stub it empty so each test exercises the lookup path.
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));
vi.mock('$lib/db/schema', () => ({ appSettings: { key: 'key', value: 'value', updatedAt: 'updated_at' } }));
vi.mock('$lib/server/models/settings', () => ({ setSetting: async () => {} }));

const { geocodePlace, geocodePlaces } = await import('$lib/workflows/site-tools/geocode');

function reply(rows: unknown) {
  return { ok: true, json: async () => rows } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('geocodePlace', () => {
  it('resolves a name to coordinates and keeps the matched label', async () => {
    fetchMock.mockResolvedValue(
      reply([{ lat: '52.6320', lon: '1.3011', display_name: 'Norwich Cathedral, Norfolk' }]),
    );
    const hit = await geocodePlace('Norwich Cathedral');
    expect(hit).toMatchObject({ lat: 52.632, lng: 1.3011, source: 'nominatim' });
    // The label is what makes a wrong hit visible instead of silent.
    expect(hit?.label).toContain('Norwich Cathedral');
  });

  it('identifies itself, as Nominatim policy requires', async () => {
    fetchMock.mockResolvedValue(reply([{ lat: '1', lon: '2' }]));
    await geocodePlace('somewhere');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/strangeramblings\.com/);
  });

  it('sends a viewbox when given a focus, so an ambiguous name lands right', async () => {
    fetchMock.mockResolvedValue(reply([{ lat: '53.07', lon: '-4.08' }]));
    await geocodePlace('Snowdon', { near: [53, -4] });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('viewbox=');
    // Unbounded: a correct answer outside the box still beats no answer.
    expect(url).toContain('bounded=0');
  });

  it('returns null rather than inventing a coordinate', async () => {
    fetchMock.mockResolvedValue(reply([]));
    expect(await geocodePlace('nowhere at all')).toBeNull();

    fetchMock.mockResolvedValue({ ok: false } as unknown as Response);
    expect(await geocodePlace('anything')).toBeNull();

    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await geocodePlace('anything')).toBeNull();
  });

  it('refuses a query too short to mean anything', async () => {
    expect(await geocodePlace('')).toBeNull();
    expect(await geocodePlace(' a ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('geocodePlaces', () => {
  it('looks a repeated place up once', async () => {
    fetchMock.mockResolvedValue(reply([{ lat: '52.6', lon: '1.3', display_name: 'Norwich' }]));
    const out = await geocodePlaces(['Norwich', 'norwich ', 'Norwich']);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.hit?.lat === 52.6)).toBe(true);
    // Three points, one request — the policy is one per second, so this matters.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a miss per point instead of dropping it', async () => {
    fetchMock
      .mockResolvedValueOnce(reply([{ lat: '52.6', lon: '1.3' }]))
      .mockResolvedValueOnce(reply([]));
    const out = await geocodePlaces(['Norwich', 'Atlantis']);
    expect(out[0].hit).not.toBeNull();
    expect(out[1]).toEqual({ place: 'Atlantis', hit: null });
  });
});
