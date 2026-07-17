// Shared canvas-shell geometry — PURE functions extracted verbatim from the two
// near-identical implementations in `src/routes/jkai/canvas/[slug]/+page.svelte`
// and `src/lib/canvas/intelligence/ResearchDesk.svelte` (E1 / M5a).
//
// Rules of engagement: these are the SAME formulas both surfaces already ship;
// nothing here changes behaviour. Constants are parameterised with defaults that
// match today's live values so the call sites read identically. The surfaces
// keep ownership of all reactive state ($state pan/zoom vars stay in the
// components); they call these to do the maths and assign the results back.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Viewport = { panX: number; panY: number; zoom: number };
export type Box = { x: number; y: number; w: number; h: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Live defaults (do not change without matching both canvas surfaces).
export const DEFAULT_MIN_ZOOM = 0.25;
export const DEFAULT_MAX_ZOOM = 3;
export const DEFAULT_GRID = 20;

// Pinch uses a WIDER clamp than wheel/button zoom — this is deliberate,
// pre-existing behaviour in the workflow canvas that we preserve here.
export const DEFAULT_PINCH_MIN_ZOOM = 0.1;
export const DEFAULT_PINCH_MAX_ZOOM = 4;

/** Clamp a zoom factor into [min, max]. */
export function clampZoom(
  z: number,
  min: number = DEFAULT_MIN_ZOOM,
  max: number = DEFAULT_MAX_ZOOM,
): number {
  return Math.max(min, Math.min(max, z));
}

/**
 * Zoom by `factor` while keeping the world point currently under `screenPt`
 * pinned under `screenPt`. `screenPt` is in the viewport's local coordinate
 * space (already offset by the viewport rect). Returns the next viewport.
 *
 * If the clamped zoom is unchanged the ORIGINAL viewport is returned untouched
 * (mirrors the `if (newZoom === zoom) return;` early-out in both surfaces, so a
 * no-op zoom leaves pan exactly where it was).
 */
export function zoomAtPoint(
  vp: Viewport,
  screenPt: Point,
  factor: number,
  opts: { min?: number; max?: number } = {},
): Viewport {
  const newZoom = clampZoom(vp.zoom * factor, opts.min ?? DEFAULT_MIN_ZOOM, opts.max ?? DEFAULT_MAX_ZOOM);
  if (newZoom === vp.zoom) return vp;
  const worldX = (screenPt.x - vp.panX) / vp.zoom;
  const worldY = (screenPt.y - vp.panY) / vp.zoom;
  return {
    zoom: newZoom,
    panX: screenPt.x - worldX * newZoom,
    panY: screenPt.y - worldY * newZoom,
  };
}

/**
 * Two-finger pinch zoom. `start` captured at gesture begin: the initial finger
 * distance, the WORLD point under the initial midpoint, and the zoom at begin.
 * `currentMid`/`currentDist` are this frame's midpoint + finger distance.
 * Keeps the captured world point under the current midpoint.
 *
 * Defaults use the wider pinch clamp (0.1–4) — the workflow canvas's live
 * behaviour, ported to the desk in M5a.
 */
export function pinchZoom(
  start: { dist0: number; worldX: number; worldY: number; zoom0: number },
  currentMid: Point,
  currentDist: number,
  opts: { min?: number; max?: number } = {},
): Viewport {
  const ratio = currentDist / start.dist0;
  const z = clampZoom(
    start.zoom0 * ratio,
    opts.min ?? DEFAULT_PINCH_MIN_ZOOM,
    opts.max ?? DEFAULT_PINCH_MAX_ZOOM,
  );
  return {
    zoom: z,
    panX: currentMid.x - start.worldX * z,
    panY: currentMid.y - start.worldY * z,
  };
}

/**
 * Convert a client-space point to world coordinates. `rectOrigin` is the
 * viewport element's top-left in client space (`getBoundingClientRect().left/
 * top`); pass `{x:0,y:0}` when the point is already viewport-local.
 */
export function screenToWorld(vp: Viewport, clientPt: Point, rectOrigin: Point = { x: 0, y: 0 }): Point {
  return {
    x: (clientPt.x - rectOrigin.x - vp.panX) / vp.zoom,
    y: (clientPt.y - rectOrigin.y - vp.panY) / vp.zoom,
  };
}

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(pt: Point, grid: number = DEFAULT_GRID): Point {
  return {
    x: Math.round(pt.x / grid) * grid,
    y: Math.round(pt.y / grid) * grid,
  };
}

/**
 * World coordinate at the centre of the viewport, offset so a node of
 * `nodeSize` is centred (not corner-aligned), snapped to `grid`.
 */
export function viewportCenterInWorld(
  vp: Viewport,
  size: Size,
  nodeSize: { w: number; h: number },
  grid: number = DEFAULT_GRID,
): Point {
  const cx = (size.width / 2 - vp.panX) / vp.zoom;
  const cy = (size.height / 2 - vp.panY) / vp.zoom;
  return snapToGrid({ x: cx - nodeSize.w / 2, y: cy - nodeSize.h / 2 }, grid);
}

export type FitOptions = {
  /** Padding added around the raw content bounds, in world units (default 48). */
  pad?: number;
  /** Subtracted from each viewport dimension to get the available area (default 24). */
  availInset?: number;
  /** Floor for the available area, per dimension (default 200). */
  minAvail?: number;
  /** Added to both pan offsets after centring (default 12). */
  panInset?: number;
  min?: number;
  max?: number;
};

/**
 * Compute the viewport that fits `bounds` (raw content bounds, NO padding
 * pre-applied) into `size`, centred, at a clamped zoom of at most 1.
 */
export function fitToBounds(bounds: Bounds, size: Size, opts: FitOptions = {}): Viewport {
  const pad = opts.pad ?? 48;
  const availInset = opts.availInset ?? 24;
  const minAvail = opts.minAvail ?? 200;
  const panInset = opts.panInset ?? 12;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maxX = bounds.maxX + pad;
  const maxY = bounds.maxY + pad;
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const availW = Math.max(minAvail, size.width - availInset);
  const availH = Math.max(minAvail, size.height - availInset);
  const fitZ = clampZoom(Math.min(availW / contentW, availH / contentH, 1), opts.min, opts.max);
  return {
    zoom: fitZ,
    panX: panInset + (availW - contentW * fitZ) / 2 - minX * fitZ,
    panY: panInset + (availH - contentH * fitZ) / 2 - minY * fitZ,
  };
}

/**
 * Nudge `p` diagonally until it no longer clashes with any existing position
 * (Euclidean distance < `minDist`). Gives up after `limit` steps and returns
 * the last candidate. `existing` may carry extra fields; only x/y are read.
 */
export function resolveOverlap(
  p: Point,
  existing: ReadonlyArray<{ x: number; y: number }>,
  opts: { limit?: number; minDist?: number; step?: number } = {},
): Point {
  const limit = opts.limit ?? 20;
  const minDist = opts.minDist ?? 40;
  const step = opts.step ?? 24;
  let { x, y } = p;
  for (let i = 0; i < limit; i++) {
    const clashes = existing.some((n) => Math.hypot(n.x - x, n.y - y) < minDist);
    if (!clashes) return { x, y };
    x += step;
    y += step;
  }
  return { x, y };
}

/**
 * Orthogonal edge routing that docks to the closest side of each box.
 *
 * Axis choice:
 *  1. Horizontal overlap only (`overlapX && !overlapY`) → route vertically.
 *  2. Vertical overlap only (`overlapY && !overlapX`) → route horizontally.
 *  3. Otherwise pick the dominant centre-to-centre axis.
 *
 * Box-accessor form: the workflow canvas adapts its `CanvasNode` + `nodeW/nodeH`
 * to `{x,y,w,h}` at the call site; the research desk already speaks Box.
 */
export function orthPath(from: Box, to: Box): string {
  const sCx = from.x + from.w / 2;
  const sCy = from.y + from.h / 2;
  const tCx = to.x + to.w / 2;
  const tCy = to.y + to.h / 2;
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  const overlapX = from.x < to.x + to.w && to.x < from.x + from.w;
  const overlapY = from.y < to.y + to.h && to.y < from.y + from.h;

  let horizontal: boolean;
  if (overlapX && !overlapY) {
    horizontal = false;
  } else if (overlapY && !overlapX) {
    horizontal = true;
  } else {
    horizontal = Math.abs(dx) >= Math.abs(dy);
  }

  if (horizontal) {
    const [x1, x2] = dx >= 0 ? [from.x + from.w, to.x] : [from.x, to.x + to.w];
    const y1 = sCy;
    const y2 = tCy;
    const midX = (x1 + x2) / 2;
    return `M${x1} ${y1} L${midX} ${y1} L${midX} ${y2} L${x2} ${y2}`;
  }

  const [y1, y2] = dy >= 0 ? [from.y + from.h, to.y] : [from.y, to.y + to.h];
  const x1 = sCx;
  const x2 = tCx;
  const midY = (y1 + y2) / 2;
  return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
}
