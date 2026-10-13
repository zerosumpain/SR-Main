import { describe, expect, it } from 'vitest';
import { bundleEtag, canonicalJson, daySubMatrix, etagMatches } from './bundle';
import type { PlannedDay, TravelMatrix } from './model';

const matrix: TravelMatrix = {
  points: ['stay:s1', 'a', 'b', 'c'],
  seconds: { walk: [[0, 1, 2, 3], [4, 0, 5, 6], [7, 8, 0, 9], [10, 11, 12, 0]] },
  metres: { walk: [[0, 10, 20, 30], [40, 0, 50, 60], [70, 80, 0, 90], [100, 110, 120, 0]] },
  estimated: { walk: true },
};

const day: PlannedDay = {
  date: '2026-10-27',
  stayId: 's1',
  stops: [
    { id: 'stay:2026-10-27:start', kind: 'stay', wishId: null, title: 'Flat', location: null, arriveMin: 540, departMin: 540, waitSec: 0, locked: true, bookingId: null, warnings: [] },
    { id: 'c', kind: 'wish', wishId: 'c', title: 'C', location: null, arriveMin: 560, departMin: 600, waitSec: 0, locked: false, bookingId: null, warnings: [] },
    { id: 'a', kind: 'wish', wishId: 'a', title: 'A', location: null, arriveMin: 620, departMin: 680, waitSec: 0, locked: false, bookingId: null, warnings: [] },
  ],
  legs: [],
  warnings: [],
};

describe('daySubMatrix', () => {
  it('cuts the day stay and its stops out of the trip matrix, in day order', () => {
    const sub = daySubMatrix(matrix, day);
    expect(sub.points).toEqual(['stay:s1', 'c', 'a']);
    expect(sub.seconds.walk).toEqual([[0, 3, 1], [10, 0, 11], [4, 6, 0]]);
    expect(sub.metres.walk?.[1]).toEqual([100, 0, 110]);
    expect(sub.estimated.walk).toBe(true);
  });
});

describe('etag', () => {
  it('is the same for the same content in any key order, and changes with it', () => {
    const a = { trip: { id: 't', title: 'x' }, n: [1, 2] };
    const b = { n: [1, 2], trip: { title: 'x', id: 't' } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    const tagA = bundleEtag(a as never);
    expect(tagA).toBe(bundleEtag(b as never));
    expect(bundleEtag({ ...a, n: [2, 1] } as never)).not.toBe(tagA);
    expect(tagA).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it('matches If-None-Match lists, weak tags and *', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc", "def"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"nope"', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
  });
});
