import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Mapbox client and the geocoder are both stubbed: what is under test is the
// tool layer — name resolution, mode and cap validation, the shape handed back
// to the model, and the map artifact.
// vi.mock factories are hoisted above every const in this file, so the spies
// they close over have to be created by vi.hoisted or they are still in their
// temporal dead zone when the factory runs.
const { directions, matrix, isochrone, geocodePlace } = vi.hoisted(() => ({
  directions: vi.fn(),
  matrix: vi.fn(),
  isochrone: vi.fn(),
  geocodePlace: vi.fn(),
}));

vi.mock('$lib/maps/mapbox-api', async () => {
  // The real module is kept for its constants — the caps and mode list the
  // tools validate against are part of what is under test, not a fixture.
  const actual = await vi.importActual<typeof import('$lib/maps/mapbox-api')>('$lib/maps/mapbox-api');
  return { ...actual, directions, matrix, isochrone };
});

vi.mock('../geocode', () => ({ geocodePlace, geocodePlaces: vi.fn() }));

import './travel';
import { inferToolsets } from '../keyword-classifier';
import { tools } from '../registry-internal';

function tool(name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`${name} is not registered`);
  return found;
}

function place(lat: number, lng: number, label = 'somewhere') {
  return { lat, lng, label, source: 'mapbox' as const };
}

const straightLine: [number, number][] = Array.from(
  { length: 500 },
  (_, i) => [-1.5 + i * 0.001, 53.4 + i * 0.001] as [number, number],
);

function route(overrides: Record<string, unknown> = {}) {
  return {
    distanceM: 42_000,
    durationS: 2_820,
    durationTypicalS: 2_100,
    coordinates: straightLine,
    weightName: 'auto',
    legs: [
      {
        distanceM: 42_000,
        durationS: 2_820,
        summary: 'A1(M)',
        steps: [
          { instruction: 'Turn left onto High Street', distanceM: 400, durationS: 60, name: 'High Street' },
          { instruction: 'Continue', distanceM: 20, durationS: 5, name: null },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  directions.mockReset();
  matrix.mockReset();
  isochrone.mockReset();
  geocodePlace.mockReset();
  geocodePlace.mockImplementation(async (q: string) => place(53.4, -1.5, `${q}, resolved`));
});

describe('registration', () => {
  it('registers the three travel tools in their own toolset', () => {
    for (const name of ['route_directions', 'travel_time_matrix', 'reachable_area']) {
      expect(tool(name).toolset).toBe('travel');
      expect(tool(name).destructive).toBe(false);
    }
  });

  it('is reachable from ordinary journey language', () => {
    // Without a keyword-classifier row the toolset only loads if the model
    // thinks to call activate_toolset('travel') unprompted.
    expect(inferToolsets('how long does it take to drive to Leeds')).toContain('travel');
    expect(inferToolsets('directions to Norwich Cathedral')).toContain('travel');
    expect(inferToolsets('what is within 30 minutes of home')).toContain('travel');
  });

  it('does not steal a training run from the health planner', () => {
    const matched = inferToolsets('plan me a 10k run from home');
    expect(matched).toContain('health');
    expect(matched).not.toContain('travel');
  });
});

describe('route_directions', () => {
  it('resolves place names and routes between them', async () => {
    directions.mockResolvedValue([route()]);
    const result = await tool('route_directions').handler({
      from: 'Darlington',
      to: 'Norwich Cathedral',
      mode: 'drive',
    });

    expect(result.success).toBe(true);
    expect(geocodePlace).toHaveBeenCalledTimes(2);
    const data = result.data as Record<string, any>;
    expect(data.route.distanceKm).toBe(42);
    expect(data.route.duration).toBe('47 min');
    expect(data.route.typicalDurationMinutes).toBe(35);
    expect(data.route.versusTypical).toMatch(/\+12 min/);
  });

  it('takes a bare "lat,lng" without sending it to the geocoder', async () => {
    directions.mockResolvedValue([route()]);
    await tool('route_directions').handler({ from: '53.4,-1.5', to: '52.63,1.29' });

    expect(geocodePlace).not.toHaveBeenCalled();
    const [[call]] = directions.mock.calls;
    // Our args are lat,lng; Mapbox wants lng,lat.
    expect(call.coordinates).toEqual([[-1.5, 53.4], [1.29, 52.63]]);
  });

  it('fails the whole call when a place will not resolve', async () => {
    // Routing between only the places that DID resolve answers a different
    // question, confidently and without saying so.
    geocodePlace.mockImplementation(async (q: string) => (q === 'Atlantis' ? null : place(53.4, -1.5)));
    const result = await tool('route_directions').handler({ from: 'Darlington', to: 'Atlantis' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Atlantis');
    expect(directions).not.toHaveBeenCalled();
  });

  it('visits `via` stops in the order given', async () => {
    directions.mockResolvedValue([route()]);
    await tool('route_directions').handler({
      from: '1,1',
      via: ['2,2', '3,3'],
      to: '4,4',
      mode: 'cycle',
    });

    const [[call]] = directions.mock.calls;
    expect(call.coordinates).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it('rejects an unknown travel mode', async () => {
    const result = await tool('route_directions').handler({ from: '1,1', to: '2,2', mode: 'teleport' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mode must be one of/);
  });

  it('rejects a lat,lng outside the possible range', async () => {
    const result = await tool('route_directions').handler({ from: '953.4,-1.5', to: '1,1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid lat,lng/);
  });

  it('holds back turn-by-turn steps unless asked', async () => {
    directions.mockResolvedValue([route()]);
    const quiet = await tool('route_directions').handler({ from: '1,1', to: '2,2' });
    expect((quiet.data as any).route.steps).toBeUndefined();

    directions.mockResolvedValue([route()]);
    const loud = await tool('route_directions').handler({ from: '1,1', to: '2,2', steps: true });
    expect((loud.data as any).route.steps[0]).toContain('Turn left onto High Street');
  });

  it('thins the geometry — the whole envelope goes into the model context', async () => {
    directions.mockResolvedValue([route()]);
    const result = await tool('route_directions').handler({ from: '1,1', to: '2,2' });

    const artifact = (result.data as any).artifact;
    expect(artifact.type).toBe('map');
    const track = artifact.layers.find((l: any) => l.kind === 'track');
    expect(straightLine.length).toBe(500);
    expect(track.points.length).toBeLessThanOrEqual(101);
    // A route that visibly stops short of its destination looks like a bug.
    expect(track.points.at(-1)).toEqual({
      lat: Number(straightLine.at(-1)![1].toFixed(5)),
      lng: Number(straightLine.at(-1)![0].toFixed(5)),
    });
  });

  it('labels the map pins with what the user asked for, not the matched address', async () => {
    directions.mockResolvedValue([route()]);
    const result = await tool('route_directions').handler({ from: 'home', to: 'the office' });

    const pins = (result.data as any).artifact.layers.find((l: any) => l.kind === 'points');
    expect(pins.points.map((p: any) => p.label)).toEqual(['home', 'the office']);
    // The matched label is still reported, so a wrong hit is visible.
    expect((result.data as any).waypoints[0].matched).toBe('home, resolved');
  });

  it('omits the map when asked to', async () => {
    directions.mockResolvedValue([route()]);
    const result = await tool('route_directions').handler({ from: '1,1', to: '2,2', showMap: false });
    expect((result.data as any).artifact).toBeUndefined();
  });

  it('surfaces a Mapbox failure as a tool error rather than throwing', async () => {
    directions.mockRejectedValue(new Error('Mapbox 429: rate limit exceeded'));
    const result = await tool('route_directions').handler({ from: '1,1', to: '2,2' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('429');
  });
});

describe('travel_time_matrix', () => {
  it('splits origins from destinations by index', async () => {
    matrix.mockResolvedValue({ durations: [[600, 1200], [900, 300]], distances: null });
    const result = await tool('travel_time_matrix').handler({
      origins: ['home', 'work'],
      destinations: ['pub A', 'pub B'],
      mode: 'walk',
    });

    const [[call]] = matrix.mock.calls;
    expect(call.sources).toEqual([0, 1]);
    expect(call.destinations).toEqual([2, 3]);

    const rows = (result.data as any).rows;
    expect(rows[0].from).toBe('home');
    expect(rows[0].closest).toBe('pub A');
    expect(rows[1].closest).toBe('pub B');
  });

  it('measures everything against everything when no destinations are given', async () => {
    matrix.mockResolvedValue({ durations: [[0, 600], [600, 0]], distances: null });
    await tool('travel_time_matrix').handler({ origins: ['home', 'work'] });

    const [[call]] = matrix.mock.calls;
    expect(call.sources).toBeUndefined();
    expect(call.destinations).toBeUndefined();
  });

  it('reports an unreachable cell as null rather than picking it as closest', async () => {
    matrix.mockResolvedValue({ durations: [[null, 900]], distances: null });
    const result = await tool('travel_time_matrix').handler({
      origins: ['home'],
      destinations: ['an island', 'the pub'],
    });

    const row = (result.data as any).rows[0];
    expect(row.to[0].minutes).toBeNull();
    expect(row.closest).toBe('the pub');
    expect((result.data as any).unreachable).toBe(true);
  });

  it('explains the tighter traffic cap instead of letting Mapbox 422', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `place ${i}`);
    const result = await tool('travel_time_matrix').handler({ origins: eleven, mode: 'drive' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/allows 10 points/);
    expect(result.error).toMatch(/drive_free_flow/);
    expect(matrix).not.toHaveBeenCalled();
  });
});

describe('reachable_area', () => {
  const ring: [number, number][] = Array.from(
    { length: 400 },
    (_, i) => [-1.5 + Math.cos(i) * 0.02, 53.4 + Math.sin(i) * 0.02] as [number, number],
  );

  it('returns a band per contour with an area, and draws them', async () => {
    isochrone.mockResolvedValue([
      { value: 15, unit: 'minutes', polygon: ring, areaKm2: 4.2 },
      { value: 30, unit: 'minutes', polygon: ring, areaKm2: 16.8 },
    ]);
    const result = await tool('reachable_area').handler({
      place: 'Darlington',
      minutes: [15, 30],
      mode: 'walk',
    });

    expect((result.data as any).bands).toEqual([
      { minutes: 15, areaKm2: 4 },
      { minutes: 30, areaKm2: 17 },
    ]);
    const layers = (result.data as any).artifact.layers;
    // Largest first, so the smaller band stays visible on top of it.
    expect(layers[0].points.length).toBeLessThanOrEqual(121);
    expect(layers.at(-1).kind).toBe('points');
  });

  it('rejects minutes outside the range Mapbox accepts, naming them', async () => {
    const result = await tool('reachable_area').handler({ place: 'home', minutes: [0, 999] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/between 1 and 60/);
    expect(result.error).toContain('999');
    expect(isochrone).not.toHaveBeenCalled();
  });

  it('refuses a fifth band rather than silently dropping the largest', async () => {
    // The client keeps the four SMALLEST after sorting, so 15/30/45/60/90 would
    // have come back as four bands with 90 quietly gone and the reply reading
    // like a complete answer.
    const result = await tool('reachable_area').handler({
      place: 'home',
      minutes: [15, 30, 45, 60, 55],
      mode: 'drive',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('got 5');
    expect(isochrone).not.toHaveBeenCalled();
  });

  it('fails when the centre will not resolve', async () => {
    geocodePlace.mockResolvedValue(null);
    const result = await tool('reachable_area').handler({ place: 'Atlantis', minutes: [15] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Atlantis');
  });
});
