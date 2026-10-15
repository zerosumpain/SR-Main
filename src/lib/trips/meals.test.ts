import { describe, expect, it } from 'vitest';
import { cuisineWords, daySlots, hoursOn, hoursText, mealQuery, placeName, mealSlots, openFor, rankMealOptions, slotFingerprint, withMealOptions, type MealSlot } from './meals';
import { currentOptions, staleSlots, type MealCache } from './meals.server';
import type { PlannedDay, PlannedStop, SolvedPlan } from './model';

// v7: real places for the planned meals (pure half).
const PANTHEON = { lat: 41.8986, lng: 12.4769 };
const TREVI = { lat: 41.9009, lng: 12.4833 };
const STAY = { lat: 41.895, lng: 12.474 };
const stop = (id: string, kind: PlannedStop['kind'], location: PlannedStop['location'], arriveMin: number, departMin = arriveMin + 30): PlannedStop => ({
  id, kind, wishId: kind === 'wish' ? id : null, title: id === 'pantheon' ? 'Pantheon' : id, location, arriveMin, departMin, waitSec: 0, locked: false, bookingId: null, warnings: [],
});
// Tuesday 27 October 2026.
const day: PlannedDay = {
  date: '2026-10-27', stayId: 'flat',
  stops: [stop('stay:2026-10-27:start', 'stay', STAY, 540), stop('pantheon', 'wish', PANTHEON, 600, 700), stop('meal:2026-10-27:lunch', 'meal', null, 720, 780), stop('trevi', 'wish', TREVI, 800), stop('meal:2026-10-27:dinner', 'meal', null, 1170, 1245), stop('stay:2026-10-27:end', 'stay', STAY, 1260)],
  legs: [], warnings: [],
};
const plan = { days: [day], dropped: [], warnings: [], score: 0 } as unknown as SolvedPlan;
const node = (id: number, name: string, at: { lat: number; lng: number }, tags: Record<string, string> = {}) => ({ type: 'node', id, lat: at.lat, lon: at.lng, tags: { amenity: 'restaurant', name, ...tags } });
const near = (dLat: number, dLng: number) => ({ lat: PANTHEON.lat + dLat, lng: PANTHEON.lng + dLng });

describe('meal slots', () => {
  it('finds lunch and dinner, anchored on the placed stop before', () => {
    const slots = mealSlots(plan);
    expect(slots.map((s) => s.stopId)).toEqual(['meal:2026-10-27:lunch', 'meal:2026-10-27:dinner']);
    expect(slots[0]).toMatchObject({ meal: 'lunch', anchorTitle: 'Pantheon', startMin: 720, endMin: 780, next: { title: 'trevi' } });
    expect(slots[1]).toMatchObject({ meal: 'dinner', anchorTitle: 'trevi', next: { title: 'stay:2026-10-27:end' } });
  });

  it('skips breakfast and meals already given a place', () => {
    const d = { ...day, stops: [stop('meal:2026-10-27:breakfast', 'meal', STAY, 500), ...day.stops.slice(1, 2)] };
    expect(daySlots(d)).toEqual([]);
  });

  it('fingerprints place and half-hour, not the minute', () => {
    const [lunch] = mealSlots(plan);
    expect(slotFingerprint({ ...lunch, startMin: 725 })).toBe(slotFingerprint(lunch));
    expect(slotFingerprint({ ...lunch, startMin: 760 })).not.toBe(slotFingerprint(lunch));
    expect(slotFingerprint({ ...lunch, anchor: TREVI })).not.toBe(slotFingerprint(lunch));
  });

  it('asks Overpass for restaurants and cafés at lunch, restaurants at dinner', () => {
    const [lunch, dinner] = mealSlots(plan);
    expect(mealQuery(lunch)).toContain('restaurant|cafe');
    expect(mealQuery(dinner)).toContain('"^(restaurant)$"');
  });
});

describe('opening hours', () => {
  it('reads a Tuesday from OSM text', () => {
    expect(hoursOn('Mo-Su 12:00-15:00,19:00-23:00', '2026-10-27')).toEqual([{ openMin: 720, closeMin: 900 }, { openMin: 1140, closeMin: 1380 }]);
    expect(hoursOn('Tu off; We-Mo 12:00-23:00', '2026-10-27')).toEqual([]);
    expect(hoursOn(undefined, '2026-10-27')).toBeNull();
  });
  it('says unknown as unknown', () => {
    expect(openFor(null, 720, 45)).toBeNull();
    expect(openFor([{ openMin: 720, closeMin: 900 }], 720, 45)).toBe(true);
    // Opening half an hour in still serves the meal; later does not.
    expect(openFor([{ openMin: 750, closeMin: 900 }], 720, 45)).toBe(true);
    expect(openFor([{ openMin: 760, closeMin: 900 }], 720, 45)).toBe(false);
    expect(openFor([{ openMin: 600, closeMin: 740 }], 720, 45)).toBe(false);
  });
  it('says a whole day and midnight plainly', () => {
    expect(hoursText([{ openMin: 0, closeMin: 1440 }])).toBe('Open all day');
    expect(hoursText([{ openMin: 1140, closeMin: 1440 }])).toBe('Open 19:00–midnight');
    expect(hoursText([])).toBe('Closed that day');
  });
  it('names the stay, not the free time at it', () => {
    expect(placeName("Free time at Apartment by Campo de' Fiori")).toBe("Apartment by Campo de' Fiori");
    expect(placeName('Pantheon')).toBe('Pantheon');
  });
  it('words cuisines', () => {
    expect(cuisineWords('italian;pizza;pasta')).toBe('Italian, pizza');
    expect(cuisineWords('regional_food')).toBe('Regional food');
    expect(cuisineWords(undefined)).toBeNull();
  });
});

describe('ranking meal options', () => {
  const [lunch] = mealSlots(plan) as [MealSlot];
  const answer = {
    elements: [
      node(1, 'Armando al Pantheon', near(0.0005, 0.0003), { cuisine: 'italian', opening_hours: 'Mo-Sa 12:30-15:00,19:00-23:00', website: 'https://example.org/armando' }),
      node(2, 'Closed On Tuesdays', near(0.0002, 0.0001), { cuisine: 'italian', opening_hours: 'Tu off; We-Mo 12:00-23:00' }),
      node(3, 'Shuts Before Lunch', near(0.0003, 0.0002), { opening_hours: 'Mo-Su 07:00-11:00' }),
      node(4, 'No Hours Trattoria', near(0.0004, 0.0006), { cuisine: 'italian' }),
      node(5, 'Green Leaf', near(0.0006, 0.0007), { cuisine: 'vegetarian', opening_hours: 'Mo-Su 12:00-22:00', 'diet:vegetarian': 'only' }),
      node(6, 'Pizza Far Away', near(0.03, 0.03), { cuisine: 'pizza', opening_hours: 'Mo-Su 12:00-23:00' }),
      { type: 'node', id: 7, lat: PANTHEON.lat, lon: PANTHEON.lng, tags: { amenity: 'restaurant' } },
      node(8, 'Old Place', near(0.0001, 0.0001), { 'disused:amenity': 'restaurant' }),
      node(9, 'Sushi Roma', near(0.0007, 0.0009), { cuisine: 'japanese', opening_hours: 'Mo-Su 12:00-15:00' }),
    ],
  };

  it('keeps three, never one known to be shut then, nor one too far to walk', () => {
    const got = rankMealOptions(answer, lunch);
    expect(got).toHaveLength(3);
    const names = got.map((o) => o.name);
    expect(names).not.toContain('Closed On Tuesdays');
    expect(names).not.toContain('Shuts Before Lunch');
    expect(names).not.toContain('Pizza Far Away');
    expect(names).not.toContain('Old Place');
  });

  it('puts open-for-sure first and prefers different cuisines', () => {
    const got = rankMealOptions(answer, lunch);
    expect(got.every((o) => o.openKnown)).toBe(true);
    expect(new Set(got.map((o) => o.cuisine)).size).toBe(3);
    expect(got[0]).toMatchObject({ name: 'Armando al Pantheon', kind: 'restaurant', cuisine: 'Italian', openText: 'Open 12:30–15:00, 19:00–23:00', website: 'https://example.org/armando', source: 'OpenStreetMap' });
    expect(got[0].why).toBe('Italian · 1 min walk from Pantheon · opens 12:30 · Open 12:30–15:00, 19:00–23:00');
  });

  it('says when hours are not on record rather than calling it open', () => {
    const got = rankMealOptions({ elements: [node(4, 'No Hours Trattoria', near(0.0004, 0.0006), { cuisine: 'italian' })] }, lunch);
    expect(got[0]).toMatchObject({ openKnown: false, openText: null });
    expect(got[0].why).toContain('hours not on record');
  });

  it('nudges a dietary match up and leaves out places already in the trip', () => {
    const got = rankMealOptions(answer, lunch, { hints: ['vegetarian'], existing: [{ title: 'Armando al Pantheon', place: null }] });
    expect(got[0].name).toBe('Green Leaf');
    expect(got[0].diet).toEqual(['vegetarian']);
    expect(got.map((o) => o.name)).not.toContain('Armando al Pantheon');
  });

  it('answers nothing for nothing', () => {
    expect(rankMealOptions(null, lunch)).toEqual([]);
    expect(rankMealOptions({ elements: 'x' }, lunch)).toEqual([]);
  });
});

describe('the cache and the bundle', () => {
  const slots = mealSlots(plan);
  const option = rankMealOptions({ elements: [node(1, 'Armando', near(0.0005, 0.0003), { opening_hours: 'Mo-Su 12:00-15:00' })] }, slots[0]);

  it('serves options only for a meal still where it was asked about', () => {
    const cache: MealCache = { [slots[0].stopId]: { fingerprint: slotFingerprint(slots[0]), options: option, at: new Date().toISOString() } };
    expect(Object.keys(currentOptions(cache, slots))).toEqual([slots[0].stopId]);
    const moved = [{ ...slots[0], anchor: TREVI }];
    expect(currentOptions(cache, moved)).toEqual({});
    expect(staleSlots(cache, slots).map((s) => s.stopId)).toEqual([slots[1].stopId]);
    expect(staleSlots({ [slots[0].stopId]: { ...cache[slots[0].stopId], at: '2026-01-01T00:00:00Z' } }, [slots[0]]).length).toBe(1);
  });

  it('puts options on the meal stops only', () => {
    const decorated = withMealOptions(plan, { [slots[0].stopId]: option });
    const stops = decorated.days[0].stops;
    expect(stops.find((s) => s.id === slots[0].stopId)?.mealOptions).toEqual(option);
    expect(stops.filter((s) => s.mealOptions).length).toBe(1);
  });
});
