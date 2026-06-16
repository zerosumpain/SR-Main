import { describe, it, expect } from 'vitest';
import { spreadLayout, spreadCols, SPREAD } from './spread';

const anchor = { x: 1000, y: 1000 };

describe('spreadCols', () => {
  it('is 1 for 0/1 members', () => {
    expect(spreadCols(0)).toBe(1);
    expect(spreadCols(1)).toBe(1);
  });
  it('is roughly square, capped at maxCols', () => {
    expect(spreadCols(4)).toBe(2);
    expect(spreadCols(9)).toBe(3);
    expect(spreadCols(100)).toBe(SPREAD.maxCols);
  });
});

describe('spreadLayout', () => {
  it('positions every member exactly once', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { positions } = spreadLayout(ids, anchor);
    expect(positions.size).toBe(5);
    for (const id of ids) expect(positions.has(id)).toBe(true);
  });

  it('every member gets a distinct, non-overlapping cell', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const { positions } = spreadLayout(ids, anchor);
    const seen = new Set<string>();
    for (const p of positions.values()) seen.add(`${p.x},${p.y}`);
    expect(seen.size).toBe(12);
    // Adjacent columns are at least a card-width apart.
    const a = positions.get('m0')!;
    const b = positions.get('m1')!;
    expect(b.x - a.x).toBeGreaterThanOrEqual(SPREAD.cardW);
  });

  it('centres the grid on the anchor (heading above it)', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { positions, heading } = spreadLayout(ids, anchor);
    // Heading sits above all member rows.
    for (const p of positions.values()) expect(heading.y).toBeLessThan(p.y);
    // Grid is horizontally centred: min-left and max-right roughly straddle anchor.x.
    const xs = [...positions.values()].map((p) => p.x);
    const mid = (Math.min(...xs) + Math.max(...xs) + SPREAD.cardW) / 2;
    expect(Math.abs(mid - anchor.x)).toBeLessThanOrEqual(SPREAD.cellW);
  });

  it('is deterministic + grid-snapped', () => {
    const ids = ['x', 'y', 'z'];
    const a = spreadLayout(ids, anchor);
    const b = spreadLayout(ids, anchor);
    expect([...a.positions]).toEqual([...b.positions]);
    for (const p of a.positions.values()) {
      expect(p.x % 20).toBe(0);
      expect(p.y % 20).toBe(0);
    }
  });
});
