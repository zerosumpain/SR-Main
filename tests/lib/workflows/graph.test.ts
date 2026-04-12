import { describe, it, expect } from 'vitest';
import { buildGraph, topologicalSort } from '$lib/workflows/graph';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

function makeNode(id: string, type = 'transform'): WorkflowNodeDef {
  return { id, type, position: { x: 0, y: 0 }, config: {}, label: id };
}

function makeEdge(source: string, target: string): WorkflowEdgeDef {
  return { id: `${source}-${target}`, sourceNodeId: source, targetNodeId: target };
}

describe('buildGraph', () => {
  it('creates adjacency list from nodes and edges', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);

    expect(graph.adjacency.get('a')).toEqual(['b']);
    expect(graph.adjacency.get('b')).toEqual(['c']);
    expect(graph.adjacency.get('c')).toEqual([]);
  });

  it('tracks incoming edges per node', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'c'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);

    expect(graph.incomingCount.get('a')).toBe(0);
    expect(graph.incomingCount.get('b')).toBe(0);
    expect(graph.incomingCount.get('c')).toBe(2);
  });

  it('indexes edges by source node', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const graph = buildGraph(nodes, edges);

    expect(graph.edgesBySource.get('a')?.[0].targetNodeId).toBe('b');
  });
});

describe('topologicalSort', () => {
  it('returns nodes in dependency order', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);
    const sorted = topologicalSort(graph);

    expect(sorted).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups parallel nodes in the same level', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const graph = buildGraph(nodes, edges);
    const sorted = topologicalSort(graph);

    expect(sorted[0]).toEqual(['a']);
    expect(sorted[1].sort()).toEqual(['b', 'c']);
    expect(sorted[2]).toEqual(['d']);
  });

  it('handles single node with no edges', () => {
    const nodes = [makeNode('a')];
    const graph = buildGraph(nodes, []);
    const sorted = topologicalSort(graph);

    expect(sorted).toEqual([['a']]);
  });

  it('throws on cycle', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
    const graph = buildGraph(nodes, edges);

    expect(() => topologicalSort(graph)).toThrow('cycle');
  });
});
