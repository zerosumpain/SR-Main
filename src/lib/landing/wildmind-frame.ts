// wildmind-frame.ts — the frame a Wildmind map is drawn in: the map itself,
// or the map centred in a box of a fixed aspect (the sentence view's plate).
// Its own module because the shared map component needs only this, and the
// label placing in wildmind-labels.ts belongs to the sentence view's chunk.

/** A rectangle in map units: the viewBox the map is drawn in. */
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The frame a map is drawn in. With no `frame` it is the map itself; with one
 * the map is centred in a box of that aspect at least `minW` units wide, so
 * the figure keeps one shape (and the page under it never moves) as the map
 * grows, and a young valley sits small on a large sheet. The map keeps a
 * margin inside the frame (FRAME_PAD of its width, at least FRAME_PAD_MIN
 * units), so no coast ever runs flat into the neat line.
 */
export function frameRect(map: { w: number; h: number }, frame?: { aspect: number; minW: number }): FrameRect {
  if (!frame || !(frame.aspect > 0)) return { x: 0, y: 0, w: map.w, h: map.h };
  const pad = Math.max(FRAME_PAD_MIN, FRAME_PAD * map.w);
  const w = Math.max(map.w + 2 * pad, (map.h + 2 * pad) * frame.aspect, frame.minW);
  const h = w / frame.aspect;
  return { x: (map.w - w) / 2, y: (map.h - h) / 2, w, h };
}

/** The margin round a map inside a fixed frame: a share of its width, and at least this many units. */
export const FRAME_PAD = 0.04;
export const FRAME_PAD_MIN = 3;
