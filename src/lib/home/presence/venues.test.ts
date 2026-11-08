import { describe, expect, it } from 'vitest';
import { isOneShop, overpassQuery, poisFromOverpass, shopKind, venueStops, type Point, type Poi } from './venues';

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
    expect(pois.map((p) => [p.name, p.food, !!p.shop, p.type])).toEqual([['Banquo', true, false, 'cafe'], ['Greggs', true, false, 'fast food'], ['Waterstones', false, true, 'books'], ['Car park', false, false, 'parking']]);
    expect(poisFromOverpass(null)).toEqual([]);
    expect(overpassQuery(54.5, -1.5, 200)).toContain('around:230,54.500000,-1.500000');
  });

  it('finds a sit-down at a café and half an hour in a bookshop, names each when it is clearly the one, and leaves the car park', () => {
    const pois = [poi('Banquo', 0, 0), poi('Haus', 0, 20), { ...poi('Waterstones', 100, 0, false, 'books'), shop: true }, poi('Car park', 0, -150, false, 'parking')];
    const points = [
      ...walk(0, 6, [-80, 0], [0, 3]), ...sit(8, 50, 0, 3),          // 42 minutes beside Banquo
      ...walk(52, 56, [0, 3], [100, 2]), ...sit(58, 90, 100, 2),     // half an hour in the bookshop
      ...walk(92, 96, [100, 2], [0, -148]), ...sit(98, 130, 0, -148), // the car park
    ];
    const stops = venueStops(points, pois);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ kind: 'food', category: 'food', name: 'Banquo', type: 'Café' });
    expect(stops[1]).toMatchObject({ kind: 'shop', category: 'shops', name: 'Waterstones', type: 'Bookshop' });
    // A place that is itself one shop keeps its food stops but never splits into shops.
    expect(venueStops(points, pois, { shops: false }).map((s) => s.kind)).toEqual(['food']);
    expect(stops[0].start).toBeLessThanOrEqual(8 * MIN);
    expect((stops[0].end - stops[0].start) / MIN).toBeGreaterThanOrEqual(42);
  });

  it('keeps a stop between two cafés as food, unnamed', () => {
    const stops = venueStops(sit(0, 30, 0, 9), [poi('Nero', 0, 0), poi('Market Tap', 0, 18)]);
    expect(stops).toEqual([expect.objectContaining({ name: null, kind: 'food', category: 'food', type: 'several close by, not sure which' })]);
  });

  it('gives a shop ten minutes, a meal fifteen, and says what the trade is', () => {
    const shop = { ...poi('Primark', 0, 0, false, 'clothes'), shop: true };
    expect(venueStops(sit(0, 12, 0, 2), [shop])).toEqual([expect.objectContaining({ name: 'Primark', type: 'Clothes shop' })]);
    expect(venueStops(sit(0, 12, 0, 2), [poi('Banquo', 0, 0)])).toEqual([]);
    // A map kept before shops carried their trade still reads as a shop.
    expect(venueStops(sit(0, 12, 0, 2), [poi('Old', 0, 0, false, 'shop')])).toEqual([expect.objectContaining({ name: 'Old', type: 'Shop', category: 'shops' })]);
    expect(shopKind('hairdresser')).toEqual(['Hairdresser', 'services']);
    expect(shopKind('optician')).toEqual(['Optician', 'health']);
    expect(shopKind('gift')).toEqual(['Gift shop', 'shops']);
  });

  it('knows a place named after one shop on its map', () => {
    const pois = [{ ...poi('H. Samuel', 0, 0, false, 'jewelry'), shop: true }, poi('Banquo', 0, 0)];
    expect(isOneShop('H. Samuel', pois)).toBe(true);
    expect(isOneShop('Town', pois)).toBe(false);
    expect(isOneShop('Banquo', pois)).toBe(false);
  });

  it('needs still minutes and a fix good to 30 m', () => {
    expect(venueStops(sit(0, 8, 0, 0), [poi('Banquo', 0, 0)])).toEqual([]);
    expect(venueStops(sit(0, 30, 0, 0).map((p) => ({ ...p, accuracyM: 65 })), [poi('Banquo', 0, 0)])).toEqual([]);
  });
});
