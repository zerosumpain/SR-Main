import { describe, it, expect } from 'vitest';
import {
  haversineM,
  decimateTrack,
  trackBounds,
  trackDistanceM,
  elevationDelta,
  elevationProfile,
  computeSplits,
  type TrackPoint,
} from './track';

/** A straight northward track from (lng, lat), one point per second. */
function northwardTrack(
  opts: { lng?: number; lat?: number; points: number; metresPerStep: number; ele?: (i: number) => number | null },
): TrackPoint[] {
  const { lng = -1.5, lat = 53.4, points, metresPerStep, ele } = opts;
  const degPerMetre = 1 / 111_194.9; // metres per degree of latitude
  return Array.from({ length: points }, (_, i) => [
    lng,
    lat + i * metresPerStep * degPerMetre,
    ele ? ele(i) : null,
    i,
  ] as TrackPoint);
}

describe('haversineM', () => {
  it('measures a known meridian distance', () => {
    // 1 degree of latitude is ~111.19 km along a meridian.
    const d = haversineM([-1.5, 53.0], [-1.5, 54.0]);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('is zero for identical points', () => {
    expect(haversineM([-1.5, 53.4], [-1.5, 53.4])).toBe(0);
  });

  it('is symmetric', () => {
    const a: [number, number] = [-1.5, 53.4];
    const b: [number, number] = [-1.4, 53.5];
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9);
  });
});

describe('decimateTrack', () => {
  it('always keeps the endpoints', () => {
    const track = northwardTrack({ points: 100, metresPerStep: 0.1 });
    const out = decimateTrack(track, 3);
    expect(out[0]).toEqual(track[0]);
    expect(out[out.length - 1]).toEqual(track[track.length - 1]);
  });

  it('collapses a stationary run to its endpoints', () => {
    // 60 seconds standing still at a gate.
    const track: TrackPoint[] = Array.from({ length: 60 }, (_, i) => [-1.5, 53.4, 100, i]);
    expect(decimateTrack(track, 3)).toHaveLength(2);
  });

  it('keeps every point when all gaps exceed the threshold', () => {
    const track = northwardTrack({ points: 20, metresPerStep: 10 });
    expect(decimateTrack(track, 3)).toHaveLength(20);
  });

  it('preserves total distance within tolerance', () => {
    const track = northwardTrack({ points: 1000, metresPerStep: 1 });
    const before = trackDistanceM(track);
    const after = trackDistanceM(decimateTrack(track, 3));
    // A straight line loses nothing to decimation.
    expect(after).toBeCloseTo(before, 1);
  });

  it('cuts a 1 Hz trace down substantially', () => {
    const track = northwardTrack({ points: 1000, metresPerStep: 1 });
    expect(decimateTrack(track, 3).length).toBeLessThan(400);
  });

  it('returns short tracks untouched', () => {
    const track = northwardTrack({ points: 2, metresPerStep: 0.01 });
    expect(decimateTrack(track, 3)).toHaveLength(2);
    expect(decimateTrack([], 3)).toHaveLength(0);
  });
});

describe('trackBounds', () => {
  it('finds the enclosing box', () => {
    const track: TrackPoint[] = [
      [-1.5, 53.4, null, 0],
      [-1.3, 53.6, null, 1],
      [-1.7, 53.2, null, 2],
    ];
    expect(trackBounds(track)).toEqual({ n: 53.6, s: 53.2, e: -1.3, w: -1.7 });
  });

  it('throws on an empty track rather than returning a nonsense box', () => {
    expect(() => trackBounds([])).toThrow(/empty/);
  });
});

describe('trackDistanceM', () => {
  it('sums a known straight line', () => {
    const track = northwardTrack({ points: 11, metresPerStep: 100 });
    expect(trackDistanceM(track)).toBeCloseTo(1000, 0);
  });

  it('is zero for a single point', () => {
    expect(trackDistanceM([[-1.5, 53.4, null, 0]])).toBe(0);
  });
});

describe('elevationDelta', () => {
  it('sums a steady climb', () => {
    const track = northwardTrack({ points: 11, metresPerStep: 10, ele: (i) => 100 + i * 10 });
    const { gainM, lossM } = elevationDelta(track);
    expect(gainM).toBeCloseTo(100, 5);
    expect(lossM).toBe(0);
  });

  it('separates ascent from descent on an up-and-over', () => {
    const ups = Array.from({ length: 11 }, (_, i) => 100 + i * 10); // 100 -> 200
    const downs = Array.from({ length: 11 }, (_, i) => 200 - i * 20); // 200 -> 0
    const eles = [...ups, ...downs.slice(1)];
    const track = northwardTrack({ points: eles.length, metresPerStep: 10, ele: (i) => eles[i] });
    const { gainM, lossM } = elevationDelta(track);
    expect(gainM).toBeCloseTo(100, 5);
    expect(lossM).toBeCloseTo(200, 5);
  });

  it('ignores sub-threshold jitter — the reason the threshold exists', () => {
    // Flat ground, altitude wobbling +/- 0.5 m for an hour.
    const track = northwardTrack({
      points: 3600,
      metresPerStep: 1,
      ele: (i) => 100 + (i % 2 === 0 ? 0.5 : -0.5),
    });
    const { gainM, lossM } = elevationDelta(track, 1);
    expect(gainM).toBe(0);
    expect(lossM).toBe(0);
  });

  it('skips points with no altitude', () => {
    const track: TrackPoint[] = [
      [-1.5, 53.4, 100, 0],
      [-1.5, 53.41, null, 1],
      [-1.5, 53.42, 150, 2],
    ];
    expect(elevationDelta(track).gainM).toBeCloseTo(50, 5);
  });

  it('reports nothing when no point has altitude', () => {
    const track = northwardTrack({ points: 50, metresPerStep: 5 });
    expect(elevationDelta(track)).toEqual({ gainM: 0, lossM: 0 });
  });
});

describe('elevationProfile', () => {
  it('pairs altitude with cumulative distance', () => {
    const track = northwardTrack({ points: 3, metresPerStep: 100, ele: (i) => 100 + i });
    const profile = elevationProfile(track);
    expect(profile).toHaveLength(3);
    expect(profile[0].distanceM).toBeCloseTo(0, 5);
    expect(profile[1].distanceM).toBeCloseTo(100, 0);
    expect(profile[2].distanceM).toBeCloseTo(200, 0);
    expect(profile.map((p) => p.elevationM)).toEqual([100, 101, 102]);
  });

  it('still advances distance across points that lack altitude', () => {
    const track: TrackPoint[] = [
      [-1.5, 53.4, 100, 0],
      [-1.5, 53.4 + 100 / 111_194.9, null, 1],
      [-1.5, 53.4 + 200 / 111_194.9, 120, 2],
    ];
    const profile = elevationProfile(track);
    expect(profile).toHaveLength(2);
    expect(profile[1].distanceM).toBeCloseTo(200, 0);
  });
});

describe('computeSplits', () => {
  it('splits a 3 km run into three kilometres', () => {
    // 1 m/s for 3000 s.
    const track = northwardTrack({ points: 3001, metresPerStep: 1 });
    const splits = computeSplits(track);
    expect(splits).toHaveLength(3);
    for (const s of splits) {
      expect(s.distanceM).toBeGreaterThanOrEqual(1000);
      expect(s.paceSPerKm).toBeCloseTo(1000, 0); // 1 m/s => 1000 s/km
    }
    expect(splits.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('reports a trailing partial split at its true distance', () => {
    const track = northwardTrack({ points: 1501, metresPerStep: 1 });
    const splits = computeSplits(track);
    expect(splits).toHaveLength(2);
    expect(splits[1].distanceM).toBeGreaterThan(400);
    expect(splits[1].distanceM).toBeLessThan(600);
  });

  it('does not emit a split for a stray metre', () => {
    const track = northwardTrack({ points: 1002, metresPerStep: 1 });
    const splits = computeSplits(track);
    expect(splits).toHaveLength(1);
  });

  it('returns nothing for a track too short to measure', () => {
    expect(computeSplits([])).toEqual([]);
    expect(computeSplits([[-1.5, 53.4, null, 0]])).toEqual([]);
  });

  it('attributes elevation gain to the split it happened in', () => {
    // Climb only during the second kilometre.
    const track = northwardTrack({
      points: 2001,
      metresPerStep: 1,
      ele: (i) => (i < 1000 ? 100 : 100 + (i - 1000) * 0.1),
    });
    const splits = computeSplits(track);
    expect(splits[0].elevationGainM).toBeCloseTo(0, 1);
    expect(splits[1].elevationGainM).toBeGreaterThan(90);
  });
});
