// The thread's entities as the intel 3D view understands them.
//
// PURE. `NetworkGraph3D` is the intel page's spatial graph — a live
// d3-force-3d layout with dragging, hover and camera framing already solved —
// and it colours nodes by an analyst-given category map when told to. So the
// thread map does not draw its own spheres: it hands that component a
// `NetNode`/`NetEdge` graph whose one category per node is the CLASS the rail
// cares about, and a colour per class. One 3D view, two feeds.
//
// The four classes cross what the rail already says with hue (known / new
// here) against whether the node is one of the seven the rail is drawing
// right now. Colours are the site's CVD-validated categorical ramp
// (`--fs-cat-*` in app.css), as literals because WebGL cannot read a CSS var.

import type { NetEdge, NetNode } from '$lib/codegraph/types';
import type { ThreadGraphNode } from '$lib/jkai/thread-graph';
import type { DrillGraph, DrillGraphClass } from './types';

export const GRAPH_CLASS: Record<DrillGraphClass, { label: string; colour: string; order: number }> = {
  'view-known': { label: 'On the rail · already known', colour: '#7a5aa6', order: 0 },
  'view-new': { label: 'On the rail · new here', colour: '#8a2d3a', order: 1 },
  'thread-known': { label: 'In the thread · already known', colour: '#3a8658', order: 2 },
  'thread-new': { label: 'In the thread · new here', colour: '#b4632e', order: 3 },
};

export const GRAPH_CLASSES = (Object.keys(GRAPH_CLASS) as DrillGraphClass[]).sort(
  (a, b) => GRAPH_CLASS[a].order - GRAPH_CLASS[b].order,
);

/** Which of the four a concept node falls in. Structural nodes have no class. */
export function threadNodeClass(
  node: Pick<ThreadGraphNode, 'id' | 'kind' | 'provenance'>,
  viewIds: ReadonlySet<string>,
): DrillGraphClass | null {
  if (node.kind !== 'concept') return null;
  const inView = viewIds.has(node.id);
  const fresh = node.provenance === 'new';
  if (inView) return fresh ? 'view-new' : 'view-known';
  return fresh ? 'thread-new' : 'thread-known';
}

export interface NetGraph {
  nodes: NetNode[];
  edges: NetEdge[];
  categoryColours: Map<string, string>;
  counts: Record<DrillGraphClass, number>;
}

/**
 * The intel view sizes a sphere as `5 + sqrt(importance) * 20` and names it
 * above radius 10, on PageRank values that run roughly 0.001–0.05. Mentions
 * are mapped into that range rather than 0..1 — at 1.0 every sphere is a
 * 25-unit ball and the picture is a pile of balls — and the seven the rail
 * is drawing get a lift so they always earn a name.
 */
export function importanceOf(mentions: number, peak: number, onRail: boolean): number {
  const share = peak > 0 ? Math.max(0, Math.min(1, mentions / peak)) : 0;
  return 0.02 + 0.14 * share + (onRail ? 0.06 : 0);
}

/**
 * The mapping. `community` is the class index so the view's own bookkeeping
 * has a stable integer to hold (and so `explode` can ease the four apart).
 */
export function toNetGraph(graph: DrillGraph): NetGraph {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const peak = Math.max(1, ...graph.nodes.map((n) => n.mentions));
  const counts: Record<DrillGraphClass, number> = { 'view-known': 0, 'view-new': 0, 'thread-known': 0, 'thread-new': 0 };
  const nodes: NetNode[] = graph.nodes.map((n) => {
    counts[n.cls] += 1;
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      typeId: n.type,
      icon: '',
      color: GRAPH_CLASS[n.cls].colour,
      summary: n.note,
      confirmed: n.cls.endsWith('known'),
      confidence: n.cls.endsWith('known') ? 'high' : 'medium',
      noteCount: 0,
      degree: degree.get(n.id) ?? 0,
      importance: importanceOf(n.mentions, peak, n.cls.startsWith('view')),
      betweenness: 0,
      brokerage: 0,
      community: GRAPH_CLASS[n.cls].order,
      hops: null,
      categories: [n.cls],
      aliases: [],
      sources: [],
      recency: 1,
      relevance: 1,
      recent: true,
    };
  });
  const edges: NetEdge[] = graph.edges.map((e, i) => ({
    id: `${i}:${e.source}:${e.target}`,
    source: e.source,
    target: e.target,
    type: e.verb,
    label: e.typed ? e.verb : null,
    strength: e.typed ? 'strong' : 'weak',
    confidence: e.typed ? 'high' : 'low',
    crossCommunity: false,
    weight: e.typed ? 1 : 0.05,
    recency: 1,
    sourceKind: null,
    recent: true,
  }));
  return {
    nodes,
    edges,
    categoryColours: new Map(GRAPH_CLASSES.map((c) => [c, GRAPH_CLASS[c].colour])),
    counts,
  };
}
