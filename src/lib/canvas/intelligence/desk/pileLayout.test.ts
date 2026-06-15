import { describe, it, expect } from 'vitest';
import { pileLayout, pileFootprint, PILE, GRID, type Pos } from './layout';
import type { Group, GroupCard } from './grouping';

// ——— fixtures ———

function card(id: string): GroupCard {
  return { id, kind: 'fact', fields: {} };
}

/** Build the (groups, memberOf, cards) triple for G groups of the given sizes. */
function scenario(sizes: number[]): {
  groups: Group[];
  memberOf: Map<string, string>;
  cards: GroupCard[];
} {
  const groups: Group[] = [];
  const memberOf = new Map<string, string>();
  const cards: GroupCard[] = [];
  sizes.forEach((n, gi) => {
    const key = `g${gi}`;
    groups.push({ key, label: key.toUpperCase(), count: n });
    for (let i = 0; i < n; i++) {
      const id = `g${gi}-c${i}`;
      memberOf.set(id, key);
      cards.push(card(id));
    }
  });
  return { groups, memberOf, cards };
}

const NONE = new Set<string>();

describe('pileLayout — anchors', () => {
  it('returns a position for every card that belongs to a group', () => {
    const { groups, memberOf, cards } = scenario([3, 2]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    expect(m.size).toBe(5);
    for (const c of cards) expect(m.has(c.id)).toBe(true);
  });

  it('ignores cards whose group key is not in groups[]', () => {
    const { groups, memberOf, cards } = scenario([2]);
    const orphan = card('orphan'); // not in memberOf
    const m = pileLayout(groups, memberOf, [...cards, orphan], NONE);
    expect(m.has('orphan')).toBe(false);
    expect(m.size).toBe(2);
  });

  it('packs collapsed pile anchors left→right with non-overlapping footprints', () => {
    const { groups, memberOf, cards } = scenario([2, 2, 2]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    // The anchor of each pile is its first member's position minus the fan
    // offset (i=0 member sits AT the anchor). Top members:
    const a0 = m.get('g0-c0')!;
    const a1 = m.get('g1-c0')!;
    const a2 = m.get('g2-c0')!;
    // Left→right: strictly increasing X, same row Y (within the per-pile anchor
    // jitter + one grid step of wobble).
    const tol = 2 * PILE.anchorJitter + GRID;
    expect(a1.x).toBeGreaterThan(a0.x);
    expect(a2.x).toBeGreaterThan(a1.x);
    expect(Math.abs(a0.y - a1.y)).toBeLessThanOrEqual(tol);
    expect(Math.abs(a1.y - a2.y)).toBeLessThanOrEqual(tol);
    // Anchors flow by the actual footprint width, so the stride is ≥ this pile's
    // footprint (minus worst-case jitter) — i.e. footprints never overlap.
    const footW = pileFootprint(2, false).w;
    expect(a1.x - a0.x).toBeGreaterThanOrEqual(footW - tol);
  });

  it('a large multi-fan-column pile does not overlap its right neighbour', () => {
    // A 20-member pile fans into ⌈20/8⌉ = 3 columns (~922px wide) — far wider than
    // the nominal colStride. The width-aware flow must still clear the next pile.
    const { groups, memberOf, cards } = scenario([20, 4]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const big = cards.filter((c) => memberOf.get(c.id) === 'g0').map((c) => m.get(c.id)!);
    const nbr = cards.filter((c) => memberOf.get(c.id) === 'g1').map((c) => m.get(c.id)!);
    const bigRight = Math.max(...big.map((p) => p.x + PILE.cardW));
    const nbrLeft = Math.min(...nbr.map((p) => p.x));
    expect(nbrLeft).toBeGreaterThanOrEqual(bigRight); // no horizontal overlap
  });

  it('wraps pile anchors to a new row past PILE.perRow', () => {
    const sizes = new Array(PILE.perRow + 1).fill(1);
    const { groups, memberOf, cards } = scenario(sizes);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const first = m.get('g0-c0')!;
    const wrapped = m.get(`g${PILE.perRow}-c0`)!; // first pile on row 2
    expect(wrapped.y).toBeGreaterThan(first.y);
    // Restarts near the left edge (within the per-pile anchor jitter).
    expect(Math.abs(wrapped.x - first.x)).toBeLessThanOrEqual(2 * PILE.anchorJitter + GRID);
  });

  it('snaps every position to the grid', () => {
    const { groups, memberOf, cards } = scenario([4, 3]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    for (const p of m.values()) {
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
    }
  });

  it('is deterministic', () => {
    const { groups, memberOf, cards } = scenario([3, 2]);
    const a = pileLayout(groups, memberOf, cards, NONE);
    const b = pileLayout(groups, memberOf, cards, NONE);
    for (const c of cards) expect(a.get(c.id)).toEqual(b.get(c.id));
  });
});

describe('pileLayout — collapsed fan', () => {
  it('fans members by {dx:26, dy:18} per index within a wrap column (snapped)', () => {
    const { groups, memberOf, cards } = scenario([3]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const c0 = m.get('g0-c0')!;
    const c1 = m.get('g0-c1')!;
    const c2 = m.get('g0-c2')!;
    // Each successive member in the same fan column is offset by the fan delta.
    // All three fit in one fan column (fanWrapAt = 8).
    expect(c1.x).toBe(snapTo(c0.x, PILE.fanDx, 1));
    expect(c1.y).toBe(snapTo(c0.y, PILE.fanDy, 1));
    expect(c2.x).toBe(snapTo(c0.x, PILE.fanDx, 2));
    expect(c2.y).toBe(snapTo(c0.y, PILE.fanDy, 2));
  });

  it('every member in a collapsed pile has a distinct position (no hidden cards)', () => {
    // Use a pile larger than the old maxVisible cap (was 5) to prove no card
    // is hidden behind another.
    const n = PILE.fanWrapAt + 3; // spans two fan columns
    const { groups, memberOf, cards } = scenario([n]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const positions = cards.map((c) => {
      const p = m.get(c.id)!;
      return `${p.x},${p.y}`;
    });
    // All positions must be unique — no card is fully hidden.
    const unique = new Set(positions);
    expect(unique.size).toBe(n);
  });

  it('wraps large piles into a second fan column instead of hiding cards', () => {
    // Members beyond fanWrapAt start a new fan column offset by fanColStride.
    const { groups, memberOf, cards } = scenario([PILE.fanWrapAt + 1]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const anchor = m.get('g0-c0')!;
    // Member at fanWrapAt is the first card in the second fan column.
    const wrapped = m.get(`g0-c${PILE.fanWrapAt}`)!;
    expect(wrapped.x).toBeGreaterThanOrEqual(anchor.x + PILE.fanColStride);
    // Y resets to the anchor row in the new column (fanRow = 0).
    expect(wrapped.y).toBe(anchor.y);
  });

  it('collapsed piles from different groups never overlap card footprints', () => {
    const { groups, memberOf, cards } = scenario([5, 5, 5]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const boxes = cards.map((c) => {
      const p = m.get(c.id)!;
      return { g: memberOf.get(c.id)!, x0: p.x, y0: p.y, x1: p.x + PILE.cardW, y1: p.y + PILE.cardH };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].g === boxes[j].g) continue; // same pile may overlap (fan)
        const a = boxes[i], b = boxes[j];
        const overlapX = a.x0 < b.x1 && b.x0 < a.x1;
        const overlapY = a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});

describe('pileLayout — expanded', () => {
  it('an expanded group spreads its members into a vertical column at the anchor', () => {
    const { groups, memberOf, cards } = scenario([4]);
    const m = pileLayout(groups, memberOf, cards, new Set(['g0']));
    const c0 = m.get('g0-c0')!;
    const c1 = m.get('g0-c1')!;
    const c2 = m.get('g0-c2')!;
    // Same X column, increasing Y by the row stride.
    expect(c1.x).toBe(c0.x);
    expect(c2.x).toBe(c1.x);
    expect(c1.y - c0.y).toBe(PILE.rowStride);
    expect(c2.y - c1.y).toBe(PILE.rowStride);
    // No visible-count cap when expanded — every member gets a distinct slot.
    expect(m.get('g0-c3')!.y).toBe(c0.y + 3 * PILE.rowStride);
  });

  it('expanding one pile does not move the anchors of other (collapsed) piles', () => {
    const { groups, memberOf, cards } = scenario([3, 3]);
    const collapsed = pileLayout(groups, memberOf, cards, NONE);
    const expanded = pileLayout(groups, memberOf, cards, new Set(['g0']));
    // g1's anchor (top member) is unchanged regardless of g0's expansion.
    expect(expanded.get('g1-c0')).toEqual(collapsed.get('g1-c0'));
  });

  it('is deterministic when expanded', () => {
    const { groups, memberOf, cards } = scenario([3]);
    const exp = new Set(['g0']);
    const a = pileLayout(groups, memberOf, cards, exp);
    const b = pileLayout(groups, memberOf, cards, exp);
    for (const c of cards) expect(a.get(c.id)).toEqual(b.get(c.id));
  });
});

// Local helper mirroring the implementation's snap(anchor + i*delta) idiom so
// the fan assertions are exact rather than approximate.
function snapTo(anchorCoord: number, delta: number, i: number): number {
  return Math.round((anchorCoord + i * delta) / GRID) * GRID;
}
