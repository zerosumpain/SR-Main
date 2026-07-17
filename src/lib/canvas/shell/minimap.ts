// Shared minimap projection math (E1 / M5a). Extracted verbatim from the
// byte-identical `$derived.by` minimaps in the workflow canvas and the research
// desk. Only the item-bounds accumulation differs between the two surfaces
// (workflow iterates `viewNodes` with `nodeW/nodeH`; the desk iterates
// `visibleCards` with `cardW/cardH` + resolved positions), so THAT loop stays in
// each component; this module owns the shared viewport-frame folding + fit-to-
// body projection. Constants match the live 146×60 minimap body.

import type { Bounds, Size, Viewport } from './geometry';

export const MINIMAP_BODY_W = 146;
export const MINIMAP_BODY_H = 60;
export const MINIMAP_PAD = 4;

export type MinimapConstants = { bodyW?: number; bodyH?: number; pad?: number };

export type MinimapProjection = {
  scale: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  minY: number;
  frame: { x: number; y: number; w: number; h: number };
};

/**
 * Fold the current visible viewport rectangle into `itemBounds`, then fit the
 * union into the minimap body and project the viewport frame into that space.
 *
 * `itemBounds` is the raw bounds over the surface's nodes/cards (each component
 * computes it with its own width/height accessors). `viewport` is the on-screen
 * viewport size in pixels (`viewportW`/`viewportH` in the components).
 *
 * Callers keep their own emptiness guards (no nodes / zero viewport ⇒ null).
 */
export function computeMinimap(
  itemBounds: Bounds,
  vp: Viewport,
  viewport: Size,
  consts: MinimapConstants = {},
): MinimapProjection {
  const bodyW = consts.bodyW ?? MINIMAP_BODY_W;
  const bodyH = consts.bodyH ?? MINIMAP_BODY_H;
  const pad = consts.pad ?? MINIMAP_PAD;

  let minX = itemBounds.minX;
  let minY = itemBounds.minY;
  let maxX = itemBounds.maxX;
  let maxY = itemBounds.maxY;

  const viewLeft = -vp.panX / vp.zoom;
  const viewTop = -vp.panY / vp.zoom;
  const viewRight = (viewport.width - vp.panX) / vp.zoom;
  const viewBottom = (viewport.height - vp.panY) / vp.zoom;
  if (viewLeft < minX) minX = viewLeft;
  if (viewTop < minY) minY = viewTop;
  if (viewRight > maxX) maxX = viewRight;
  if (viewBottom > maxY) maxY = viewBottom;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const innerW = bodyW - pad * 2;
  const innerH = bodyH - pad * 2;
  const scale = Math.min(innerW / worldW, innerH / worldH);
  const offsetX = pad + (innerW - worldW * scale) / 2;
  const offsetY = pad + (innerH - worldH * scale) / 2;

  return {
    scale,
    offsetX,
    offsetY,
    minX,
    minY,
    frame: {
      x: offsetX + (viewLeft - minX) * scale,
      y: offsetY + (viewTop - minY) * scale,
      w: Math.max(2, (viewRight - viewLeft) * scale),
      h: Math.max(2, (viewBottom - viewTop) * scale),
    },
  };
}
