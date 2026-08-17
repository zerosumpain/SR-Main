import { describe, it, expect } from 'vitest';
import { latLngToTile, tileKey, getTilesInBounds, estimateBytes, formatBytes } from './tile-math';
import { nearestPointOnRoute, isOffRoute, routeProgress, estimateTimeS, type LngLat } from './nav';
import { classifyFix, shouldRecord, isPlausibleStep, type Fix } from './tracker';

describe('tile-math', () => {
  it('places a known point on the right tile', () => {
    // Greenwich at zoom 0 is the single world tile.
    expect(latLngToTile(51.4779, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    // At zoom 1 the prime meridian sits at the boundary of the eastern tiles.
    expect(latLngToTile(51.4779, 0.1, 1)).toEqual({ x: 1, y: 0, z: 1 });
    expect(latLngToTile(-33.86, 151.2, 1)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('clamps rather than indexing off the grid at the extremes', () => {
    const t = latLngToTile(89.9, 179.9, 2);
    expect(t.x).toBeLessThanOrEqual(3);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThanOrEqual(3);
  });

  it('formats a tile key the way the cache expects', () => {
    expect(tileKey({ z: 14, x: 8180, y: 5310 })).toBe('14/8180/5310');
  });

  it('covers a bounding box across a zoom range', () => {
    const bounds = { n: 53.41, s: 53.38, e: -1.44, w: -1.51 };
    const tiles = getTilesInBounds(bounds, 12, 14, 0);
    expect(tiles.length).toBeGreaterThan(0);
    expect(new Set(tiles.map((t) => t.z))).toEqual(new Set([12, 13, 14]));
    // Every tile must be inside its zoom's grid.
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(2 ** t.z);
    }
  });

  it('grows the tile count when padding is asked for', () => {
    const bounds = { n: 53.41, s: 53.38, e: -1.44, w: -1.51 };
    const bare = getTilesInBounds(bounds, 14, 14, 0).length;
    const padded = getTilesInBounds(bounds, 14, 14, 2).length;
    expect(padded).toBeGreaterThan(bare);
  });

  it('estimates and formats a download size', () => {
    // 25 KB/tile, from a measured sample rather than the 15 KB the original
    // JKAImaps assumed — that under-reported real downloads by about half.
    expect(estimateBytes(100)).toBe(2_500_000);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('nav — nearest point and progress', () => {
  // A 2 km line running east at 53.4N.
  const route: LngLat[] = [
    [-1.5, 53.4],
    [-1.47, 53.4],
  ];

  it('finds a point on the line itself at zero distance', () => {
    const near = nearestPointOnRoute([-1.485, 53.4], route);
    expect(near).not.toBeNull();
    expect(near!.distanceM).toBeLessThan(1);
  });

  it('measures perpendicular distance off the line', () => {
    // ~111 m north of the line (0.001 deg latitude).
    const near = nearestPointOnRoute([-1.485, 53.401], route);
    expect(near!.distanceM).toBeGreaterThan(100);
    expect(near!.distanceM).toBeLessThan(125);
  });

  it('scales longitude against latitude — the reason for the projection', () => {
    // The same number of DEGREES is a shorter distance east-west than
    // north-south: at 53.4N a degree of longitude is cos(53.4) ~= 0.6 of a
    // degree of latitude. An unprojected implementation treats them as equal
    // and puts the nearest point in the wrong place on east-west lanes.
    const northOffset = nearestPointOnRoute([-1.485, 53.401], route)!.distanceM;
    const eastOffset = nearestPointOnRoute([-1.469, 53.4], route)!.distanceM; // 0.001 past the end
    expect(eastOffset / northOffset).toBeGreaterThan(0.5);
    expect(eastOffset / northOffset).toBeLessThan(0.7);
  });

  it('measures a clamped overshoot at true ground distance', () => {
    // 0.0005 deg of longitude past the end, at 53.4N ~= 33 m.
    const near = nearestPointOnRoute([-1.4695, 53.4], route)!;
    expect(near.distanceM).toBeGreaterThan(30);
    expect(near.distanceM).toBeLessThan(37);
  });

  it('clamps to the segment ends rather than running off the line', () => {
    const near = nearestPointOnRoute([-1.6, 53.4], route);
    expect(near!.point[0]).toBeCloseTo(-1.5, 4);
  });

  it('returns null for a route too short to be a line', () => {
    expect(nearestPointOnRoute([-1.5, 53.4], [])).toBeNull();
    expect(nearestPointOnRoute([-1.5, 53.4], [[-1.5, 53.4]])).toBeNull();
  });

  it('flags off-route past the threshold only', () => {
    expect(isOffRoute(20)).toBe(false);
    expect(isOffRoute(80)).toBe(true);
    expect(isOffRoute(80, 100)).toBe(false);
  });

  it('reports progress along the route', () => {
    const start = routeProgress([-1.5, 53.4], route)!;
    expect(start.fraction).toBeCloseTo(0, 2);

    const middle = routeProgress([-1.485, 53.4], route)!;
    expect(middle.fraction).toBeGreaterThan(0.4);
    expect(middle.fraction).toBeLessThan(0.6);
    expect(middle.remainingM).toBeGreaterThan(0);

    const end = routeProgress([-1.47, 53.4], route)!;
    expect(end.fraction).toBeCloseTo(1, 2);
    expect(end.remainingM).toBeLessThan(2);
  });
});

describe('nav — time estimates', () => {
  it('is slower for the same distance when it climbs', () => {
    const flat = estimateTimeS(10_000, 0, 'run');
    const hilly = estimateTimeS(10_000, 300, 'run');
    expect(hilly).toBeGreaterThan(flat);
  });

  it('ranks the sports sensibly over the same ground', () => {
    const d = 10_000;
    expect(estimateTimeS(d, 0, 'ride')).toBeLessThan(estimateTimeS(d, 0, 'run'));
    expect(estimateTimeS(d, 0, 'run')).toBeLessThan(estimateTimeS(d, 0, 'walk'));
    expect(estimateTimeS(d, 0, 'mtb')).toBeLessThan(estimateTimeS(d, 0, 'walk'));
  });

  it('is zero for no distance and falls back for an unknown sport', () => {
    expect(estimateTimeS(0, 100, 'run')).toBe(0);
    expect(estimateTimeS(5000, 0, 'kitesurf')).toBeGreaterThan(0);
  });
});

describe('tracker', () => {
  const fix = (over: Partial<Fix> = {}): Fix => ({
    lat: 53.4,
    lng: -1.5,
    elevation: 100,
    timestamp: 1_000_000,
    accuracy: 8,
    ...over,
  });

  it('accepts a good fix, flags a poor one, rejects a hopeless one', () => {
    expect(classifyFix(fix({ accuracy: 8 }))).toBe('accept');
    expect(classifyFix(fix({ accuracy: 45 }))).toBe('flag');
    expect(classifyFix(fix({ accuracy: 250 }))).toBe('reject');
  });

  it('rejects a fix with no real position', () => {
    expect(classifyFix(fix({ lat: NaN }))).toBe('reject');
  });

  it('throttles to one point every few seconds', () => {
    expect(shouldRecord(10_000, 8_000)).toBe(false);
    expect(shouldRecord(11_000, 8_000)).toBe(true);
  });

  it('rejects a jump no runner could make', () => {
    const from = { lat: 53.4, lng: -1.5, timestamp: 0 };
    // ~1.1 km in 3 seconds.
    const teleport = { lat: 53.41, lng: -1.5, timestamp: 3000 };
    expect(isPlausibleStep(from, teleport)).toBe(false);
  });

  it('accepts an ordinary running step', () => {
    const from = { lat: 53.4, lng: -1.5, timestamp: 0 };
    // ~11 m in 3 seconds — about 3.7 m/s.
    const step = { lat: 53.4001, lng: -1.5, timestamp: 3000 };
    expect(isPlausibleStep(from, step)).toBe(true);
  });

  it('rejects a step with no elapsed time rather than dividing by zero', () => {
    const from = { lat: 53.4, lng: -1.5, timestamp: 5000 };
    expect(isPlausibleStep(from, { lat: 53.4, lng: -1.5, timestamp: 5000 })).toBe(false);
  });
});
