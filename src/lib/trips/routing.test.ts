import { describe, expect, it } from 'vitest';
import { sliceMatrix } from './solver';
import { modeSeconds } from './solver/matrix';
import { wireMatrix } from './bundle';
import type { TravelMatrix } from './model';
import { assembleMode, FALLBACK_TTL_MS, legDepartIso, localToIso, matrixBlocks, matrixModes, pairKey, ROUTE_TTL_MS, routeCacheKey, routeStillFresh, timetableDate, zoneOffsetMin } from './routing';

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
    expect(out.cells).toEqual([[0, 0], [1, 0]]);
  });
});

describe('per-cell estimated (a partly routed mode)', () => {
  // a→b routed by ORS, b→a an estimate: one flag per mode said both were guesses.
  const m: TravelMatrix = {
    points: ['a', 'b', 'c'],
    seconds: { walk: [[0, 600, 900], [610, 0, 300], [905, 310, 0]] },
    metres: { walk: [[0, 800, 1200], [810, 0, 400], [1205, 410, 0]] },
    estimated: { walk: true },
    cellEstimated: { walk: [[0, 0, 1], [1, 0, 0], [1, 0, 0]] },
  };

  it("each leg says whether its own pair was routed; without per-cell data the mode's flag holds", () => {
    expect(modeSeconds(m, 'walk', 0, 1)?.estimated).toBe(false);
    expect(modeSeconds(m, 'walk', 1, 0)?.estimated).toBe(true);
    const { cellEstimated: _c, ...coarse } = m;
    expect(modeSeconds(coarse, 'walk', 0, 1)?.estimated).toBe(true);
    expect(modeSeconds({ ...coarse, estimated: { walk: false } }, 'walk', 0, 1)?.estimated).toBe(false);
  });

  it('a day slice keeps the cells; the wire never carries them (the app reads `estimated` as [String: Bool])', () => {
    const s = sliceMatrix(m, ['c', 'a']);
    expect(s.cellEstimated?.walk).toEqual([[0, 1], [1, 0]]);
    expect(modeSeconds(s, 'walk', 0, 1)?.estimated).toBe(true);
    const wire = wireMatrix(m);
    expect(Object.keys(wire).sort()).toEqual(['estimated', 'metres', 'points', 'seconds']);
    expect(wire.estimated).toEqual({ walk: true });
    expect(wireMatrix(null)).toBeNull();
  });
});

describe('timetable times and the route cache', () => {
  const A = { lat: 41.895, lng: 12.4716 };
  const B = { lat: 41.9029, lng: 12.4534 };

  it("a leg is asked about on its own day at the minute it leaves, not 10:00 on the first day", () => {
    // Day 3 of a trip two weeks off, leaving at 16:20 Rome time (CET after the clock change).
    expect(legDepartIso('2026-10-29', 16 * 60 + 20, '2026-10-15', 'Europe/Rome')).toBe('2026-10-29T15:20:00.000Z');
    // Months off: the same weekday soon, still at its own minute.
    expect(legDepartIso('2027-03-04', 8 * 60, '2026-10-15', 'Europe/Rome')).toBe(localToIso(timetableDate('2027-03-04', '2026-10-15'), 8 * 60, 'Europe/Rome'));
  });

  it('a transit route is cached per hour asked about; other modes per places only', () => {
    const nine = '2026-10-29T08:05:00.000Z';
    const nineLater = '2026-10-29T08:55:00.000Z';
    const four = '2026-10-29T15:20:00.000Z';
    expect(routeCacheKey('transit', A, B, nine)).toBe(routeCacheKey('transit', A, B, nineLater));
    expect(routeCacheKey('transit', A, B, nine)).not.toBe(routeCacheKey('transit', A, B, four));
    expect(routeCacheKey('walk', A, B, nine)).toBe(routeCacheKey('walk', A, B, four));
    expect(routeCacheKey('transit', A, B, four)).toBe(`transit|${pairKey(A, B)}|2026-10-29T15`);
  });

  it('a stand-in estimate for a failed lookup is kept an hour, a routed answer a month', () => {
    const at = Date.UTC(2026, 9, 15, 9);
    expect(routeStillFresh(undefined, at)).toBe(false);
    expect(routeStillFresh({ at, fallback: true }, at + FALLBACK_TTL_MS - 1)).toBe(true);
    expect(routeStillFresh({ at, fallback: true }, at + FALLBACK_TTL_MS)).toBe(false);
    expect(routeStillFresh({ at }, at + FALLBACK_TTL_MS * 24)).toBe(true);
    expect(routeStillFresh({ at }, at + ROUTE_TTL_MS)).toBe(false);
    expect(FALLBACK_TTL_MS).toBe(3_600_000);
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
