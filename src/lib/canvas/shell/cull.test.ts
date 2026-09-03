import { describe, it, expect } from 'vitest';
import { visibleWorldRect, quantiseRect, intersects, cullToRect, isLowDetail, LOD_ZOOM } from './cull';

const CARD = { w: 200, h: 120 };
const box = (x: number, y: number) => ({ x, y, ...CARD });

describe('visibleWorldRect', () => {
  it('is the viewport itself at zoom 1 with no pan', () => {
    expect(visibleWorldRect({ panX: 0, panY: 0, zoom: 1 }, { width: 800, height: 600 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
    });
  });

  it('moves opposite the pan — panning right reveals world to the LEFT', () => {
    const r = visibleWorldRect({ panX: 100, panY: 50, zoom: 1 }, { width: 800, height: 600 });
    expect(r.minX).toBe(-100);
    expect(r.minY).toBe(-50);
    expect(r.maxX).toBe(700);
    expect(r.maxY).toBe(550);
  });

  it('covers more world as you zoom out', () => {
    const r = visibleWorldRect({ panX: 0, panY: 0, zoom: 0.5 }, { width: 800, height: 600 });
    expect(r.maxX).toBe(1600);
    expect(r.maxY).toBe(1200);
  });

  it('agrees with the minimap projection, which uses the same convention', () => {
    // computeMinimap folds in viewLeft = -panX/zoom … viewBottom =
    // (height - panY)/zoom. If these ever diverge, the minimap frame and the
    // culled set describe different rectangles.
    const vp = { panX: -320, panY: 140, zoom: 1.5 };
    const size = { width: 1024, height: 768 };
    const r = visibleWorldRect(vp, size);
    expect(r.minX).toBeCloseTo(-vp.panX / vp.zoom);
    expect(r.maxY).toBeCloseTo((size.height - vp.panY) / vp.zoom);
  });

  it('grows by the margin on every side', () => {
    const r = visibleWorldRect({ panX: 0, panY: 0, zoom: 1 }, { width: 800, height: 600 }, 300);
    expect(r).toEqual({ minX: -300, minY: -300, maxX: 1100, maxY: 900 });
  });
});

describe('quantiseRect', () => {
  it('snaps every edge OUTWARD, never in', () => {
    const r = quantiseRect({ minX: 130, minY: -10, maxX: 810, maxY: 601 }, 400);
    expect(r).toEqual({ minX: 0, minY: -400, maxX: 1200, maxY: 800 });
  });

  it('gives an identical rect while every edge stays inside its cell', () => {
    // Value-equal means the derived cull set does not change, which is the
    // entire point: a pan that reveals nothing new must cost nothing.
    const size = { width: 700, height: 500 };
    const a = quantiseRect(visibleWorldRect({ panX: 0, panY: 0, zoom: 1 }, size), 400);
    const b = quantiseRect(visibleWorldRect({ panX: -30, panY: -20, zoom: 1 }, size), 400);
    expect(b).toEqual(a);
  });

  it('never reports a negative zero, which compares unequal to zero', () => {
    const r = quantiseRect(visibleWorldRect({ panX: 0, panY: 0, zoom: 1 }, { width: 700, height: 500 }), 400);
    expect(Object.is(r.minX, -0)).toBe(false);
    expect(Object.is(r.minY, -0)).toBe(false);
  });

  it('does change once the viewport crosses a cell boundary', () => {
    const a = quantiseRect(visibleWorldRect({ panX: 0, panY: 0, zoom: 1 }, { width: 800, height: 600 }), 400);
    const b = quantiseRect(visibleWorldRect({ panX: -900, panY: 0, zoom: 1 }, { width: 800, height: 600 }), 400);
    expect(b).not.toEqual(a);
  });

  it('is a no-op for a non-positive step', () => {
    const r = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
    expect(quantiseRect(r, 0)).toBe(r);
    expect(quantiseRect(r, -5)).toBe(r);
  });
});

describe('intersects', () => {
  const rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

  it('accepts a box fully inside', () => {
    expect(intersects(box(100, 100), rect)).toBe(true);
  });

  it('accepts a box straddling an edge', () => {
    expect(intersects(box(-150, 100), rect)).toBe(true);
    expect(intersects(box(700, 550), rect)).toBe(true);
  });

  it('accepts a box that only touches — a card half a pixel on screen is on screen', () => {
    expect(intersects(box(-200, 0), rect)).toBe(true);
    expect(intersects(box(800, 0), rect)).toBe(true);
  });

  it('rejects a box entirely outside on each axis', () => {
    expect(intersects(box(-201, 0), rect)).toBe(false);
    expect(intersects(box(801, 0), rect)).toBe(false);
    expect(intersects(box(0, -121), rect)).toBe(false);
    expect(intersects(box(0, 601), rect)).toBe(false);
  });
});

describe('cullToRect', () => {
  const items = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 5000, y: 0 },
    { id: 'c', x: 400, y: 200 },
    { id: 'd', x: 0, y: 9000 },
  ];
  const boxOf = (i: (typeof items)[number]) => ({ x: i.x, y: i.y, ...CARD });
  const rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

  it('keeps only what overlaps', () => {
    expect(cullToRect(items, rect, boxOf).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('preserves the original order, so stacking and stagger stay stable', () => {
    const wide = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
    expect(cullToRect(items, wide, boxOf).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps an off-screen item the caller pins — a dragged card must not vanish', () => {
    const out = cullToRect(items, rect, boxOf, (i) => i.id === 'd');
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'd']);
  });

  it('does not duplicate an on-screen item that is also pinned', () => {
    const out = cullToRect(items, rect, boxOf, (i) => i.id === 'a');
    expect(out.filter((i) => i.id === 'a')).toHaveLength(1);
  });

  it('returns nothing for an empty input rather than throwing', () => {
    expect(cullToRect([], rect, boxOf)).toEqual([]);
  });
});

describe('isLowDetail', () => {
  it('switches to blocks below the threshold and cards at or above it', () => {
    expect(isLowDetail(LOD_ZOOM - 0.01)).toBe(true);
    expect(isLowDetail(LOD_ZOOM)).toBe(false);
    expect(isLowDetail(1)).toBe(false);
  });
});
