import { describe, expect, it } from 'vitest';
import { assembleMode, localToIso, matrixBlocks, matrixModes, pairKey, timetableDate, zoneOffsetMin } from './routing';

describe('matrixBlocks', () => {
  it('is one request when the points fit', () => {
    expect(matrixBlocks(5, 25)).toEqual([{ coords: [0, 1, 2, 3, 4], sources: [0, 1, 2, 3, 4], destinations: [0, 1, 2, 3, 4] }]);
  });

  it.each([
    [23, 10],
    [60, 25],
    [11, 10],
  ])('covers every ordered pair of %i points under a cap of %i exactly once', (n, cap) => {
    const seen = new Map<string, number>();
    for (const b of matrixBlocks(n, cap)) {
      expect(b.coords.length).toBeLessThanOrEqual(cap);
      for (const s of b.sources) for (const d of b.destinations) {
        const key = `${b.coords[s]}>${b.coords[d]}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(n * n);
    expect([...seen.values()].every((v) => v === 1)).toBe(true);
  });
});

describe('assembleMode', () => {
  it('fills from answers and counts the estimated cells', () => {
    const a = { id: 'a', location: { lat: 1, lng: 1 } };
    const b = { id: 'b', location: { lat: 2, lng: 2 } };
    const answers = new Map([[pairKey(a.location, b.location), { s: 100.4, m: 900 }]]);
    const out = assembleMode([a, b], answers, () => ({ s: 999, m: null }));
    expect(out.seconds).toEqual([[0, 100], [999, 0]]);
    expect(out.metres).toEqual([[0, 900], [null, 0]]);
    expect(out.estimatedCells).toBe(1);
  });
});

describe('time', () => {
  it('converts Rome local time to UTC across the October clock change', () => {
    expect(zoneOffsetMin('Europe/Rome', Date.UTC(2026, 6, 1))).toBe(120);
    expect(localToIso('2026-10-24', 600, 'Europe/Rome')).toBe('2026-10-24T08:00:00.000Z');
    expect(localToIso('2026-10-27', 600, 'Europe/Rome')).toBe('2026-10-27T09:00:00.000Z');
  });

  it('asks a timetable about the trip day when near, else the same weekday next week', () => {
    expect(timetableDate('2026-10-27', '2026-10-13')).toBe('2026-10-27');
    expect(timetableDate('2027-05-04', '2026-10-13')).toBe('2026-10-20'); // both Tuesdays
  });

  it('always carries walk', () => {
    expect(matrixModes(['transit', 'cycle'])).toEqual(['walk', 'cycle', 'transit']);
  });
});
