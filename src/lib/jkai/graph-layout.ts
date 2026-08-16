// Layout for the thread knowledge graph.
//
// Shared by the 324px rail and the expanded modal, which differ only in how
// much room they have. Hand-placed rather than a force simulation, for the
// reason the original handoff gave: a simulation can push a chip past the edge
// of a narrow rail, and a label that truncates is worse than a layout that is
// not optimal.
//
// It used to fill columns top-to-bottom. That reads as a list, and at the rail's
// twelve-node cap it was a list whose chips overlapped each other — 12 chips of
// up to 106px in a 324×308 box, with 69 mostly-co-occurrence edges drawn over
// the top. Radial replaces it: the thread's most-talked-about topic sits in the
// middle and everything else orbits it, so the centre of the picture is the
// answer to "what is this chat about" rather than whatever happened to be
// extracted first.
//
// Slots are FIXED and chips are a FIXED size, so "do two chips overlap" is
// arithmetic rather than a hope — see graph-layout.test.ts, which asserts it for
// every node count both surfaces can produce.

import type { ThreadGraphNode, ThreadGraphEdge } from './thread-graph';

export interface RadialSpec {
  /** Canvas box the layout must stay inside. */
  width: number;
  height: number;
  /** Chip size. Fixed, so slot collisions are decidable up front. */
  chip: { w: number; h: number };
  /** Ellipse radii for each ring, outward from the centre. */
  rings: Array<{ rx: number; ry: number; slots: number }>;
}

/**
 * The rail draws the TOP SEVEN nodes, not all twelve.
 *
 * Twelve chips in 324px is the squash the redesign is fixing; the rail's job is
 * the headline and the modal's is the whole graph. `RAIL_DRAW_LIMIT` is what the
 * canvas shows — the head still counts the full graph, and the topic list below
 * still ranks everything.
 */
export const RAIL_DRAW_LIMIT = 7;

/**
 * 256px, not 300. The rail is a fixed stack that must not scroll, and the
 * canvas is the one cell whose height is a free choice — every pixel it takes
 * comes off the relations list at the bottom, which was being squeezed to a
 * heading and nothing else at a 900px window.
 */
export const RAIL_RADIAL: RadialSpec = {
  width: 324,
  height: 256,
  chip: { w: 100, h: 22 },
  rings: [{ rx: 104, ry: 86, slots: 6 }],
};

export const MODAL_RADIAL: RadialSpec = {
  width: 900,
  height: 560,
  chip: { w: 200, h: 30 },
  rings: [
    { rx: 250, ry: 130, slots: 6 },
    { rx: 330, ry: 232, slots: 6 },
  ],
};

/**
 * Which slots to use when a ring is not full, so three nodes read as a balanced
 * arrangement rather than a cluster in the top-right.
 *
 * Index 0 is the top of the ring and they run clockwise. Chosen per count rather
 * than by evenly dividing the circle: even division changes every chip's x for
 * each new node, and the fixed-slot table is what makes the overlap test above
 * a finite check instead of a sampling exercise.
 */
const SLOT_ORDER: Record<number, number[]> = {
  0: [],
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [1, 2, 4, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

export interface PlacedNode extends ThreadGraphNode {
  /** Top-left of the chip. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 for the centre node, 1 for the first ring, and so on. */
  ring: number;
}

export interface DrawnEdge extends ThreadGraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
}

function slotsFor(count: number, ringSlots: number): number[] {
  const n = Math.min(count, ringSlots);
  return SLOT_ORDER[n] ?? SLOT_ORDER[ringSlots] ?? [];
}

/**
 * Place nodes outward from the centre, in the order they arrive.
 *
 * The caller passes them already ranked (the graph API sorts by how much the
 * thread actually talks about each one), so node 0 lands in the middle and the
 * ranking is legible as distance from it.
 */
export function placeNodes(nodes: ThreadGraphNode[], spec: RadialSpec): PlacedNode[] {
  if (nodes.length === 0) return [];
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  const { w, h } = spec.chip;
  const out: PlacedNode[] = [
    { ...nodes[0], x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, ring: 0 },
  ];

  let i = 1;
  for (let r = 0; r < spec.rings.length && i < nodes.length; r += 1) {
    const ring = spec.rings[r];
    const taking = Math.min(ring.slots, nodes.length - i);
    const slots = slotsFor(taking, ring.slots);
    for (const slot of slots) {
      // Slot 0 at the top, running clockwise. -90° so a single neighbour sits
      // above the centre rather than beside it, which is where the eye starts.
      const angle = (-90 + (360 / ring.slots) * slot) * (Math.PI / 180);
      out.push({
        ...nodes[i],
        x: Math.round(cx + ring.rx * Math.cos(angle) - w / 2),
        y: Math.round(cy + ring.ry * Math.sin(angle) - h / 2),
        w,
        h,
        ring: r + 1,
      });
      i += 1;
    }
  }
  return out;
}

/** How many nodes a spec can place. Anything beyond this is not drawn. */
export function capacity(spec: RadialSpec): number {
  return 1 + spec.rings.reduce((sum, r) => sum + r.slots, 0);
}

export function drawEdges(
  edges: ThreadGraphEdge[],
  placed: PlacedNode[],
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
      x1: a.x + a.w / 2,
      y1: a.y + a.h / 2,
      x2: b.x + b.w / 2,
      y2: b.y + b.h / 2,
      active: e.source === selectedId || e.target === selectedId,
    });
  }
  return out;
}

/**
 * Edges worth drawing.
 *
 * Co-occurrence is a clique: every node extracted from one turn is joined to
 * every other, so twelve concepts from a single reply produce sixty-six lines
 * that assert nothing beyond "these were in the same message". Typed
 * relationships are always drawn — those are claims the knowledge base makes —
 * and co-occurrence only where it touches whatever is selected, which is the one
 * moment it answers a question the reader is asking.
 */
export function visibleEdges(
  edges: ThreadGraphEdge[],
  selectedId: string | null,
): ThreadGraphEdge[] {
  return edges.filter(
    (e) => e.typed || e.source === selectedId || e.target === selectedId,
  );
}

/** Where a node leads when you drill through. Concept nodes go to their intel
 *  entity page; everything else keeps the provenance link the graph builder
 *  gave it (a canvas, a deep dive, /drive). */
export function drillThroughHref(node: ThreadGraphNode): string | null {
  return node.href;
}

/** The intel entity id behind a concept node, or null for anything else.
 *  Concept ids are minted as `entity:<uuid>` in thread-graph.ts. */
export function entityIdOf(node: Pick<ThreadGraphNode, 'kind' | 'id'>): string | null {
  if (node.kind !== 'concept') return null;
  const id = node.id.startsWith('entity:') ? node.id.slice('entity:'.length) : '';
  return id || null;
}
