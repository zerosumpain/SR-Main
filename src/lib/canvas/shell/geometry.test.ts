import { describe, it, expect } from 'vitest';
import {
  clampZoom,
  zoomAtPoint,
  pinchZoom,
  screenToWorld,
  snapToGrid,
  viewportCenterInWorld,
  fitToBounds,
  resolveOverlap,
  orthPath,
  type Viewport,
} from './geometry';

describe('clampZoom', () => {
  it('clamps below the default minimum (0.25)', () => {
    expect(clampZoom(0.01)).toBe(0.25);
  });
  it('clamps above the default maximum (3)', () => {
    expect(clampZoom(99)).toBe(3);
  });
  it('passes through in-range values', () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });
  it('honours custom bounds', () => {
    expect(clampZoom(10, 0.1, 4)).toBe(4);
    expect(clampZoom(0.05, 0.1, 4)).toBe(0.1);
  });
});

describe('zoomAtPoint', () => {
  it('keeps the world point under the cursor fixed (round-trip)', () => {
    const vp: Viewport = { panX: 100, panY: 50, zoom: 1 };
    const screenPt = { x: 200, y: 150 };
    const before = screenToWorld(vp, screenPt);
    const next = zoomAtPoint(vp, screenPt, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, screenPt);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    // Exact values for the documented case.
    expect(next).toEqual({ zoom: 2, panX: 0, panY: -50 });
  });

  it('returns the SAME viewport (no pan drift) when the clamped zoom is unchanged', () => {
    const vp: Viewport = { panX: 5, panY: 5, zoom: 3 };
    // factor 2 would exceed MAX (3) → clamp keeps zoom at 3 → early-out.
    const next = zoomAtPoint(vp, { x: 10, y: 10 }, 2);
    expect(next).toBe(vp);
  });

  it('clamps the zoom into the default range', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    expect(zoomAtPoint(vp, { x: 0, y: 0 }, 0.01).zoom).toBe(0.25);
  });

  it('honours custom bounds', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    expect(zoomAtPoint(vp, { x: 0, y: 0 }, 10, { min: 0.1, max: 4 }).zoom).toBe(4);
  });
});

describe('pinchZoom', () => {
  const start = { dist0: 100, worldX: 50, worldY: 50, zoom0: 1 };

  it('scales by the finger-distance ratio and pins the captured world point under the midpoint', () => {
    const next = pinchZoom(start, { x: 300, y: 200 }, 200);
    expect(next.zoom).toBe(2);
    expect(next.panX).toBe(200);
    expect(next.panY).toBe(100);
    // (mid.x - panX) / zoom === worldX
    expect((300 - next.panX) / next.zoom).toBeCloseTo(start.worldX, 10);
    expect((200 - next.panY) / next.zoom).toBeCloseTo(start.worldY, 10);
  });

  it('uses the WIDER pinch clamp floor (0.1, not 0.25)', () => {
    const next = pinchZoom(start, { x: 0, y: 0 }, 1); // ratio 0.01
    expect(next.zoom).toBe(0.1);
  });

  it('uses the WIDER pinch clamp ceiling (4, not 3)', () => {
    const next = pinchZoom(start, { x: 0, y: 0 }, 1000); // ratio 10
    expect(next.zoom).toBe(4);
  });
});

describe('screenToWorld', () => {
  it('inverts pan + zoom', () => {
    const vp: Viewport = { panX: 10, panY: 20, zoom: 2 };
    expect(screenToWorld(vp, { x: 110, y: 220 }, { x: 10, y: 20 })).toEqual({ x: 45, y: 90 });
  });
  it('defaults the rect origin to (0,0)', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    expect(screenToWorld(vp, { x: 40, y: 60 })).toEqual({ x: 40, y: 60 });
  });
});

describe('snapToGrid', () => {
  it('snaps to the nearest grid intersection', () => {
    expect(snapToGrid({ x: 23, y: 57 })).toEqual({ x: 20, y: 60 });
  });
  it('honours a custom grid', () => {
    expect(snapToGrid({ x: 23, y: 57 }, 10)).toEqual({ x: 20, y: 60 });
  });
});

describe('viewportCenterInWorld', () => {
  it('centres a node in the viewport, grid-snapped', () => {
    const vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
    const out = viewportCenterInWorld(vp, { width: 800, height: 600 }, { w: 148, h: 52 });
    expect(out).toEqual({ x: 320, y: 280 });
  });
});

describe('fitToBounds', () => {
  it('fits small content at zoom 1 and centres it', () => {
    const out = fitToBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 800, height: 600 });
    expect(out).toEqual({ zoom: 1, panX: 350, panY: 250 });
  });
  it('never zooms in past 1', () => {
    const out = fitToBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 4000, height: 4000 });
    expect(out.zoom).toBe(1);
  });
  it('clamps zoom-out to the minimum for very large content', () => {
    const out = fitToBounds({ minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, { width: 800, height: 600 });
    expect(out.zoom).toBe(0.25);
  });
});

describe('resolveOverlap', () => {
  it('returns the point unchanged when there is no clash', () => {
    expect(resolveOverlap({ x: 0, y: 0 }, [])).toEqual({ x: 0, y: 0 });
    expect(resolveOverlap({ x: 0, y: 0 }, [{ x: 1000, y: 1000 }])).toEqual({ x: 0, y: 0 });
  });
  it('nudges diagonally until clear of existing nodes', () => {
    // (0,0) clashes; (24,24) still within 40px of (0,0); (48,48) is clear.
    expect(resolveOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 48, y: 48 });
  });
  it('gives up after the step limit and returns the last candidate', () => {
    expect(resolveOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }], { limit: 1 })).toEqual({ x: 24, y: 24 });
  });
  it('reads only x/y from existing (extra fields ignored)', () => {
    const existing = [{ x: 1000, y: 1000, id: 'z', kind: 'chat' }];
    expect(resolveOverlap({ x: 0, y: 0 }, existing)).toEqual({ x: 0, y: 0 });
  });
});

describe('orthPath', () => {
  it('routes horizontally when boxes overlap vertically only', () => {
    const d = orthPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 200, y: 0, w: 100, h: 50 });
    expect(d).toBe('M100 25 L150 25 L150 25 L200 25');
  });
  it('routes vertically when boxes overlap horizontally only', () => {
    const d = orthPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 });
    expect(d).toBe('M50 50 L50 125 L50 125 L50 200');
  });
  it('picks the dominant horizontal axis when neither overlaps', () => {
    const d = orthPath({ x: 0, y: 0, w: 50, h: 50 }, { x: 300, y: 100, w: 50, h: 50 });
    expect(d).toBe('M50 25 L175 25 L175 125 L300 125');
  });
  it('picks the dominant vertical axis when neither overlaps', () => {
    const d = orthPath({ x: 0, y: 0, w: 50, h: 50 }, { x: 100, y: 300, w: 50, h: 50 });
    expect(d).toBe('M25 50 L25 175 L125 175 L125 300');
  });
  it('handles a leftward horizontal route (negative dx branch)', () => {
    const d = orthPath({ x: 200, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 50 });
    expect(d).toBe('M200 25 L150 25 L150 25 L100 25');
  });
  it('handles an upward vertical route (negative dy branch)', () => {
    const d = orthPath({ x: 0, y: 200, w: 50, h: 50 }, { x: 0, y: 0, w: 50, h: 50 });
    expect(d).toBe('M25 200 L25 125 L25 125 L25 50');
  });
});
