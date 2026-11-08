import { describe, expect, it } from 'vitest';
import {
  countWord,
  dateSpan,
  dayCount,
  firstChanges,
  sketchPoints,
  splitTrips,
  stampDate,
  tripName,
  weekday,
  whenFrom,
} from './notes';

describe('tripName', () => {
  it('keeps a real title', () => {
    expect(
      tripName({ title: 'Rome in October', destination: 'Rome, Italy' }),
    ).toEqual({ name: 'Rome in October', named: true });
  });
  it('names a placeholder trip after its destination', () => {
    expect(tripName({ title: 'New trip', destination: 'Rome, Italy' })).toEqual(
      { name: 'Rome', named: false },
    );
    expect(tripName({ title: '', destination: '' })).toEqual({
      name: 'A trip',
      named: false,
    });
  });
});

describe('dates', () => {
  it('counts days inclusively', () => {
    expect(dayCount('2026-10-27', '2026-10-30')).toBe(4);
    expect(dayCount('2026-10-30', '2026-10-27')).toBe(0);
    expect(dayCount('2026-10-30', '2026-11-02')).toBe(4);
  });
  it('writes spans as a person does', () => {
    expect(dateSpan('2026-10-27', '2026-10-30')).toBe('27–30 Oct');
    expect(dateSpan('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov');
    expect(dateSpan('2026-10-28', '2026-10-28')).toBe('28 Oct');
    expect(stampDate('2026-11-02')).toBe('2 Nov');
    expect(weekday('2026-10-27')).toBe('Tuesday');
  });
  it('says how far away a trip is', () => {
    expect(whenFrom('2026-10-27', '2026-10-30', '2026-10-16')).toBe(
      'in 11 days',
    );
    expect(whenFrom('2026-10-27', '2026-10-30', '2026-10-28')).toBe(
      'under way',
    );
    expect(whenFrom('2026-10-27', '2026-10-30', '2026-10-26')).toBe('tomorrow');
    expect(whenFrom('2026-10-27', '2026-10-30', '2026-11-05')).toBe('been');
    expect(whenFrom('2026-12-20', '2026-12-22', '2026-10-16')).toBe(
      'in 2 months',
    );
  });
  it('words small counts', () => {
    expect(countWord(4)).toBe('four');
    expect(countWord(14)).toBe('14');
  });
});

describe('splitTrips', () => {
  it('puts trips to come soonest first and past trips latest first', () => {
    const trips = [
      { id: 'a', startDate: '2026-11-12', endDate: '2026-11-14' },
      { id: 'b', startDate: '2026-10-27', endDate: '2026-10-30' },
      { id: 'c', startDate: '2026-06-01', endDate: '2026-06-03' },
      { id: 'd', startDate: '2026-08-01', endDate: '2026-08-03' },
      { id: 'e', startDate: '2026-10-14', endDate: '2026-10-17' },
    ];
    const { ahead, been } = splitTrips(trips, '2026-10-16');
    expect(ahead.map((t) => t.id)).toEqual(['e', 'b', 'a']);
    expect(been.map((t) => t.id)).toEqual(['d', 'c']);
  });
});

describe('firstChanges', () => {
  it('cuts the list and counts the rest', () => {
    expect(firstChanges(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toEqual({
      shown: ['a', 'b', 'c', 'd'],
      more: 2,
    });
    expect(firstChanges(['a'], 4)).toEqual({ shown: ['a'], more: 0 });
  });
});

describe('sketchPoints', () => {
  it('fits the points inside the padding', () => {
    const pts = sketchPoints(
      [
        { lat: 41.9, lng: 12.45 },
        { lat: 41.89, lng: 12.49 },
        { lat: 41.91, lng: 12.48 },
      ],
      400,
      300,
      20,
    );
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(380);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(280);
    }
    // North is up: the most northerly stop has the smallest y.
    expect(pts[2].y).toBeLessThan(pts[1].y);
    // West is left.
    expect(pts[0].x).toBeLessThan(pts[1].x);
  });
  it('centres a single point', () => {
    expect(sketchPoints([{ lat: 1, lng: 2 }], 100, 50, 5)).toEqual([
      { x: 50, y: 25 },
    ]);
  });
  it('returns nothing for no points', () => {
    expect(sketchPoints([], 100, 50, 5)).toEqual([]);
  });
});
