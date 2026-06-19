import { describe, it, expect } from 'vitest';
import { buildAdjacency, nearestNode } from './graph';
import type { WaterGraph, GraphEdge } from './types';

const edge = (id: string, from: string, to: string): GraphEdge => ({
  id,
  from,
  to,
  length_m: 100,
  limit_mph: 5,
  river: 'Bure',
  way_id: 1,
  geometry: [],
  restriction_ids: [],
});

// 3-node fixture: a—b—c
const graph: WaterGraph = {
  nodes: [
    { id: 'a', lat: 52.6, lng: 1.5 },
    { id: 'b', lat: 52.7, lng: 1.5 },
    { id: 'c', lat: 52.8, lng: 1.5 },
  ],
  edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')],
};

describe('buildAdjacency', () => {
  it('is bidirectional — each edge appears for both directions', () => {
    const adj = buildAdjacency(graph);
    expect(adj.get('a')?.map((e) => e.to).sort()).toEqual(['b']);
    expect(adj.get('b')?.map((e) => e.to).sort()).toEqual(['a', 'c']);
    expect(adj.get('c')?.map((e) => e.to).sort()).toEqual(['b']);
  });
  it('carries the underlying edge object', () => {
    const adj = buildAdjacency(graph);
    const fromA = adj.get('a')!;
    expect(fromA[0].edge.id).toBe('ab');
  });
  it('includes nodes with no edges (empty list)', () => {
    const g: WaterGraph = {
      nodes: [...graph.nodes, { id: 'lonely', lat: 53, lng: 1 }],
      edges: graph.edges,
    };
    const adj = buildAdjacency(g);
    expect(adj.get('lonely')).toEqual([]);
  });
});

describe('nearestNode', () => {
  it('returns the id of the closest node by haversine', () => {
    expect(nearestNode(graph, 52.61, 1.5)).toBe('a');
    expect(nearestNode(graph, 52.71, 1.5)).toBe('b');
    expect(nearestNode(graph, 52.79, 1.5)).toBe('c');
  });
});
