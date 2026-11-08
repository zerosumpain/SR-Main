import { describe, expect, it } from 'vitest';
import { estimateLeg, estimateMatrix, haversineM } from './estimate';
import { chooseLeg, makeContext, sliceMatrix } from './matrix';
import { makeTrip } from './fixtures/build';

const PANTHEON = { lat: 41.8986, lng: 12.4769 };
const COLOSSEUM = { lat: 41.8902, lng: 12.4922 };

describe('estimates', () => {
  it('measures great-circle distance', () => {
    expect(haversineM(PANTHEON, COLOSSEUM)).toBeGreaterThan(1500);
    expect(haversineM(PANTHEON, COLOSSEUM)).toBeLessThan(1600);
    expect(haversineM(PANTHEON, PANTHEON)).toBe(0);
  });

  it('times each mode with the documented factors', () => {
    const walk = estimateLeg(PANTHEON, COLOSSEUM, 'walk');
    const transit = estimateLeg(PANTHEON, COLOSSEUM, 'transit');
    expect(walk.metres).toBe(Math.round(haversineM(PANTHEON, COLOSSEUM) * 1.3));
    expect(walk.seconds).toBe(Math.round(walk.metres / (4800 / 3600)));
    expect(transit.seconds).toBe(Math.round(walk.metres / (18000 / 3600) + 900));
  });

  it('a transit hop past 10 km is a train after the first 10 km: the airport run is about 70 min, not 111', () => {
    const NAVONA = { lat: 41.8986, lng: 12.4731 };
    const FIUMICINO = { lat: 41.8003, lng: 12.2389 };
    const leg = estimateLeg(NAVONA, FIUMICINO, 'transit');
    expect(leg.seconds).toBe(Math.round(10_000 / (18000 / 3600) + (leg.metres - 10_000) / (50000 / 3600) + 900));
    expect(leg.seconds / 60).toBeGreaterThan(60);
    expect(leg.seconds / 60).toBeLessThan(80);
  });

  it('builds a full matrix, always with walk, marked estimated', () => {
    const m = estimateMatrix(
      [
        { id: 'a', location: PANTHEON },
        { id: 'b', location: COLOSSEUM },
      ],
      ['drive'],
    );
    expect(Object.keys(m.seconds)).toEqual(['walk', 'drive']);
    expect(m.estimated).toEqual({ walk: true, drive: true });
    expect(m.seconds.walk?.[0][0]).toBe(0);
    expect(m.seconds.walk?.[0][1]).toBe(m.seconds.walk?.[1][0]);
    const s = sliceMatrix(m, ['b', 'missing']);
    expect(s.points).toEqual(['b']);
    expect(s.seconds.drive).toEqual([[0]]);
  });
});

describe('leg mode rule', () => {
  const points = [
    { id: 'near', location: PANTHEON },
    { id: 'trevi', location: { lat: 41.9009, lng: 12.4833 } },
    { id: 'far', location: COLOSSEUM },
    { id: 'very-far', location: { lat: 41.9065, lng: 12.4536 } },
  ];

  it('walks when the walk is within the pace limit', () => {
    const ctx = makeContext(
      makeTrip('2026-10-27', '2026-10-27'),
      [],
      [],
      estimateMatrix(points, ['transit']),
    );
    expect(chooseLeg(ctx, 'near', 'trevi').mode).toBe('walk'); // ~9 min on foot; transit is slower anyway
    expect(chooseLeg(ctx, 'near', 'far').mode).toBe('transit'); // ~26 min on foot, over the 25 min limit
  });

  it('takes the fastest allowed mode when the walk is too long', () => {
    const ctx = makeContext(
      makeTrip('2026-10-27', '2026-10-27'),
      [],
      [],
      estimateMatrix(points, ['transit']),
    );
    const leg = chooseLeg(ctx, 'far', 'very-far');
    expect(leg.mode).toBe('transit');
    expect(leg.estimated).toBe(true);
    expect(leg.distanceM).toBeGreaterThan(0);
  });

  it('ignores modes the trip does not allow, and null routes', () => {
    const matrix = estimateMatrix(points, ['transit', 'drive']);
    const ctx = makeContext(makeTrip('2026-10-27', '2026-10-27', { modes: ['walk'] }), [], [], matrix);
    expect(chooseLeg(ctx, 'far', 'very-far').mode).toBe('walk');
    const noTransit = {
      ...matrix,
      seconds: { ...matrix.seconds, transit: matrix.seconds.transit?.map((r) => r.map(() => null)) },
    };
    const ctx2 = makeContext(
      makeTrip('2026-10-27', '2026-10-27', { modes: ['transit', 'drive'] }),
      [],
      [],
      noTransit,
    );
    expect(chooseLeg(ctx2, 'far', 'very-far').mode).toBe('drive');
  });

  it('estimates a walk from coordinates when the matrix has no route', () => {
    const wishes = points.map((p) => ({ id: p.id, place: { location: p.location } })) as never;
    const empty = { points: [], seconds: {}, metres: {}, estimated: {} };
    const ctx = makeContext(makeTrip('2026-10-27', '2026-10-27'), [], wishes, empty);
    const leg = chooseLeg(ctx, 'near', 'far');
    expect(leg).toMatchObject({ mode: 'walk', estimated: true });
    expect(leg.durationSec).toBe(estimateLeg(PANTHEON, COLOSSEUM, 'walk').seconds);
  });
});
