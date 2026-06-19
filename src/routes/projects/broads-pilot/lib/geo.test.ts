import { describe, it, expect } from 'vitest';
import { haversine, polylineLength, nearestIndex } from './geo';
import type { LatLng } from './types';

describe('geo', () => {
  it('haversine ≈ 675 m for 0.01° lng at 52.7°N', () => {
    // 0.01° longitude at 52.7°N ≈ 111320·cos(52.7°)·0.01 ≈ 674.6 m
    expect(haversine([52.7, 1.5], [52.7, 1.51])).toBeCloseTo(675, -1); // ±5 m
  });

  it('haversine is zero for identical points', () => {
    expect(haversine([52.7, 1.5], [52.7, 1.5])).toBe(0);
  });

  it('polylineLength sums consecutive segments', () => {
    const pts: LatLng[] = [
      [52.7, 1.5],
      [52.7, 1.51],
      [52.7, 1.52],
    ];
    expect(polylineLength(pts)).toBeGreaterThan(1340);
    expect(polylineLength(pts)).toBeLessThan(1360);
  });

  it('nearestIndex returns the closest point index', () => {
    const pts: LatLng[] = [
      [52.8, 1.5],
      [52.7, 1.501],
      [52.6, 1.5],
    ];
    expect(nearestIndex([52.7, 1.5], pts)).toBe(1);
  });
});
