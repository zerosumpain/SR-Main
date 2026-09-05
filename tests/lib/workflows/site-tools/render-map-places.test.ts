import { describe, it, expect, vi, beforeEach } from 'vitest';

const geocodePlaces = vi.fn();
const geocodePlace = vi.fn();
vi.mock('$lib/workflows/site-tools/geocode', () => ({ geocodePlaces, geocodePlace }));

const { getTools } = await import('$lib/workflows/site-tools/registry');

function tool(name: string) {
  const t = getTools().find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
}
const runMap = (args: Record<string, unknown>) =>
  tool('render_map').handler(args, {} as never) as Promise<{
    success: boolean;
    error?: string;
    data?: { artifact: { layers: Array<{ points: Array<Record<string, unknown>> }> }; summary: string };
  }>;

beforeEach(() => {
  geocodePlaces.mockReset();
  geocodePlace.mockReset();
});

describe('render_map with place names', () => {
  it('plots a resolved place and never asks the model for coordinates', async () => {
    geocodePlaces.mockResolvedValue([
      { place: 'Norwich Cathedral', hit: { lat: 52.632, lng: 1.3011, label: 'Norwich Cathedral, Norfolk', source: 'nominatim' } },
    ]);
    const r = await runMap({ layers: [{ kind: 'points', points: [{ place: 'Norwich Cathedral' }] }] });
    expect(r.success).toBe(true);
    expect(r.data?.artifact.layers[0].points[0]).toMatchObject({ lat: 52.632, lng: 1.3011 });
    // The matched label becomes the tooltip, so a wrong "Newcastle" is visible.
    expect(r.data?.artifact.layers[0].points[0].label).toContain('Norfolk');
  });

  it("keeps the caller's own label when they gave one", async () => {
    geocodePlaces.mockResolvedValue([
      { place: 'Norwich', hit: { lat: 52.6, lng: 1.3, label: 'Norwich, Norfolk', source: 'nominatim' } },
    ]);
    const r = await runMap({ layers: [{ kind: 'points', points: [{ place: 'Norwich', label: 'Home' }] }] });
    expect(r.data?.artifact.layers[0].points[0].label).toBe('Home');
  });

  it('passes the near hint through, which is what disambiguates a name', async () => {
    geocodePlaces.mockResolvedValue([{ place: 'Snowdon', hit: { lat: 53.07, lng: -4.08, label: 'Yr Wyddfa', source: 'nominatim' } }]);
    await runMap({ layers: [{ kind: 'points', points: [{ place: 'Snowdon' }] }], near: [53, -4] });
    expect(geocodePlaces).toHaveBeenCalledWith(['Snowdon'], { near: [53, -4] });
  });

  it('fails the whole call when a place will not resolve', async () => {
    // A map that quietly omits a point looks complete and is wrong — which is
    // the exact failure the lookup exists to prevent.
    geocodePlaces.mockResolvedValue([
      { place: 'Norwich', hit: { lat: 52.6, lng: 1.3, label: 'Norwich', source: 'nominatim' } },
      { place: 'Atlantis', hit: null },
    ]);
    const r = await runMap({
      layers: [{ kind: 'points', points: [{ place: 'Norwich' }, { place: 'Atlantis' }] }],
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Atlantis');
    expect(r.error).toContain('near');
  });

  it('still takes plain coordinates, and looks nothing up for them', async () => {
    const r = await runMap({ layers: [{ kind: 'track', points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }] });
    expect(r.success).toBe(true);
    expect(geocodePlaces).not.toHaveBeenCalled();
  });

  it('rejects a point carrying neither coordinates nor a name', async () => {
    const r = await runMap({ layers: [{ kind: 'points', points: [{ label: 'mystery' }] }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/place/);
  });
});

describe('geocode_place', () => {
  it('returns the coordinates and the matched label', async () => {
    geocodePlace.mockResolvedValue({ lat: 52.6, lng: 1.3, label: 'Norwich, Norfolk', source: 'nominatim' });
    const r = (await tool('geocode_place').handler({ place: 'Norwich' }, {} as never)) as {
      success: boolean; data?: Record<string, unknown>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ lat: 52.6, lng: 1.3, label: 'Norwich, Norfolk' });
  });

  it('fails loudly rather than returning a guess', async () => {
    geocodePlace.mockResolvedValue(null);
    const r = (await tool('geocode_place').handler({ place: 'Atlantis' }, {} as never)) as {
      success: boolean; error?: string;
    };
    expect(r.success).toBe(false);
    expect(r.error).toContain('Atlantis');
  });
});
