import { describe, it, expect } from 'vitest';
import {
  gradientBands,
  GRADIENT_BAND_LABELS,
  GRADIENT_BANDS_ZERO,
} from './gradient-bands';
import type { SegmentGeometry } from '../segments-service';

/** One degree of latitude is ~111.2 km, so this is metres-per-point northwards. */
const M_PER_DEG_LAT = 111_194.93;

/**
 * A straight northbound track: `steps` points spaced `stepM` apart, with the
 * elevation at each point set by `ele(distanceAlong)`.
 */
function track(steps: number, stepM: number, ele: (m: number) => number | null): SegmentGeometry {
  return Array.from({ length: steps }, (_, i) => {
    const along = i * stepM;
    return [-1.55, 54.5 + along / M_PER_DEG_LAT, ele(along), i * 6] as [number, number, number | null, number];
  });
}

describe('gradientBands — degenerate input', () => {
  it('returns the zero struct for an empty geometry', () => {
    const r = gradientBands([]);
    expect(r).toEqual(GRADIENT_BANDS_ZERO);
    expect(r.usable).toBe(false);
    expect(r.bands).toHaveLength(4);
    expect(r.bands.map((b) => b.sharePct)).toEqual([0, 0, 0, 0]);
  });

  it('refuses a track with no elevation channel at all', () => {
    const r = gradientBands(track(60, 20, () => null));
    expect(r.usable).toBe(false);
    expect(r.measuredM).toBe(0);
  });

  it('refuses a track whose elevation covers less than half its length', () => {
    // Elevation only on the first fifth of the track.
    const r = gradientBands(track(200, 20, (m) => (m < 800 ? m * 0.05 : null)));
    expect(r.usable).toBe(false);
  });
});

describe('gradientBands — banding', () => {
  it('puts a flat kilometre entirely in the shallowest band', () => {
    const r = gradientBands(track(120, 20, () => 100));
    expect(r.usable).toBe(true);
    expect(r.bands.map((b) => b.label)).toEqual([...GRADIENT_BAND_LABELS]);
    expect(r.bands[0].sharePct).toBe(100);
    expect(r.bands.slice(1).every((b) => b.sharePct === 0)).toBe(true);
    expect(r.steepestPct).toBeLessThan(1);
  });

  it('puts a steady 6% climb in the 4–8% band', () => {
    const r = gradientBands(track(150, 20, (m) => 100 + m * 0.06));
    expect(r.bands[1].sharePct).toBeGreaterThan(90);
    expect(r.steepestPct).toBeGreaterThan(5.5);
    expect(r.steepestPct).toBeLessThan(6.5);
  });

  it('puts a 15% wall in the open-ended top band', () => {
    const r = gradientBands(track(150, 20, (m) => 100 + m * 0.15));
    expect(r.bands[3].sharePct).toBeGreaterThan(90);
    expect(r.bands[3].label).toBe('12%+');
    expect(r.bands[3].toPct).toBeNull();
  });

  it('bands descent by steepness, not by sign — the strip measures ground', () => {
    const r = gradientBands(track(150, 20, (m) => 400 - m * 0.06));
    expect(r.bands[1].sharePct).toBeGreaterThan(90);
  });

  it('splits a front-loaded climb between its bands', () => {
    // First half at 10%, second half flat.
    const r = gradientBands(track(200, 20, (m) => (m < 2000 ? 100 + m * 0.1 : 300)));
    expect(r.bands[0].sharePct).toBeGreaterThan(40);
    expect(r.bands[2].sharePct).toBeGreaterThan(40);
  });
});

describe('gradientBands — the numbers the strip prints', () => {
  const r = gradientBands(track(200, 20, (m) => (m < 2000 ? 100 + m * 0.1 : 300)));

  it('always sums to exactly 100 percent, so the fr columns fill the row', () => {
    expect(r.bands.reduce((a, b) => a + b.sharePct, 0)).toBe(100);
  });

  it('measures a length close to the real path length', () => {
    expect(r.measuredM).toBeGreaterThan(3800);
    expect(r.measuredM).toBeLessThan(4000);
  });

  it('reports the four labelled bands with their edges', () => {
    expect(r.bands.map((b) => [b.fromPct, b.toPct])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, null],
    ]);
  });

  it('keeps the distance in each band consistent with its share', () => {
    for (const b of r.bands) {
      expect(b.distanceM).toBeGreaterThanOrEqual(0);
    }
    const total = r.bands.reduce((a, b) => a + b.distanceM, 0);
    expect(total).toBeCloseTo(r.measuredM, 3);
  });
});
