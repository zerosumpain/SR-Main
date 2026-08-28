import { describe, it, expect } from 'vitest';
import { decodePolyline, encodePolyline } from './polyline';

describe('encodePolyline', () => {
  it('matches the reference example from the Google algorithm docs', () => {
    const points: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('round-trips through decodePolyline', () => {
    const points: [number, number][] = [
      [53.4012, -1.5023],
      [53.4031, -1.4998],
      [53.4055, -1.4961],
      [53.4012, -1.5023],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    expect(decoded).toHaveLength(points.length);
    decoded.forEach(([lat, lng], i) => {
      expect(lat).toBeCloseTo(points[i][0], 5);
      expect(lng).toBeCloseTo(points[i][1], 5);
    });
  });

  it('encodes an empty track to an empty string', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });

  it('handles southern and eastern hemispheres', () => {
    const points: [number, number][] = [
      [-33.8688, 151.2093],
      [-33.865, 151.2099],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    decoded.forEach(([lat, lng], i) => {
      expect(lat).toBeCloseTo(points[i][0], 5);
      expect(lng).toBeCloseTo(points[i][1], 5);
    });
  });
});
