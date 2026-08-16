import { describe, it, expect } from 'vitest';
import {
  RAIL_RADIAL,
  MODAL_RADIAL,
  RAIL_DRAW_LIMIT,
  placeNodes,
  drawEdges,
  visibleEdges,
  capacity,
  entityIdOf,
} from './graph-layout';
import type { ThreadGraphNode, ThreadGraphEdge } from './thread-graph';

function nodes(n: number): ThreadGraphNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    kind: 'concept' as const,
    type: 'CONCEPT',
    name: `node ${i}`,
    note: null,
    href: null,
    provenance: 'known' as const,
    lastSeen: null,
    turns: [0],
    mentions: n - i,
  }));
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('radial placement', () => {
  // The whole reason the layout uses fixed slots and a fixed chip size: at every
  // count either surface can produce, no two chips may share a pixel. The column
  // layout this replaced overlapped from six nodes upward.
  for (const [label, spec, max] of [
    ['rail', RAIL_RADIAL, RAIL_DRAW_LIMIT],
    ['modal', MODAL_RADIAL, capacity(MODAL_RADIAL)],
  ] as const) {
    it(`${label}: no two chips overlap, 1..${max} nodes`, () => {
      for (let n = 1; n <= max; n += 1) {
        const placed = placeNodes(nodes(n), spec);
        expect(placed).toHaveLength(n);
        for (let i = 0; i < placed.length; i += 1) {
          for (let j = i + 1; j < placed.length; j += 1) {
            expect(
              overlaps(placed[i], placed[j]),
              `${label} n=${n}: ${placed[i].id} overlaps ${placed[j].id}`,
            ).toBe(false);
          }
        }
      }
    });

    it(`${label}: every chip stays inside the canvas`, () => {
      for (let n = 1; n <= max; n += 1) {
        for (const p of placeNodes(nodes(n), spec)) {
          expect(p.x, `${label} n=${n} ${p.id} left`).toBeGreaterThanOrEqual(0);
          expect(p.y, `${label} n=${n} ${p.id} top`).toBeGreaterThanOrEqual(0);
          expect(p.x + p.w, `${label} n=${n} ${p.id} right`).toBeLessThanOrEqual(spec.width);
          expect(p.y + p.h, `${label} n=${n} ${p.id} bottom`).toBeLessThanOrEqual(spec.height);
        }
      }
    });
  }

  it('puts the first node — the one the thread talks about most — in the centre', () => {
    const [first] = placeNodes(nodes(7), RAIL_RADIAL);
    expect(first.id).toBe('n0');
    expect(first.ring).toBe(0);
    expect(first.x + first.w / 2).toBe(RAIL_RADIAL.width / 2);
    expect(first.y + first.h / 2).toBe(RAIL_RADIAL.height / 2);
  });

  it('drops nodes it has no slot for rather than stacking them', () => {
    const placed = placeNodes(nodes(40), RAIL_RADIAL);
    expect(placed).toHaveLength(capacity(RAIL_RADIAL));
  });

  it('places nothing for an empty graph', () => {
    expect(placeNodes([], RAIL_RADIAL)).toEqual([]);
  });
});

describe('visibleEdges', () => {
  const edges: ThreadGraphEdge[] = [
    { source: 'n0', target: 'n1', verb: 'CAUSES', typed: true },
    { source: 'n2', target: 'n3', verb: 'MENTIONED WITH', typed: false },
    { source: 'n1', target: 'n2', verb: 'MENTIONED WITH', typed: false },
  ];

  it('always keeps typed relationships', () => {
    expect(visibleEdges(edges, null).map((e) => e.verb)).toEqual(['CAUSES']);
  });

  it('adds co-occurrence only where it touches the selected node', () => {
    const shown = visibleEdges(edges, 'n2');
    expect(shown).toHaveLength(3);
    expect(visibleEdges(edges, 'n0')).toHaveLength(1);
  });
});

describe('drawEdges', () => {
  it('joins chip centres and skips edges with a missing endpoint', () => {
    const placed = placeNodes(nodes(3), RAIL_RADIAL);
    const drawn = drawEdges(
      [
        { source: 'n0', target: 'n1', verb: 'CAUSES', typed: true },
        { source: 'n0', target: 'gone', verb: 'CAUSES', typed: true },
      ],
      placed,
      'n0',
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].x1).toBe(placed[0].x + placed[0].w / 2);
    expect(drawn[0].y1).toBe(placed[0].y + placed[0].h / 2);
    expect(drawn[0].active).toBe(true);
  });
});

describe('entityIdOf', () => {
  it('unwraps a concept node id', () => {
    expect(entityIdOf({ kind: 'concept', id: 'entity:abc-123' })).toBe('abc-123');
  });

  it('refuses anything that is not a concept', () => {
    expect(entityIdOf({ kind: 'doc', id: 'entity:abc-123' })).toBeNull();
    expect(entityIdOf({ kind: 'concept', id: 'entity:' })).toBeNull();
  });
});
