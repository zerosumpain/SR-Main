import { describe, it, expect } from 'vitest';
import { route, reachable } from './router';
import { groundSpeedMs } from './passability';
import type { WaterGraph, GraphEdge, Restrictions, Boat, Bridge } from './types';

const edge = (over: Partial<GraphEdge> & { id: string; from: string; to: string }): GraphEdge => ({
  length_m: 100,
  limit_mph: 5,
  river: 'Bure',
  way_id: 1,
  geometry: [],
  restriction_ids: [],
  ...over,
});

const lowBridge: Bridge = {
  id: 'low',
  name: 'Low Bridge',
  river: 'Bure',
  clearance_ahw_m: 2.0,
  clearance_band_m: [2.0, 2.0],
  tide_dependent: false,
  pilot: null,
  opens_on_request: false,
  notes: '',
  lat: 52.65,
  lng: 1.5,
};

const restrictions: Restrictions = {
  bridges: [lowBridge],
  lock: {
    id: 'l', name: 'lock', max_loa_m: 0, max_beam_m: 0, max_draft_m: 0,
    hours: '', booking: '', notes: '', lat: 0, lng: 0,
  },
  zones: [],
};

const boat = (over: Partial<Boat> = {}): Boat => ({
  slug: 'generic', name: 'Generic', class: 'generic', propulsion: 'diesel',
  sleeps: 4, air_draft_ft: 0, air_draft_m: 3.0, bridges_blocked: [], ...over,
});

// Fixture graph:
//   a --(short, gated by lowBridge)-- b      length 100
//   a --(long, clear)-- d --(long, clear)-- b   lengths 300 + 300
// A tall boat (air 3.0) is blocked by lowBridge (clear 2.0). It must detour a→d→b.
const graph: WaterGraph = {
  nodes: [
    { id: 'a', lat: 52.6, lng: 1.5 },
    { id: 'b', lat: 52.7, lng: 1.5 },
    { id: 'd', lat: 52.6, lng: 1.6 },
  ],
  edges: [
    edge({ id: 'ab', from: 'a', to: 'b', length_m: 100, restriction_ids: ['low'] }),
    edge({ id: 'ad', from: 'a', to: 'd', length_m: 300 }),
    edge({ id: 'db', from: 'd', to: 'b', length_m: 300 }),
  ],
};

const timeFor = (length_m: number, limit_mph: number) =>
  length_m / (groundSpeedMs(Math.min(limit_mph, 6)) * 0.9);

describe('route', () => {
  it('takes the clear detour when the short edge is blocked', () => {
    const leg = route(graph, restrictions, boat(), 'a', 'b');
    expect(leg.edges.map((e) => e.id)).toEqual(['ad', 'db']);
    expect(leg.distance_m).toBe(600);
    expect(leg.blockedAt ?? null).toBeNull();
  });

  it('takes the short edge for a low boat that clears the bridge', () => {
    const leg = route(graph, restrictions, boat({ air_draft_m: 1.5 }), 'a', 'b');
    expect(leg.edges.map((e) => e.id)).toEqual(['ab']);
    expect(leg.distance_m).toBe(100);
  });

  it('computes time_s from the speed formula', () => {
    const leg = route(graph, restrictions, boat(), 'a', 'b');
    const expected = timeFor(300, 5) + timeFor(300, 5);
    expect(leg.time_s).toBeCloseTo(expected, 3);
  });

  it('caps speed at 6mph even on a faster edge', () => {
    const g: WaterGraph = {
      nodes: [
        { id: 'a', lat: 52.6, lng: 1.5 },
        { id: 'b', lat: 52.7, lng: 1.5 },
      ],
      edges: [edge({ id: 'ab', from: 'a', to: 'b', length_m: 600, limit_mph: 10 })],
    };
    const leg = route(g, restrictions, boat({ air_draft_m: 1.5 }), 'a', 'b');
    expect(leg.time_s).toBeCloseTo(timeFor(600, 6), 3);
  });

  it('flags crossesBreydon when the path uses a breydon edge', () => {
    const g: WaterGraph = {
      nodes: [
        { id: 'a', lat: 52.6, lng: 1.5 },
        { id: 'b', lat: 52.7, lng: 1.5 },
      ],
      edges: [edge({ id: 'ab', from: 'a', to: 'b', length_m: 100, tidal_zone: 'breydon' })],
    };
    const leg = route(g, restrictions, boat({ air_draft_m: 1.5 }), 'a', 'b');
    expect(leg.crossesBreydon).toBe(true);
  });

  it('lists non-pass bridges first in the bridges array', () => {
    // path a→b uses an edge gated by both a clear bridge and a marginal bridge
    const clear: Bridge = { ...lowBridge, id: 'clear', clearance_band_m: [5, 5] };
    const marg: Bridge = { ...lowBridge, id: 'marg', clearance_band_m: [3.1, 3.1] };
    const r: Restrictions = { ...restrictions, bridges: [clear, marg] };
    const g: WaterGraph = {
      nodes: [
        { id: 'a', lat: 52.6, lng: 1.5 },
        { id: 'b', lat: 52.7, lng: 1.5 },
      ],
      edges: [edge({ id: 'ab', from: 'a', to: 'b', restriction_ids: ['clear', 'marg'] })],
    };
    const leg = route(g, r, boat({ air_draft_m: 3.0 }), 'a', 'b');
    expect(leg.bridges[0].verdict).toBe('marginal');
    expect(leg.bridges[0].bridge.id).toBe('marg');
  });

  it('returns empty edges + blockedAt for an unreachable target', () => {
    // Only path a→b is via the low bridge; no detour exists.
    const g: WaterGraph = {
      nodes: [
        { id: 'a', lat: 52.6, lng: 1.5 },
        { id: 'b', lat: 52.7, lng: 1.5 },
      ],
      edges: [edge({ id: 'ab', from: 'a', to: 'b', restriction_ids: ['low'] })],
    };
    const leg = route(g, restrictions, boat(), 'a', 'b');
    expect(leg.edges).toEqual([]);
    expect(leg.distance_m).toBe(0);
    expect(leg.time_s).toBe(0);
    expect(leg.blockedAt?.id).toBe('low');
  });

  it('blockedAt is null when even allow-blocked routing cannot connect', () => {
    const g: WaterGraph = {
      nodes: [
        { id: 'a', lat: 52.6, lng: 1.5 },
        { id: 'island', lat: 53, lng: 2 },
      ],
      edges: [],
    };
    const leg = route(g, restrictions, boat(), 'a', 'island');
    expect(leg.edges).toEqual([]);
    expect(leg.blockedAt ?? null).toBeNull();
  });

  it('trivially returns empty leg when from === to', () => {
    const leg = route(graph, restrictions, boat({ air_draft_m: 1.5 }), 'a', 'a');
    expect(leg.edges).toEqual([]);
    expect(leg.distance_m).toBe(0);
    expect(leg.time_s).toBe(0);
  });
});

describe('reachable', () => {
  it('records nodes within the time budget, through non-blocked edges only', () => {
    // tall boat: a→b via low bridge is blocked; a→d→b clear.
    const budget = timeFor(300, 5) + 1; // enough to reach d, not b (needs 2 legs)
    const map = reachable(graph, restrictions, boat(), 'a', budget);
    expect(map.has('a')).toBe(true);
    expect(map.get('a')!.time_s).toBe(0);
    expect(map.has('d')).toBe(true);
    expect(map.has('b')).toBe(false); // b needs ~2× the budget via the detour
  });

  it('reaches all clear nodes given a generous budget', () => {
    const map = reachable(graph, restrictions, boat(), 'a', 1e9);
    expect(new Set(map.keys())).toEqual(new Set(['a', 'd', 'b']));
    expect(map.get('d')!.dist_m).toBe(300);
    expect(map.get('b')!.dist_m).toBe(600);
  });

  it('does not expand through blocked edges', () => {
    // Low boat can use the short edge; budget only enough for the short edge.
    const budget = timeFor(100, 5) + 1;
    const map = reachable(graph, restrictions, boat({ air_draft_m: 1.5 }), 'a', budget);
    expect(map.has('b')).toBe(true);
    expect(map.get('b')!.dist_m).toBe(100);
  });
});
