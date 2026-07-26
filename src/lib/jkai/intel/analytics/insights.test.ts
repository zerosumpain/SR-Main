import { describe, it, expect } from 'vitest';
import { buildIndex, type GraphSnapshot, type GraphNode } from './model';
import { computeCentrality } from './centrality';
import { detectCommunities } from './community';
import { generateInsights } from './insights';
import type { GraphAnalysis } from './load';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

let seq = 0;
function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id.toUpperCase(),
    typeId: 'type-person',
    typeName: 'person',
    icon: '👤',
    color: '#fff',
    summary: null,
    confidence: 'high',
    confirmed: true,
    createdAt: NOW - 400 * DAY,
    updatedAt: NOW - 400 * DAY,
    noteCount: 3,
    lastSeenAt: NOW - 5 * DAY,
    ...over,
  };
}
function edge(a: string, b: string) {
  return {
    id: `e${seq++}`,
    source: a,
    target: b,
    type: 'knows',
    label: null,
    confidence: 'high',
    strength: 'moderate',
    createdAt: NOW - 100 * DAY,
  };
}

function analyse(snapshot: GraphSnapshot, embeddings = new Map<string, number[]>()): GraphAnalysis {
  const index = buildIndex(snapshot);
  return {
    snapshot,
    index,
    centrality: computeCentrality(index),
    community: detectCommunities(index),
    embeddings,
    computedAt: NOW,
  };
}

/** Two triangles joined only through b–c. */
function barbell(over: Record<string, Partial<GraphNode>> = {}): GraphSnapshot {
  return {
    nodes: ['a', 'b', 'x', 'c', 'd', 'y'].map((n) => node(n, over[n] ?? {})),
    edges: [
      edge('a', 'b'), edge('a', 'x'), edge('b', 'x'),
      edge('c', 'd'), edge('c', 'y'), edge('d', 'y'),
      edge('b', 'c'),
    ],
  };
}

describe('generateInsights', () => {
  it('returns findings sorted by score descending', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    for (let i = 1; i < insights.length; i++) {
      expect(insights[i - 1].score).toBeGreaterThanOrEqual(insights[i].score);
    }
  });

  it('flags the broker joining two clusters', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    const broker = insights.find((i) => i.kind === 'broker');
    expect(broker).toBeDefined();
    expect(['b', 'c']).toContain(broker!.entityIds[0]);
    expect(broker!.action).toBe('research');
    expect(broker!.actionPayload).not.toBe('');
  });

  it('flags the cross-cluster edge as an unlikely relation', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    const unlikely = insights.find((i) => i.kind === 'unlikely_relation');
    expect(unlikely).toBeDefined();
    expect(unlikely!.entityIds).toHaveLength(2);
    expect(unlikely!.action).toBe('ask');
  });

  it('reports orphans once a few accumulate', () => {
    const snapshot = barbell();
    snapshot.nodes.push(node('o1'), node('o2'), node('o3'));
    const insights = generateInsights(analyse(snapshot), NOW);
    const orphan = insights.find((i) => i.kind === 'orphan');
    expect(orphan).toBeDefined();
    expect(orphan!.title).toContain('3 entities');
  });

  it('stays quiet about one or two orphans', () => {
    const snapshot = barbell();
    snapshot.nodes.push(node('o1'));
    expect(generateInsights(analyse(snapshot), NOW).find((i) => i.kind === 'orphan')).toBeUndefined();
  });

  it('flags a disconnected island of three or more', () => {
    const snapshot = barbell();
    snapshot.nodes.push(node('i1'), node('i2'), node('i3'));
    snapshot.edges.push(edge('i1', 'i2'), edge('i2', 'i3'));
    const insights = generateInsights(analyse(snapshot), NOW);
    const isolated = insights.find((i) => i.kind === 'isolated_cluster');
    expect(isolated).toBeDefined();
    expect(isolated!.title).toContain('3-entity cluster');
  });

  /**
   * Barbell (old, moderately connected) plus 14 newer but peripheral nodes, so
   * the recency and degree percentiles both have something to bite on. Nothing
   * here is BOTH new and well connected — that is what the tests add.
   */
  function populated(): GraphSnapshot {
    const snapshot = barbell();
    for (let i = 0; i < 14; i++) {
      snapshot.nodes.push(node(`f${i}`, { createdAt: NOW - (100 - i) * DAY }));
      if (i % 2 === 1) snapshot.edges.push(edge(`f${i - 1}`, `f${i}`));
    }
    return snapshot;
  }

  it('flags a recently created, already well-connected entity', () => {
    const snapshot = populated();
    snapshot.nodes.push(node('new', { createdAt: NOW - 1 * DAY }));
    for (const n of ['a', 'b', 'x', 'c', 'd', 'y']) snapshot.edges.push(edge('new', n));
    const insights = generateInsights(analyse(snapshot), NOW);
    const emerging = insights.find((i) => i.kind === 'emerging_hub');
    expect(emerging).toBeDefined();
    expect(emerging!.entityIds).toEqual(['new']);
    expect(emerging!.action).toBe('briefing');
  });

  it('does not call the oldest entities emerging, however connected', () => {
    // Every node predates the newest fifth of the graph, so nothing qualifies.
    const insights = generateInsights(analyse(populated()), NOW);
    expect(insights.find((i) => i.kind === 'emerging_hub')).toBeUndefined();
  });

  it('stays silent on a graph too small for percentiles to mean anything', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    expect(insights.find((i) => i.kind === 'emerging_hub')).toBeUndefined();
  });

  it('flags a well-connected entity that has gone quiet', () => {
    const snapshot = barbell();
    snapshot.nodes.push(node('quiet', { lastSeenAt: NOW - 200 * DAY }));
    for (const n of ['a', 'b', 'x', 'c', 'd']) snapshot.edges.push(edge('quiet', n));
    const insights = generateInsights(analyse(snapshot), NOW);
    const stale = insights.find((i) => i.kind === 'stale_hub');
    expect(stale).toBeDefined();
    expect(stale!.entityIds).toEqual(['quiet']);
  });

  it('flags an entity asserting many links off a single unconfirmed note', () => {
    const snapshot = barbell();
    snapshot.nodes.push(node('thin', { noteCount: 1, confirmed: false }));
    for (const n of ['a', 'b', 'x', 'c']) snapshot.edges.push(edge('thin', n));
    const insights = generateInsights(analyse(snapshot), NOW);
    const thin = insights.find((i) => i.kind === 'thin_evidence');
    expect(thin).toBeDefined();
    expect(thin!.detail).toContain('one note');
  });

  it('flags a fragmented taxonomy', () => {
    const snapshot = barbell();
    snapshot.nodes.push(
      node('t1', { typeName: 'font', typeId: 'type-font' }),
      node('t2', { typeName: 'foot_type', typeId: 'type-foot' }),
      node('t3', { typeName: 'playbook', typeId: 'type-playbook' }),
    );
    const insights = generateInsights(analyse(snapshot), NOW);
    const outlier = insights.find((i) => i.kind === 'type_outlier');
    expect(outlier).toBeDefined();
    expect(outlier!.detail).toContain('font');
  });

  it('gives every insight an id, a title and a commissionable action', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    expect(insights.length).toBeGreaterThan(0);
    for (const i of insights) {
      expect(i.id).toBeTruthy();
      expect(i.title).toBeTruthy();
      expect(i.detail).toBeTruthy();
      expect(i.actionLabel).toBeTruthy();
      expect(i.actionPayload).toBeTruthy();
      expect(i.score).toBeGreaterThan(0);
      expect(i.score).toBeLessThanOrEqual(1);
    }
  });

  it('never emits the same insight id twice', () => {
    const insights = generateInsights(analyse(barbell()), NOW);
    expect(new Set(insights.map((i) => i.id)).size).toBe(insights.length);
  });

  it('survives an empty graph', () => {
    expect(generateInsights(analyse({ nodes: [], edges: [] }), NOW)).toEqual([]);
  });

  it('survives a graph with nodes but no edges', () => {
    const snapshot = { nodes: ['a', 'b', 'c'].map((n) => node(n)), edges: [] };
    const insights = generateInsights(analyse(snapshot), NOW);
    expect(insights.find((i) => i.kind === 'orphan')).toBeDefined();
  });
});
