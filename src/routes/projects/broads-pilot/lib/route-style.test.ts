import { describe, it, expect } from 'vitest';
import { styleRoute, bandColor, speedDash, TIME_BANDS, PASSED_COLOR } from './route-style';
import type { GraphEdge } from '$lib/broads-pilot/types';

// A straight-line edge of `len` metres at `mph`, from [0,0] heading east along
// a fixed latitude. Geometry is two points; length_m drives the timing.
const edge = (id: string, len: number, mph: number, lat0 = 52.6, lng0 = 1.5, lng1 = 1.51): GraphEdge => ({
  id,
  from: `${id}-a`,
  to: `${id}-b`,
  length_m: len,
  limit_mph: mph,
  river: 'Bure',
  way_id: 1,
  geometry: [
    [lat0, lng0],
    [lat0, lng1],
  ],
  restriction_ids: [],
});

describe('bandColor', () => {
  it('buckets into 5 one-hour bands, last band open-ended', () => {
    expect(bandColor(0)).toBe(TIME_BANDS[0].color); // start
    expect(bandColor(0.5 * 3600)).toBe(TIME_BANDS[0].color); // 30 min → ≤1h
    expect(bandColor(1 * 3600)).toBe(TIME_BANDS[0].color); // exactly 1h is inclusive
    expect(bandColor(1.5 * 3600)).toBe(TIME_BANDS[1].color); // 1–2h
    expect(bandColor(2.5 * 3600)).toBe(TIME_BANDS[2].color); // 2–3h
    expect(bandColor(3.5 * 3600)).toBe(TIME_BANDS[3].color); // 3–4h
    expect(bandColor(9 * 3600)).toBe(TIME_BANDS[4].color); // 4h+
  });
});

describe('speedDash', () => {
  it('is solid at 6 mph and progressively more broken below', () => {
    expect(speedDash(6)).toBeUndefined(); // open water → solid
    expect(speedDash(7)).toBeUndefined();
    expect(speedDash(5)).toBe('14 7'); // long dash
    expect(speedDash(4)).toBe('7 7'); // short dash
    expect(speedDash(3)).toBe('2 7'); // dotted
    expect(speedDash(2)).toBe('2 7'); // anything below 3 is also dotted
  });
});

describe('styleRoute — from start (planning)', () => {
  it('accumulates time across legs and marks nothing passed', () => {
    // 5 mph ≈ 2.2352 m/s ground speed; edgeTimeS divides by 0.9 factor.
    const legs = [{ edges: [edge('e1', 1000, 5), edge('e2', 1000, 5)] }];
    const styled = styleRoute(legs);
    expect(styled).toHaveLength(2);
    expect(styled[0].t0).toBe(0);
    expect(styled[0].passed).toBe(false);
    expect(styled[1].passed).toBe(false);
    // monotonically increasing cumulative time
    expect(styled[0].t1).toBeGreaterThan(0);
    expect(styled[1].t0).toBeCloseTo(styled[0].t1, 6);
    expect(styled[1].midT).toBeGreaterThan(styled[0].midT);
  });

  it('flattens multiple legs in order', () => {
    const legs = [{ edges: [edge('a', 500, 5)] }, { edges: [edge('b', 500, 5)] }];
    const styled = styleRoute(legs);
    expect(styled.map((s) => s.edge.id)).toEqual(['a', 'b']);
    expect(styled[1].t0).toBeCloseTo(styled[0].t1, 6);
  });

  it('skips empty (blocked) legs without throwing', () => {
    const legs = [{ edges: [] }, { edges: [edge('a', 500, 5)] }];
    const styled = styleRoute(legs);
    expect(styled).toHaveLength(1);
    expect(styled[0].edge.id).toBe('a');
  });
});

describe('styleRoute — from a live position (cruising)', () => {
  it('zeroes the clock at the nearest edge and marks earlier edges passed', () => {
    // three edges marching east; place `from` on the middle edge's longitude.
    const legs = [
      { edges: [edge('e1', 1000, 5, 52.6, 1.50, 1.51), edge('e2', 1000, 5, 52.6, 1.51, 1.52), edge('e3', 1000, 5, 52.6, 1.52, 1.53)] },
    ];
    const styled = styleRoute(legs, { from: [52.6, 1.515] });
    expect(styled[0].passed).toBe(true); // behind the boat
    expect(styled[1].passed).toBe(false); // the pivot edge
    expect(styled[2].passed).toBe(false);
    expect(styled[1].t0).toBe(0); // clock resets at the pivot
    expect(styled[2].t0).toBeGreaterThan(0);
  });

  it('with from === start behaves like from-start (pivot at 0)', () => {
    const legs = [{ edges: [edge('e1', 1000, 5, 52.6, 1.50, 1.51), edge('e2', 1000, 5, 52.6, 1.51, 1.52)] }];
    const styled = styleRoute(legs, { from: [52.6, 1.50] });
    expect(styled[0].passed).toBe(false);
    expect(styled[0].t0).toBe(0);
  });

  it('credits the already-cruised fraction of the pivot edge', () => {
    // single long edge; boat sits ~75% along it (lng 1.5075 of a 1.50→1.51 span).
    const legs = [{ edges: [edge('e1', 2000, 5, 52.6, 1.50, 1.51), edge('e2', 2000, 5, 52.6, 1.51, 1.52)] }];
    const full = styleRoute(legs); // from start
    const live = styleRoute(legs, { from: [52.6, 1.5075] });
    // pivot is e1; only ~25% of it should remain ahead of the boat
    expect(live[0].t1).toBeLessThan(full[0].t1 * 0.5);
    expect(live[0].t1).toBeGreaterThan(0);
    // downstream edge's clock is pulled in by the credited stretch
    expect(live[1].t0).toBeCloseTo(live[0].t1, 6);
    expect(live[1].t0).toBeLessThan(full[1].t0);
  });
});

describe('PASSED_COLOR', () => {
  it('is a warm grey, distinct from every band colour', () => {
    expect(TIME_BANDS.map((b) => b.color)).not.toContain(PASSED_COLOR);
  });
});
