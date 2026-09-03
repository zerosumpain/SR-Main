/**
 * Viewport culling for the pan/zoom canvases.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 * The research desk rendered EVERY artefact as live DOM, all the time. A
 * finished investigation in production holds 207 sources, 2,035 facts and 1,211
 * entities — 3,453 cards, each one a positioned host `div`, a liveness wrapper
 * and an `ArtefactCard` subtree, plus a second `div` per card in the minimap.
 * Roughly seventy thousand elements for a surface showing maybe forty of them.
 *
 * Nothing about that is fixable by making the card cheaper. The fix is to stop
 * making elements for cards nobody can see, which is what this module measures.
 *
 * ── Why the rect is quantised ────────────────────────────────────────────────
 * Culling on the exact viewport recomputes the rendered set on every pan frame,
 * and each recompute is a keyed-each diff over thousands of items — trading a
 * steady cost for a jerky one. So the visible rect is grown by a margin and
 * then SNAPPED outward to a grid. Every edge that stays inside its current cell
 * produces the identical rect, so the derived set is unchanged and Svelte does
 * no work at all; the set only churns when an edge crosses a cell boundary,
 * which is once per `step` world units of pan rather than once per frame. By
 * then the margin has already rendered what is about to be revealed.
 */
import type { Bounds, Box, Size, Viewport } from './geometry';

/**
 * The world-space rectangle currently on screen, grown by `margin` world units.
 *
 * Uses the same world↔screen convention as `computeMinimap`: the world layer is
 * `translate(panX, panY) scale(zoom)`, so screen 0 is world `-panX / zoom`.
 */
export function visibleWorldRect(vp: Viewport, viewport: Size, margin = 0): Bounds {
  return {
    minX: z(-vp.panX / vp.zoom - margin),
    minY: z(-vp.panY / vp.zoom - margin),
    maxX: z((viewport.width - vp.panX) / vp.zoom + margin),
    maxY: z((viewport.height - vp.panY) / vp.zoom + margin),
  };
}

/**
 * Collapse negative zero.
 *
 * `-panX / zoom` is `-0` whenever the pan is zero, and `-0` is not `0` to
 * `Object.is`, `toEqual`, or anything else comparing rects by value — including
 * the memo that decides whether the culled set needs recomputing at all.
 */
function z(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Snap a rect outward to a `step` grid.
 *
 * Outward on every edge, never inward: rounding a boundary in would cull a card
 * that is genuinely on screen, which is a visible bug rather than a slow frame.
 */
export function quantiseRect(rect: Bounds, step: number): Bounds {
  if (!(step > 0)) return rect;
  return {
    minX: z(Math.floor(rect.minX / step) * step),
    minY: z(Math.floor(rect.minY / step) * step),
    maxX: z(Math.ceil(rect.maxX / step) * step),
    maxY: z(Math.ceil(rect.maxY / step) * step),
  };
}

/** Whether a box overlaps a rect at all. Touching edges count as overlapping. */
export function intersects(box: Box, rect: Bounds): boolean {
  return (
    box.x + box.w >= rect.minX &&
    box.x <= rect.maxX &&
    box.y + box.h >= rect.minY &&
    box.y <= rect.maxY
  );
}

/**
 * The items overlapping `rect`, in their original order.
 *
 * Order is preserved because the callers use array index for stacking and for
 * the entrance stagger — a culled list that reshuffles would make cards jump as
 * you pan.
 *
 * `keep` is for items that must render wherever they are: the card being
 * dragged (its pointer capture lives on the element), the selected card, the
 * members of a focused group. Culling one of those mid-interaction destroys the
 * node under the user's finger.
 */
export function cullToRect<T>(
  items: readonly T[],
  rect: Bounds,
  boxOf: (item: T) => Box,
  keep?: (item: T) => boolean,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (intersects(boxOf(item), rect) || keep?.(item)) out.push(item);
  }
  return out;
}

/**
 * Below this zoom a card's text is smaller than ~5px and reads as a grey smear.
 *
 * Drawing the full card subtree at that size is pure cost: it is also exactly
 * when the most cards are on screen, so it is the worst moment to be paying it.
 * Under this threshold the surfaces render a plain block of the card's size and
 * colour instead — the shape of the desk stays legible, which is all anyone is
 * reading at that zoom.
 */
export const LOD_ZOOM = 0.45;

export function isLowDetail(zoom: number): boolean {
  return zoom < LOD_ZOOM;
}
