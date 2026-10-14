import { describe, expect, it } from 'vitest';
import { dietaryHints, gapCentre, metresFromLine, nearbyCandidates, nearbyIdeasQuery, nearbyRadiusM } from './nearby-ideas';
import type { Gap } from './ideas';

// v6: the deterministic fallback around a gap (pure half).
const PANTHEON = { lat: 41.8986, lng: 12.4769 };
const STAY = { lat: 41.8985, lng: 12.4718 };
const lunch: Gap = {
  date: '2026-10-27', stage: 'lunch', meal: 'lunch', replacesStopId: 'meal:2026-10-27:lunch', freeMin: 77,
  before: { stopId: 'pantheon', title: 'Pantheon', location: PANTHEON, min: 766 },
  after: { stopId: 'stay:2026-10-27:rest', title: 'Free time at the flat', location: STAY, min: 843 },
};
const el = (id: number, name: string, lat: number, lon: number, tags: Record<string, string>) => ({ type: 'node', id, lat, lon, tags: { name, ...tags } });

describe('the nearby fallback', () => {
  it('looks between the two ends, as far as the gap allows', () => {
    expect(gapCentre(lunch)).toEqual({ lat: (PANTHEON.lat + STAY.lat) / 2, lng: (PANTHEON.lng + STAY.lng) / 2 });
    const r = nearbyRadiusM(lunch);
    expect(r).toBeGreaterThanOrEqual(300);
    expect(r).toBeLessThanOrEqual(1500);
    expect(nearbyRadiusM({ ...lunch, freeMin: 400 })).toBe(1500);
    expect(nearbyRadiusM({ ...lunch, freeMin: 30, after: { ...lunch.after, location: PANTHEON } })).toBe(300);
  });

  it('asks for places to eat in a meal slot, and for sights otherwise', () => {
    expect(nearbyIdeasQuery(lunch, PANTHEON, 800)).toContain('"amenity"~"^(restaurant|cafe)$"');
    expect(nearbyIdeasQuery({ ...lunch, meal: 'breakfast' }, PANTHEON, 800)).toContain('"shop"="bakery"');
    const sights = nearbyIdeasQuery({ ...lunch, meal: null, stage: 'afternoon' }, PANTHEON, 800);
    for (const k of ['museum', 'viewpoint', 'park', 'place_of_worship', 'marketplace']) expect(sights).toContain(k);
    expect(sights).toContain('(around:800,41.898600,12.476900)');
  });

  it('ranks by closeness to the line, nudges a dietary match, skips wishes and what cannot fit', () => {
    const answer = {
      elements: [
        el(1, 'On the way', 41.8986, 12.4745, { amenity: 'restaurant' }),
        el(2, 'Veg place', 41.8996, 12.4745, { amenity: 'restaurant', 'diet:vegetarian': 'yes' }),
        el(3, 'Across town', 41.912, 12.5, { amenity: 'restaurant' }),
        el(4, 'Pantheon', 41.8986, 12.4769, { amenity: 'cafe' }),
        { type: 'node', id: 5, tags: { amenity: 'cafe', name: 'No position' } },
      ],
    };
    const existing = [{ title: 'Pantheon', place: { name: 'Pantheon', location: PANTHEON, osmId: 'way/1', address: null } }];
    const plain = nearbyCandidates(answer, lunch, existing);
    expect(plain.map((c) => c.title)).toEqual(['On the way', 'Veg place']);
    expect(plain[0]).toMatchObject({ kind: 'restaurant', place: { osmId: 'node/1' } });
    expect(plain[0].durationMin).toBeLessThanOrEqual(60);
    expect(plain[0].fit).toMatch(/^About \d+ min walk from Pantheon, \d+ min for lunch, \d+ min on to Free time at the flat\.$/);
    const veg = nearbyCandidates(answer, lunch, existing, dietaryHints({ constraints: [{ text: 'Sam is vegetarian', source: 'memory', ref: null }], preferences: [] }));
    expect(veg[0].title).toBe('Veg place');
    expect(veg[0].why).toContain('vegetarian');
  });

  it('measures distance from a segment, not just its ends', () => {
    expect(metresFromLine({ lat: 41.8986, lng: 12.474 }, PANTHEON, { lat: 41.8986, lng: 12.47 })).toBeLessThan(1);
    expect(metresFromLine({ lat: 41.9, lng: 12.474 }, PANTHEON, { lat: 41.8986, lng: 12.47 })).toBeGreaterThan(100);
  });
});
