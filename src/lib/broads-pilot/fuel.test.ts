import { describe, it, expect } from 'vitest';
import { lph, routeFuel } from './fuel';
import { groundSpeedMs } from './passability';
import type { RouteLeg, GraphEdge } from './types';

const edge = (over: Partial<GraphEdge> & { id: string }): GraphEdge => ({
  from: 'a',
  to: 'b',
  length_m: 1000,
  limit_mph: 5,
  river: 'Bure',
  way_id: 1,
  geometry: [],
  restriction_ids: [],
  ...over,
});

describe('lph', () => {
  it('lph(3) ≈ 0.65', () => expect(lph(3)).toBeCloseTo(0.65, 2));
  it('lph(5) ≈ 1.19', () => expect(lph(5)).toBeCloseTo(1.19, 2));
  it('lph(6) ≈ 1.70', () => expect(lph(6)).toBeCloseTo(1.7, 2));
});

describe('routeFuel', () => {
  const leg = (edges: GraphEdge[]): RouteLeg => ({
    edges,
    distance_m: edges.reduce((s, e) => s + e.length_m, 0),
    time_s: 0,
    bridges: [],
    crossesBreydon: false,
  });

  it('zero litres and cost for an empty leg', () => {
    const f = routeFuel(leg([]));
    expect(f.litres).toBe(0);
    expect(f.cost).toBe(0);
  });

  it('matches hand-computed litres for one edge', () => {
    const e = edge({ id: 'e', length_m: 1000, limit_mph: 5 });
    const v = Math.min(5, 6);
    const hours = e.length_m / (groundSpeedMs(v) * 0.9) / 3600;
    const expected = hours * lph(v);
    const f = routeFuel(leg([e]));
    expect(f.litres).toBeCloseTo(expected, 6);
  });

  it('caps the speed used at 6 mph', () => {
    const e = edge({ id: 'e', length_m: 1000, limit_mph: 12 });
    const v = 6;
    const hours = e.length_m / (groundSpeedMs(v) * 0.9) / 3600;
    const expected = hours * lph(v);
    expect(routeFuel(leg([e])).litres).toBeCloseTo(expected, 6);
  });

  it('sums litres across edges and applies the price', () => {
    const edges = [
      edge({ id: 'e1', length_m: 1000, limit_mph: 5 }),
      edge({ id: 'e2', length_m: 2000, limit_mph: 4 }),
    ];
    const f = routeFuel(leg(edges), 2.0);
    const litres = edges.reduce((s, e) => {
      const v = Math.min(e.limit_mph, 6);
      const hours = e.length_m / (groundSpeedMs(v) * 0.9) / 3600;
      return s + hours * lph(v);
    }, 0);
    expect(f.litres).toBeCloseTo(litres, 6);
    expect(f.cost).toBeCloseTo(litres * 2.0, 6);
  });

  it('defaults price to 1.6 £/L', () => {
    const e = edge({ id: 'e', length_m: 5000, limit_mph: 5 });
    const f = routeFuel(leg([e]));
    expect(f.cost).toBeCloseTo(f.litres * 1.6, 6);
  });
});
