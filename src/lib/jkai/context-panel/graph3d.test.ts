import { describe, expect, it } from 'vitest';
import { GRAPH_CLASSES, importanceOf, threadNodeClass, toNetGraph } from './graph3d';
import type { DrillGraph } from './types';

describe('threadNodeClass', () => {
  const view = new Set(['entity:a']);
  it('crosses provenance with whether the rail is drawing the node', () => {
    expect(threadNodeClass({ id: 'entity:a', kind: 'concept', provenance: 'known' }, view)).toBe('view-known');
    expect(threadNodeClass({ id: 'entity:a', kind: 'concept', provenance: 'new' }, view)).toBe('view-new');
    expect(threadNodeClass({ id: 'entity:b', kind: 'concept', provenance: 'known' }, view)).toBe('thread-known');
    expect(threadNodeClass({ id: 'entity:b', kind: 'concept', provenance: 'new' }, view)).toBe('thread-new');
  });
  it('gives structural nodes no class — they are not entities', () => {
    expect(threadNodeClass({ id: 'model:x', kind: 'model', provenance: 'thread' }, view)).toBeNull();
  });
});

describe('toNetGraph', () => {
  const graph: DrillGraph = {
    nodes: [
      { id: 'entity:a', name: 'A', type: 'CONCEPT', note: null, mentions: 4, cls: 'view-known' },
      { id: 'entity:b', name: 'B', type: 'PERSON', note: 'who', mentions: 1, cls: 'thread-new' },
    ],
    edges: [
      { source: 'entity:a', target: 'entity:b', verb: 'LEADS', typed: true },
      { source: 'entity:b', target: 'entity:a', verb: 'MENTIONED WITH', typed: false },
    ],
  };
  it('maps mentions into the intel view’s importance range and lifts the on-rail nodes', () => {
    const net = toNetGraph(graph);
    // 5 + sqrt(importance) * 20 > 10 is the view’s label rule: the on-rail node earns a name.
    expect(net.nodes[0].importance).toBeCloseTo(0.22, 5);
    expect(5 + Math.sqrt(net.nodes[0].importance) * 20).toBeGreaterThan(10);
    expect(net.nodes[1].importance).toBeCloseTo(0.055, 5);
    expect(net.nodes[0].degree).toBe(2);
    expect(importanceOf(0, 0, false)).toBeCloseTo(0.02, 5);
  });
  it('carries the class as the one category, with a colour for each class', () => {
    const net = toNetGraph(graph);
    expect(net.nodes[0].categories).toEqual(['view-known']);
    for (const c of GRAPH_CLASSES) expect(net.categoryColours.get(c)).toMatch(/^#[0-9a-f]{6}$/);
    expect(net.counts).toEqual({ 'view-known': 1, 'view-new': 0, 'thread-known': 0, 'thread-new': 1 });
  });
  it('keeps a typed verb as the edge label and drops the co-occurrence one', () => {
    const net = toNetGraph(graph);
    expect(net.edges[0].label).toBe('LEADS');
    expect(net.edges[1].label).toBeNull();
    expect(net.edges[1].weight).toBeLessThan(net.edges[0].weight);
  });
});
