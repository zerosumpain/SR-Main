import { describe, expect, it } from 'vitest';
import { foodStops, overpassQuery, poisFromOverpass, type Point, type Poi } from './venues';

const MIN = 60_000;
// Metres to degrees near 54.5°N.
const dLat = (m: number) => m / 111_320, dLon = (m: number) => m / (111_320 * Math.cos((54.5 * Math.PI) / 180));
const O = { lat: 54.5250, lon: -1.5540 };
const at = (n: number, e: number) => ({ lat: O.lat + dLat(n), lon: O.lon + dLon(e) });
const poi = (name: string, n: number, e: number, food = true, type = 'cafe'): Poi => ({ ...at(n, e), name, food, type });
/** Still at (n, e) from minute `a` to `b`, a reading every two minutes. */
const sit = (a: number, b: number, n: number, e: number): Point[] =>
  Array.from({ length: (b - a) / 2 + 1 }, (_, i) => ({ t: (a + i * 2) * MIN, ...at(n, e), accuracyM: 15 }));
const walk = (a: number, b: number, from: [number, number], to: [number, number]): Point[] =>
  Array.from({ length: (b - a) / 2 + 1 }, (_, i) => { const f = i / ((b - a) / 2); return { t: (a + i * 2) * MIN, ...at(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f), accuracyM: 15 }; });

describe('venues', () => {
  it('reads named amenities, shops and car parks off an Overpass answer', () => {
    const pois = poisFromOverpass({ elements: [
      { lat: 54.5, lon: -1.5, tags: { amenity: 'cafe', name: 'Banquo' } },
      { center: { lat: 54.5, lon: -1.5 }, tags: { amenity: 'fast_food', name: 'Greggs' } },
      { lat: 54.5, lon: -1.5, tags: { shop: 'books', name: 'Waterstones' } },
      { lat: 54.5, lon: -1.5, tags: { amenity: 'parking' } },
      { lat: 54.5, lon: -1.5, tags: { amenity: 'bench' } },
    ] });
    expect(pois.map((p) => [p.name, p.food, p.type])).toEqual([['Banquo', true, 'cafe'], ['Greggs', true, 'fast food'], ['Waterstones', false, 'shop'], ['Car park', false, 'parking']]);
    expect(poisFromOverpass(null)).toEqual([]);
    expect(overpassQuery(54.5, -1.5, 200)).toContain('around:230,54.500000,-1.500000');
  });

  it('finds a sit-down at a café, names it when it is clearly the one, and ignores the shops and the car park', () => {
    const pois = [poi('Banquo', 0, 0), poi('Haus', 0, 20), poi('Waterstones', 100, 0, false, 'shop'), poi('Car park', 0, -150, false, 'parking')];
    const points = [
      ...walk(0, 6, [-80, 0], [0, 3]), ...sit(8, 50, 0, 3),          // 42 minutes beside Banquo
      ...walk(52, 56, [0, 3], [100, 2]), ...sit(58, 90, 100, 2),     // half an hour in the bookshop
      ...walk(92, 96, [100, 2], [0, -148]), ...sit(98, 130, 0, -148), // the car park
    ];
    const stops = foodStops(points, pois);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ name: 'Banquo', type: 'cafe' });
    expect(stops[0].start).toBeLessThanOrEqual(8 * MIN);
    expect((stops[0].end - stops[0].start) / MIN).toBeGreaterThanOrEqual(42);
  });

  it('keeps a stop between two cafés as food, unnamed', () => {
    const stops = foodStops(sit(0, 30, 0, 9), [poi('Nero', 0, 0), poi('Market Tap', 0, 18)]);
    expect(stops).toEqual([expect.objectContaining({ name: null })]);
  });

  it('needs fifteen still minutes and a fix good to 30 m', () => {
    expect(foodStops(sit(0, 12, 0, 0), [poi('Banquo', 0, 0)])).toEqual([]);
    expect(foodStops(sit(0, 30, 0, 0).map((p) => ({ ...p, accuracyM: 65 })), [poi('Banquo', 0, 0)])).toEqual([]);
  });
});
