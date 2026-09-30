import { describe, expect, it } from 'vitest';
import {
  ROUTE_FOLLOW_MAX,
  isRouteId,
  projectDetail,
  projectPlan,
  projectSummary,
  readPlanInput,
  readSaveInput,
  upstreamStatus,
  type UpstreamPlanResult,
  type UpstreamSavedRouteDetail,
} from './native-routes';

// Synthetic coordinates (Central Park) — the repo is public; real routes start at a front door.
const LOOP: [number, number, number | null][] = [
  [-73.968285, 40.785091, 30.04],
  [-73.965, 40.788, 31.2],
  [-73.961, 40.786, null],
  [-73.968285, 40.785091, 30.04],
];

const PLAN: UpstreamPlanResult = {
  routes: [
    {
      rank: 1,
      score: 0.82,
      breakdown: { total: 0.82, distanceScore: 0.9, notes: ['Little doubling back.'], overlap: { share: 0.02 } },
      distanceM: 10012.6,
      durationS: 3070.9,
      ascentM: 84.4,
      descentM: 84.1,
      coordinates: LOOP,
    },
  ],
  targetDistanceM: 10000,
  targetSource: 'requested',
  rationale: ['You asked for 10 km.'],
};

const SAVED: UpstreamSavedRouteDetail = {
  id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  name: 'Reservoir loop',
  sport: 'run',
  source: 'planned',
  distanceM: 10012.6,
  ascentM: 84,
  descentM: 84,
  durationS: 3071,
  score: 0.82,
  bounds: { n: 40.788, s: 40.785, e: -73.961, w: -73.968 },
  createdAt: 1_790_000_000,
  notes: null,
  coordinates: LOOP,
  targetDistanceM: 10000,
  waypoints: [{ id: 'w1', name: 'Water', icon: 'water', lat: 40.786, lng: -73.965, note: null }],
};

describe('a plan, for the phone', () => {
  it('turns every candidate round to [lat, lng, ele] and keeps the scorer’s reasons', () => {
    const plan = projectPlan(PLAN);
    const [c] = plan.candidates;
    expect(c.route[0]).toEqual([40.78509, -73.96828, 30]);
    expect(c.route[2]).toEqual([40.786, -73.961, null]);
    expect(c.notes).toEqual(['Little doubling back.']);
    expect(c.distanceM).toBe(10013);
    expect(c.durationS).toBe(3071);
  });

  it('hands the breakdown back untouched, so a save keeps it', () => {
    expect(projectPlan(PLAN).candidates[0].breakdown).toBe(PLAN.routes[0].breakdown);
  });

  it('keeps a candidate at following precision, not drawing precision', () => {
    const dense = Array.from({ length: ROUTE_FOLLOW_MAX + 500 }, (_, i) => [-73.97 + i * 1e-5, 40.78, null] as [number, number, null]);
    const route = projectPlan({ ...PLAN, routes: [{ ...PLAN.routes[0], coordinates: dense }] }).candidates[0].route;
    expect(route).toHaveLength(ROUTE_FOLLOW_MAX);
    // Both ends survive the thinning: a loop that stops short of its start is not a loop.
    expect(route.at(-1)?.[1]).toBeCloseTo(dense.at(-1)![0], 5);
  });
});

describe('saved routes', () => {
  it('sends ISO time for Health’s epoch seconds', () => {
    expect(projectSummary(SAVED).createdAt).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it('carries the waypoints and the geometry on the detail only', () => {
    const detail = projectDetail(SAVED);
    expect(detail.route).toHaveLength(4);
    expect(detail.waypoints[0].name).toBe('Water');
    expect('route' in projectSummary(SAVED)).toBe(false);
  });

  it('only sends a uuid upstream', () => {
    expect(isRouteId(SAVED.id)).toBe(true);
    expect(isRouteId('../activities')).toBe(false);
  });
});

describe('what the phone sends', () => {
  it('reads a loop request', () => {
    expect(readPlanInput({ startLat: 40.78, startLng: -73.97, sport: 'run', targetDistanceM: 10000 })).toEqual({
      startLat: 40.78,
      startLng: -73.97,
      sport: 'run',
      targetDistanceM: 10000,
    });
  });

  it('refuses a half-set finish rather than planning a loop the owner did not ask for', () => {
    expect(readPlanInput({ startLat: 40.78, startLng: -73.97, sport: 'run', finishLat: 40.8 })).toBeTypeOf('string');
  });

  it('refuses an unknown sport and an absurd distance', () => {
    expect(readPlanInput({ startLat: 1, startLng: 1, sport: 'swim' })).toBe('Pick a sport.');
    expect(readPlanInput({ startLat: 1, startLng: 1, sport: 'run', targetDistanceM: 500_000 })).toBeTypeOf('string');
  });

  it('turns a save back round to Health’s [lng, lat, ele] and rounds the duration Health stores as an integer', () => {
    const payload = readSaveInput({
      name: '  Reservoir loop ',
      sport: 'run',
      route: [
        [40.78, -73.97, 30],
        [40.79, -73.96],
      ],
      durationS: 3070.9,
    });
    expect(payload).toMatchObject({
      name: 'Reservoir loop',
      coordinates: [
        [-73.97, 40.78, 30],
        [-73.96, 40.79, null],
      ],
      durationS: 3071,
      source: 'planned',
    });
  });

  it('refuses a point off the map', () => {
    expect(readSaveInput({ sport: 'run', route: [[40.78, -73.97], [95, 0]] })).toBeTypeOf('string');
  });
});

describe('failures', () => {
  it('reads the status Health answered with', () => {
    expect(upstreamStatus(new Error('health/api/trails/plan returned 429'))).toBe(429);
    expect(upstreamStatus(new Error('socket hang up'))).toBeNull();
  });
});
