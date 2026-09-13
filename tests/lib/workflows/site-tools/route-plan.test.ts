import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(),
  postToExtracted: vi.fn(),
  ExtractedAppError: class ExtractedAppError extends Error {},
}));

import { getFromExtracted, postToExtracted } from '$lib/server/extracted-app';
import { ORS_PROFILES, ORS_ROUND_TRIP_MAX_M } from '$lib/constants/planner-sports';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { getTool } from '$lib/workflows/site-tools/registry';

const mockedPost = vi.mocked(postToExtracted);
const mockedGet = vi.mocked(getFromExtracted);

/** A planner response shaped the way SR-Health returns one. */
const route = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  score: 0.82,
  distanceM: 10_400,
  durationS: 3_300,
  ascentM: 142.6,
  breakdown: {
    profile: { gainPerKm: 13.7 },
    overlap: { ratio: 0.08 },
    spurs: { spurs: [{}], longestM: 210.4 },
    terrain: { offRoadShare: 0.42 },
    notes: ['rolling'],
  },
  ...over,
});

const response = (over: Record<string, unknown> = {}) => ({
  routes: [route()],
  targetDistanceM: 10_000,
  targetSource: 'history',
  rationale: 'recent long runs average 10km',
  attempted: 5,
  failures: [],
  gpx: '<gpx/>',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('route_plan', () => {
  it('builds its sport enum from the file SR-Health shares, not from its own list', () => {
    // The schema is read when the registry LOADS, which cannot wait on another
    // process — so the sport list is a shared constant rather than something
    // fetched. If these drift, the model is offered a sport Health rejects and
    // the 400 reads to it as a broken route service.
    const tool = getTool('route_plan');
    const sport = (tool!.parameters as { properties: Record<string, { enum?: string[] }> })
      .properties.sport;
    expect(sport.enum).toEqual(Object.keys(ORS_PROFILES));
    expect(JSON.stringify(tool!.parameters)).toContain(String(ORS_ROUND_TRIP_MAX_M / 1000));
  });

  it('asks Health to plan, and to make the GPX where the coordinates are', async () => {
    mockedPost.mockResolvedValue(response() as never);

    const result = await executeSiteTool('route_plan', {
      startLat: 54.5, startLng: -1.55, sport: 'run', targetDistanceKm: 10,
    });

    expect(mockedPost).toHaveBeenCalledOnce();
    const [app, path, body, options] = mockedPost.mock.calls[0] as [string, string, Record<string, unknown>, { timeoutMs: number }];
    expect(app).toBe('health');
    expect(path).toBe('/api/trails/plan');
    expect(body.sport).toBe('run');
    expect(body.targetDistanceM).toBe(10_000);
    expect(body.includeGpx).toBe(true);
    // The default 4s would fail a real plan: this fans out to openrouteservice
    // for several candidates and then scores them.
    expect(options.timeoutMs).toBeGreaterThanOrEqual(30_000);

    expect(result).toMatchObject({ success: true });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.gpx).toBe('<gpx/>');
    expect((data.routes as unknown[])[0]).toMatchObject({
      distanceKm: 10.4, durationMin: 55, ascentM: 143, climbPerKm: 14,
      retracedPercent: 8, outAndBackSections: 1, longestSpurM: 210, offRoadPercent: 42,
    });
  });

  it('never puts geometry in the transcript', async () => {
    // The full coordinate array is tens of thousands of numbers. It is useless
    // to a model and expensive in context; geometry travels as GPX only.
    mockedPost.mockResolvedValue(
      response({ routes: [route({ coordinates: [[1, 2], [3, 4]] })] }) as never,
    );
    const result = await executeSiteTool('route_plan', { startLat: 1, startLng: 2, sport: 'run' });
    expect(JSON.stringify(result)).not.toContain('coordinates');
  });

  it('fails loudly if the planner response changes shape, rather than reporting NaN', async () => {
    // This tool reads named fields out of another repository's JSON. A rename
    // there would otherwise arrive as undefined, Math.round(undefined) is NaN,
    // and a route summary full of NaN would be reported as a success.
    mockedPost.mockResolvedValue(
      response({ routes: [route({ breakdown: { ...route().breakdown, profile: { gainPerKmX: 13.7 } } })] }) as never,
    );
    const result = await executeSiteTool('route_plan', { startLat: 1, startLng: 2, sport: 'run' });
    expect(result).toMatchObject({ success: false });
    expect((result as { error: string }).error).toMatch(/gainPerKm|response shape has changed/);
  });

  it('rejects a sport the planner does not accept, without calling it', async () => {
    const result = await executeSiteTool('route_plan', { startLat: 1, startLng: 2, sport: 'kayak' });
    expect(result).toMatchObject({ success: false });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('reports no routes as a failure rather than an empty success', async () => {
    mockedPost.mockResolvedValue(response({ routes: [] }) as never);
    const result = await executeSiteTool('route_plan', { startLat: 1, startLng: 2, sport: 'run' });
    expect(result).toMatchObject({ success: false });
  });
});

describe('route_target_suggest', () => {
  it('asks Health for the suggestion by sport', async () => {
    mockedGet.mockResolvedValue({ distanceM: 12_300, source: 'acwr', rationale: 'load is low' } as never);

    const result = await executeSiteTool('route_target_suggest', { sport: 'ride' });

    expect(mockedGet).toHaveBeenCalledWith('health', '/api/trails/plan?sport=ride', expect.anything());
    expect(result).toEqual({
      success: true,
      data: { distanceKm: 12.3, source: 'acwr', rationale: 'load is low' },
    });
  });
});
