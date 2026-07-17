import { describe, it, expect } from 'vitest';
import { computeMinimap, MINIMAP_BODY_W, MINIMAP_BODY_H, MINIMAP_PAD } from './minimap';
import type { Viewport } from './geometry';

describe('computeMinimap', () => {
  it('exposes the live minimap-body constants', () => {
    expect(MINIMAP_BODY_W).toBe(146);
    expect(MINIMAP_BODY_H).toBe(60);
    expect(MINIMAP_PAD).toBe(4);
  });

  it('projects node bounds + viewport frame into the minimap body', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const out = computeMinimap(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      vp,
      { width: 200, height: 200 },
    );
    expect(out.scale).toBeCloseTo(0.26, 10);
    expect(out.offsetX).toBeCloseTo(47, 10);
    expect(out.offsetY).toBeCloseTo(4, 10);
    expect(out.minX).toBe(0);
    expect(out.minY).toBe(0);
    expect(out.frame.x).toBeCloseTo(47, 10);
    expect(out.frame.y).toBeCloseTo(4, 10);
    expect(out.frame.w).toBeCloseTo(52, 10);
    expect(out.frame.h).toBeCloseTo(52, 10);
  });

  it('folds the visible viewport rectangle into the bounds (pan pushes minX negative)', () => {
    const vp: Viewport = { panX: 500, panY: 0, zoom: 1 };
    const out = computeMinimap(
      { minX: 100, minY: 100, maxX: 200, maxY: 200 },
      vp,
      { width: 300, height: 300 },
    );
    // viewLeft = -panX/zoom = -500, which is < itemBounds.minX (100).
    expect(out.minX).toBe(-500);
  });

  it('clamps the frame to a minimum 2px in each dimension', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 100 };
    const out = computeMinimap(
      { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
      vp,
      { width: 10, height: 10 },
    );
    expect(out.frame.w).toBe(2);
    expect(out.frame.h).toBe(2);
  });

  it('honours custom minimap-body constants', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const a = computeMinimap({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, vp, { width: 200, height: 200 });
    const b = computeMinimap({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, vp, { width: 200, height: 200 }, {
      bodyW: 292,
      bodyH: 120,
      pad: 8,
    });
    // Larger body ⇒ larger projection scale.
    expect(b.scale).toBeGreaterThan(a.scale);
  });
});
