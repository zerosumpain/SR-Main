import { describe, it, expect } from 'vitest';
import {
  bearingDelta,
  clusterPoints,
  clusterRadiusM,
  coverageOf,
  hasCoverage,
  haversineKm,
  inferMode,
  looksLikeRail,
  median,
  metresBetween,
  segmentVisits,
  speedKmhBetween,
} from './cluster';
import type { ClusterPoint } from './types';

const T0 = new Date('2026-08-26T09:00:00Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

/** ~111 m per 0.001° of latitude, near enough for fixtures. */
const northOf = (lat: number, metres: number) => lat + metres / 111_320;

describe('distance and bearing', () => {
  it('measures a known separation', () => {
    // 0.01° of latitude is 1111.95 m on the 6371 km sphere this uses.
    expect(haversineKm(51.5, -0.12, 51.51, -0.12)).toBeCloseTo(1.11195, 4);
    expect(metresBetween(51.5, -0.12, 51.51, -0.12)).toBeCloseTo(1111.95, 1);
  });

  it('is zero for a point against itself', () => {
    expect(metresBetween(51.5, -0.12, 51.5, -0.12)).toBe(0);
  });

  it('treats bearings as a circle, so 359° and 1° are 2° apart', () => {
    expect(bearingDelta(359, 1)).toBe(2);
    expect(bearingDelta(1, 359)).toBe(2);
    expect(bearingDelta(10, 200)).toBe(170);
  });
});

describe('clusterPoints', () => {
  it('groups points inside the radius and separates points outside it', () => {
    const pts: ClusterPoint[] = [
      { idx: 0, lat: 51.5, lon: -0.12, ts: at(0) },
      { idx: 1, lat: northOf(51.5, 50), lon: -0.12, ts: at(10) }, // 50 m — same place
      { idx: 2, lat: northOf(51.5, 5000), lon: -0.12, ts: at(20) }, // 5 km — elsewhere
    ];
    const clusters = clusterPoints(pts, 200);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].members).toEqual([0, 1]);
    expect(clusters[1].members).toEqual([2]);
  });

  it('moves the centroid toward its members rather than pinning it to the first point', () => {
    const pts: ClusterPoint[] = [
      { idx: 0, lat: 51.5, lon: -0.12, ts: at(0) },
      { idx: 1, lat: northOf(51.5, 100), lon: -0.12, ts: at(5) },
    ];
    const [c] = clusterPoints(pts, 200);
    // Mean of the two latitudes, i.e. 50 m north of the first point.
    expect(metresBetween(c.lat, c.lon, 51.5, -0.12)).toBeCloseTo(50, 0);
  });

  it('skips non-finite coordinates instead of producing a NaN centroid', () => {
    const pts: ClusterPoint[] = [
      { idx: 0, lat: 51.5, lon: -0.12, ts: at(0) },
      { idx: 1, lat: Number.NaN, lon: -0.12, ts: at(5) },
    ];
    const [c] = clusterPoints(pts, 200);
    expect(clusterPoints(pts, 200)).toHaveLength(1);
    expect(Number.isFinite(c.lat)).toBe(true);
    expect(c.members).toEqual([0]);
  });

  it('returns nothing for no points', () => {
    expect(clusterPoints([], 200)).toEqual([]);
  });
});

describe('clusterRadiusM', () => {
  it('never reports a place tighter than the resolution that found it', () => {
    const members = [{ lat: 51.5, lon: -0.12 }];
    expect(clusterRadiusM(51.5, -0.12, members, 200)).toBe(200);
  });

  it('grows to reach the furthest member', () => {
    const members = [
      { lat: 51.5, lon: -0.12 },
      { lat: northOf(51.5, 350), lon: -0.12 },
    ];
    expect(clusterRadiusM(51.5, -0.12, members, 200)).toBeGreaterThanOrEqual(349);
  });
});

describe('segmentVisits', () => {
  it('splits one long stay from a later return', () => {
    const visits = segmentVisits([at(0), at(10), at(20), at(300), at(310)], 45);
    expect(visits).toHaveLength(2);
    expect(visits[0].dwellMins).toBe(20);
    expect(visits[0].fixCount).toBe(3);
    expect(visits[1].dwellMins).toBe(10);
  });

  it('does not read three months of the same shop as one ninety-day stay', () => {
    const daily = Array.from({ length: 5 }, (_, d) => at(d * 24 * 60));
    const visits = segmentVisits(daily, 45);
    expect(visits).toHaveLength(5);
    expect(visits.every((v) => v.dwellMins === 0)).toBe(true);
  });

  it('sorts unordered input before segmenting', () => {
    const visits = segmentVisits([at(20), at(0), at(10)], 45);
    expect(visits).toHaveLength(1);
    expect(visits[0].dwellMins).toBe(20);
  });

  it('returns nothing for no fixes', () => {
    expect(segmentVisits([], 45)).toEqual([]);
  });
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // 2.5 rounds to 3
  });

  it('is 0 for empty input rather than NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('speedKmhBetween', () => {
  const prev = { ts: at(0), lat: 51.5, lon: -0.12 };

  it('derives a plausible speed from a plausible pair', () => {
    // 1.113 km in 6 minutes ≈ 11.1 km/h.
    const s = speedKmhBetween(prev, 51.51, -0.12, at(6));
    expect(s).toBeCloseTo(11.1, 1);
  });

  it('is null with no usable previous position', () => {
    expect(speedKmhBetween(null, 51.51, -0.12, at(6))).toBeNull();
    expect(speedKmhBetween({ ts: at(0), lat: null, lon: null }, 51.51, -0.12, at(6))).toBeNull();
  });

  it('is null across a window too wide to mean anything', () => {
    expect(speedKmhBetween(prev, 51.51, -0.12, at(90), 20)).toBeNull();
  });

  it('is null for a physically absurd jump rather than reporting four figures', () => {
    // 1.1 km in one second implies ~4000 km/h — a bad fix, not a journey.
    const oneSecond = new Date(prev.ts.getTime() + 1000);
    expect(speedKmhBetween(prev, 51.51, -0.12, oneSecond)).toBeNull();
  });

  it('is null when time runs backwards', () => {
    expect(speedKmhBetween(prev, 51.51, -0.12, at(-5))).toBeNull();
  });
});

describe('inferMode', () => {
  it('bands ordinary speeds', () => {
    expect(inferMode(0)).toBe('still');
    expect(inferMode(4)).toBe('walking');
    expect(inferMode(12)).toBe('active');
    expect(inferMode(70)).toBe('vehicle');
  });

  it('reports unknown — never still — when speed could not be derived', () => {
    // The distinction that matters: "I could not tell" is not "you did not move".
    expect(inferMode(null)).toBe('unknown');
    expect(inferMode(Number.NaN)).toBe('unknown');
  });
});

describe('looksLikeRail', () => {
  const fast = (n: number, bearingDrift = 0): Array<{ lat: number; lon: number; speedKmh: number | null }> =>
    Array.from({ length: n }, (_, i) => ({
      lat: 51.5 + i * 0.01,
      lon: -0.12 + i * 0.01 * (bearingDrift / 10),
      speedKmh: 90,
    }));

  it('accepts sustained speed along a constant bearing', () => {
    expect(looksLikeRail(fast(4))).toBe(true);
  });

  it('rejects a short burst', () => {
    expect(looksLikeRail(fast(2))).toBe(false);
  });

  it('rejects slow movement however straight', () => {
    const slow = fast(4).map((f) => ({ ...f, speedKmh: 20 }));
    expect(looksLikeRail(slow)).toBe(false);
  });

  it('rejects fast movement that keeps turning', () => {
    const winding = [
      { lat: 51.5, lon: -0.12, speedKmh: 90 },
      { lat: 51.51, lon: -0.12, speedKmh: 90 }, // due north
      { lat: 51.51, lon: -0.1, speedKmh: 90 }, // due east
      { lat: 51.5, lon: -0.1, speedKmh: 90 }, // due south
    ];
    expect(looksLikeRail(winding)).toBe(false);
  });

  it('rejects a window with an underivable speed in it', () => {
    const gappy = fast(4);
    gappy[2].speedKmh = null;
    expect(looksLikeRail(gappy)).toBe(false);
  });
});

describe('coverage', () => {
  const start = at(0);
  const end = at(60); // one hour, so 6 expected observations at 10-minute polling

  it('is 1 for a fully observed window', () => {
    const rows = [0, 10, 20, 30, 40, 50].map((m) => ({ ts: at(m), source: 'poll' }));
    expect(coverageOf(rows, start, end)).toBe(1);
  });

  it('does not count gap rows as observations', () => {
    // The system looked six times and failed six times. It knows nothing about
    // this hour, and must not be able to claim otherwise.
    const rows = [0, 10, 20, 30, 40, 50].map((m) => ({ ts: at(m), source: 'gap' }));
    expect(coverageOf(rows, start, end)).toBe(0);
    expect(hasCoverage(rows, start, end)).toBe(false);
  });

  it('blocks a detector when the sensor was mostly down', () => {
    const rows = [{ ts: at(5), source: 'poll' }, { ts: at(15), source: 'poll' }];
    expect(hasCoverage(rows, start, end, 0.6)).toBe(false);
  });

  it('allows a detector once enough of the window is observed', () => {
    const rows = [0, 10, 20, 30].map((m) => ({ ts: at(m), source: 'poll' }));
    expect(hasCoverage(rows, start, end, 0.6)).toBe(true);
  });

  it('ignores rows outside the window', () => {
    const rows = [
      { ts: at(-30), source: 'poll' },
      { ts: at(5), source: 'poll' },
      { ts: at(500), source: 'poll' },
    ];
    expect(coverageOf(rows, start, end)).toBeCloseTo(1 / 6, 5);
  });

  it('is 0 for a zero-length or inverted window rather than dividing by zero', () => {
    expect(coverageOf([], start, start)).toBe(0);
    expect(coverageOf([], end, start)).toBe(0);
  });
});
