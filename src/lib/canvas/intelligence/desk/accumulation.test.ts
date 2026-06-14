import { describe, it, expect } from 'vitest';
import {
  CARD_W,
  CARD_H,
  COL_W,
  organisedLayout,
  organisedCorePxBounds,
  accumulationScatter,
  scatterPosition,
  GRID,
  ORG,
  type LayoutArtefact,
  type LayoutCategory,
} from './layout';

const cats: LayoutCategory[] = [
  { id: 'cat-a', title: 'Alpha' },
  { id: 'cat-b', title: 'Beta' },
];

function art(id: string, kind: string, categoryId?: string): LayoutArtefact {
  return { id, kind, categoryId };
}

describe('COL_W is the ORG column stride', () => {
  it('matches ORG.colStride so headers and columns share one grid', () => {
    expect(COL_W).toBe(ORG.colStride);
  });
});

describe('organisedCorePxBounds', () => {
  it('returns the bounding box of all positioned cards', () => {
    const m = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: COL_W, y: 200 }],
    ]);
    const b = organisedCorePxBounds(m);
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(b.maxX).toBe(COL_W + CARD_W);
    expect(b.maxY).toBe(200 + CARD_H);
  });

  it('returns a zero box for an empty map', () => {
    const b = organisedCorePxBounds(new Map());
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('bounds an actual organisedLayout result', () => {
    const arts = [art('f1', 'fact', 'cat-a'), art('f2', 'fact', 'cat-b')];
    const positions = organisedLayout(arts, cats);
    const b = organisedCorePxBounds(positions);
    // a non-empty box, fully to the left of/at the maxX it claims
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });
});

describe('accumulationScatter', () => {
  it('places new arrivals to the RIGHT of the organised core, deterministically', () => {
    const bounds = { minX: 0, minY: 0, maxX: 600, maxY: 800 };
    const p = accumulationScatter('newcard-1', bounds);
    expect(p.x).toBeGreaterThanOrEqual(bounds.maxX);
    // deterministic
    expect(accumulationScatter('newcard-1', bounds)).toEqual(p);
    // different id → (almost certainly) different position
    expect(accumulationScatter('newcard-2', bounds)).not.toEqual(p);
  });

  it('is grid-snapped', () => {
    const bounds = { minX: 0, minY: 0, maxX: 600, maxY: 800 };
    for (const id of ['a', 'late-7', 'zzz-9001']) {
      const p = accumulationScatter(id, bounds);
      // Math.abs normalises the JS -0 that x%GRID / snap can yield (still on-grid).
      expect(Math.abs(p.x % GRID)).toBe(0);
      expect(Math.abs(p.y % GRID)).toBe(0);
    }
  });

  it('falls back to plain scatterPosition when the core is empty', () => {
    const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(accumulationScatter('x', bounds)).toEqual(scatterPosition('x', 99));
  });
});
