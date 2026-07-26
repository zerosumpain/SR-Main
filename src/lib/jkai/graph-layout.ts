// Column layout for the thread knowledge graph.
//
// Shared by the 324px rail and the expanded modal, which differ only in how
// much room they have. Hand-placed columns rather than a force simulation for
// the same reason the handoff specified them: a simulation can push a chip past
// the edge of a narrow rail, and a label that truncates is worse than a layout
// that isn't optimal.

import type { ThreadGraphNode, ThreadGraphEdge } from './thread-graph';

export interface LayoutSpec {
  /** Left offset of each column, in px. Length sets the column count. */
  columns: number[];
  /** y of the first row. */
  rowTop: number;
  /** Vertical distance between rows. */
  rowGap: number;
  /** Offset from a chip's top-left to its centre, where edges terminate. */
  chipCentre: { x: number; y: number };
}

export const RAIL_LAYOUT: LayoutSpec = {
  columns: [16, 106, 202],
  rowTop: 28,
  rowGap: 56,
  chipCentre: { x: 44, y: 11 },
};

export const MODAL_LAYOUT: LayoutSpec = {
  columns: [40, 260, 480, 700],
  rowTop: 48,
  rowGap: 84,
  chipCentre: { x: 78, y: 15 },
};

export interface PlacedNode extends ThreadGraphNode {
  x: number;
  y: number;
}

export interface DrawnEdge extends ThreadGraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
}

/** Fill columns top-to-bottom, left-to-right, so edges tend to run rightward
 *  and the eye reads the graph in the same direction as the prose. */
export function placeNodes(nodes: ThreadGraphNode[], spec: LayoutSpec): PlacedNode[] {
  const perColumn = Math.max(1, Math.ceil(nodes.length / spec.columns.length));
  return nodes.map((n, i) => {
    const col = Math.min(spec.columns.length - 1, Math.floor(i / perColumn));
    const row = i % perColumn;
    return { ...n, x: spec.columns[col], y: spec.rowTop + row * spec.rowGap };
  });
}

export function drawEdges(
  edges: ThreadGraphEdge[],
  placed: PlacedNode[],
  spec: LayoutSpec,
  selectedId: string | null,
): DrawnEdge[] {
  const at = new Map(placed.map((p) => [p.id, p]));
  const out: DrawnEdge[] = [];
  for (const e of edges) {
    const a = at.get(e.source);
    const b = at.get(e.target);
    if (!a || !b) continue;
    out.push({
      ...e,
      x1: a.x + spec.chipCentre.x,
      y1: a.y + spec.chipCentre.y,
      x2: b.x + spec.chipCentre.x,
      y2: b.y + spec.chipCentre.y,
      active: e.source === selectedId || e.target === selectedId,
    });
  }
  return out;
}

/** Height the canvas needs to show every row without clipping. */
export function canvasHeight(nodeCount: number, spec: LayoutSpec, min: number): number {
  const perColumn = Math.max(1, Math.ceil(nodeCount / spec.columns.length));
  return Math.max(min, spec.rowTop + perColumn * spec.rowGap);
}

/** Where a node leads when you drill through. Concept nodes go to their intel
 *  entity page; everything else keeps the provenance link the graph builder
 *  gave it (a canvas, a deep dive, /drive). */
export function drillThroughHref(node: ThreadGraphNode): string | null {
  return node.href;
}
