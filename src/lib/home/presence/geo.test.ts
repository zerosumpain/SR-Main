import { describe, expect, it } from 'vitest';
import { circlePolygon, clampRadius, destinationPoint, distanceM, validPlaceGeometry } from './geo';
import { metresBetween } from './cluster';

// Made-up coordinates only.
const LAT = 51.5;
const LON = -0.1;

describe('distanceM', () => {
  it('agrees with the clusterer, so the map and the alerts measure the same edge', () => {
    expect(distanceM(LAT, LON, 51.501, -0.102)).toBeCloseTo(metresBetween(LAT, LON, 51.501, -0.102), 6);
  });
});

describe('destinationPoint', () => {
  it('puts a point the given distance away on the given bearing', () => {
    const east = destinationPoint(LAT, LON, 250, 90);
    expect(distanceM(LAT, LON, east.lat, east.lon)).toBeCloseTo(250, 3);
    expect(east.lat).toBeCloseTo(LAT, 4);
    expect(east.lon).toBeGreaterThan(LON);
    const north = destinationPoint(LAT, LON, 1000, 0);
    expect(north.lon).toBeCloseTo(LON, 9);
    expect(distanceM(LAT, LON, north.lat, north.lon)).toBeCloseTo(1000, 3);
  });
});

describe('circlePolygon', () => {
  it('is a closed GeoJSON ring of lon/lat pairs, every vertex on the radius', () => {
    const ring = circlePolygon(LAT, LON, 150, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const [lon, lat] of ring) {
      expect(distanceM(LAT, LON, lat, lon)).toBeCloseTo(150, 3);
    }
  });

  it('defaults to 64 steps and never fewer than 3', () => {
    expect(circlePolygon(LAT, LON, 100)).toHaveLength(65);
    expect(circlePolygon(LAT, LON, 100, 1)).toHaveLength(4);
  });
});

describe('clampRadius', () => {
  it('keeps a radius within 50–2000 m, rounded to the metre', () => {
    expect(clampRadius(10)).toBe(50);
    expect(clampRadius(5000)).toBe(2000);
    expect(clampRadius(123.6)).toBe(124);
  });

  it('turns nonsense into the floor rather than NaN', () => {
    expect(clampRadius(Number.NaN)).toBe(50);
    expect(clampRadius(Number.POSITIVE_INFINITY)).toBe(50);
  });
});

describe('validPlaceGeometry', () => {
  it('accepts a real point and an in-range radius', () => {
    expect(validPlaceGeometry(LAT, LON, 150)).toBeNull();
    expect(validPlaceGeometry(-90, 180, 50)).toBeNull();
    expect(validPlaceGeometry(90, -180, 2000)).toBeNull();
  });

  it('names what is wrong', () => {
    expect(validPlaceGeometry(91, LON, 150)).toMatch(/latitude/i);
    expect(validPlaceGeometry(LAT, -181, 150)).toMatch(/longitude/i);
    expect(validPlaceGeometry(Number.NaN, LON, 150)).toMatch(/latitude/i);
    expect(validPlaceGeometry(LAT, LON, 49)).toMatch(/radius/i);
    expect(validPlaceGeometry(LAT, LON, 2001)).toMatch(/radius/i);
  });
});
