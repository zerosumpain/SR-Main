import { describe, it, expect } from 'vitest';
import { pileLayout, PILE, GRID, type Pos } from './layout';
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
    // Left→right: strictly increasing X, same row Y.
    expect(a1.x).toBeGreaterThan(a0.x);
    expect(a2.x).toBeGreaterThan(a1.x);
    expect(a0.y).toBe(a1.y);
    expect(a1.y).toBe(a2.y);
    // Horizontal stride ≥ the pile footprint so collapsed piles don't overlap.
    expect(a1.x - a0.x).toBeGreaterThanOrEqual(PILE.colStride);
  });

  it('wraps pile anchors to a new row past PILE.perRow', () => {
    const sizes = new Array(PILE.perRow + 1).fill(1);
    const { groups, memberOf, cards } = scenario(sizes);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const first = m.get('g0-c0')!;
    const wrapped = m.get(`g${PILE.perRow}-c0`)!; // first pile on row 2
    expect(wrapped.y).toBeGreaterThan(first.y);
    expect(wrapped.x).toBe(first.x); // restarts at the left edge
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
  it('fans visible members by {dx:6, dy:8} per index (snapped)', () => {
    const { groups, memberOf, cards } = scenario([3]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const c0 = m.get('g0-c0')!;
    const c1 = m.get('g0-c1')!;
    const c2 = m.get('g0-c2')!;
    // Each successive visible member is offset by the fan delta (pre-snap 6/8).
    // Assert the trend (down-right) and that the offset matches snap(i*delta).
    expect(c1.x).toBe(snapTo(c0.x, PILE.fanDx, 1));
    expect(c1.y).toBe(snapTo(c0.y, PILE.fanDy, 1));
    expect(c2.x).toBe(snapTo(c0.x, PILE.fanDx, 2));
    expect(c2.y).toBe(snapTo(c0.y, PILE.fanDy, 2));
  });

  it('caps the visible fan: members past maxVisible stack at the cap position', () => {
    const n = PILE.maxVisible + 3;
    const { groups, memberOf, cards } = scenario([n]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const capIdx = PILE.maxVisible - 1;
    const capped = m.get(`g0-c${capIdx}`)!;
    // Every member at or past the cap shares the cap member's position.
    for (let i = capIdx; i < n; i++) {
      expect(m.get(`g0-c${i}`)).toEqual(capped);
    }
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
