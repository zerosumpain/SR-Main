// The geometry behind the hand-authored SVG on the health hub.
//
// These charts are drawn by hand rather than through `LineChart` / `Bars`
// because the design's framing is the point: a 26px sparkline with no axis, a
// forecast cone that opens from today's dot, a band gauge whose segments are
// `fr` columns. What the shared components draw is a different chart.
//
// Two rules hold everywhere below:
//
//  * VIEWBOXES ARE PADDED where anything is drawn at the edge — an endpoint
//    marker or an axis label rendered at x=0 is half outside the box and gets
//    clipped by the viewport, not by CSS, so no amount of `overflow` saves it.
//  * A SERIES OF ONE HAS NO LINE. Every helper returns an empty string rather
//    than a `NaN`-riddled path when there is nothing to draw, so a thin metric
//    renders as an empty frame instead of a broken one.

export interface Extent {
  lo: number;
  hi: number;
}

/** Min/max with a floor on the span, so a flat series draws down the middle. */
export function extent(values: number[], pad = 0.05): Extent {
  if (!values.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!(hi > lo)) {
    const centre = hi || 1;
    return { lo: centre - Math.abs(centre) * 0.1 - 1, hi: centre + Math.abs(centre) * 0.1 + 1 };
  }
  const room = (hi - lo) * pad;
  lo -= room;
  hi += room;
  return { lo, hi };
}

/** Widen an extent so it also contains `value` — for a target line off-scale. */
export function include(e: Extent, value: number | null | undefined): Extent {
  if (!Number.isFinite(value)) return e;
  const v = value as number;
  if (v >= e.lo && v <= e.hi) return e;
  const lo = Math.min(e.lo, v);
  const hi = Math.max(e.hi, v);
  const room = (hi - lo) * 0.05;
  return { lo: lo - room, hi: hi + room };
}

/** Value → y, with the axis inverted the way every chart on this site draws. */
export function yOf(value: number, e: Extent, height: number): number {
  const span = e.hi - e.lo || 1;
  return height - ((value - e.lo) / span) * height;
}

/** `0,18 12,21 …` for a `<polyline points>`, evenly spaced across the width. */
export function sparkPoints(values: number[], width: number, height: number, e?: Extent): string {
  if (values.length < 2) return '';
  const ext = e ?? extent(values);
  const step = width / (values.length - 1);
  return values
    .map((v, i) => `${(i * step).toFixed(2)},${yOf(v, ext, height).toFixed(2)}`)
    .join(' ');
}

/** The same, but each point carries its own x — for an irregular date series. */
export function pointsAt(
  points: Array<{ x: number; value: number }>,
  height: number,
  e: Extent,
): string {
  if (points.length < 2) return '';
  return points.map((p) => `${p.x.toFixed(2)},${yOf(p.value, e, height).toFixed(2)}`).join(' ');
}

/** Bar rects across a fixed width — the week-volume tile and the monotony deck. */
export function bars(
  values: number[],
  width: number,
  height: number,
  gap = 4,
): Array<{ x: number; y: number; w: number; h: number }> {
  if (!values.length) return [];
  const hi = Math.max(...values, 0);
  const slot = width / values.length;
  const w = Math.max(1, slot - gap);
  return values.map((v, i) => {
    const h = hi > 0 ? Math.max(1, (v / hi) * height) : 1;
    return { x: i * slot + gap / 2, y: height - h, w, h };
  });
}

/** Percentage heights for a CSS bar column — the deck's seven-day strip. */
export function barHeights(values: number[]): number[] {
  const hi = Math.max(...values, 0);
  if (!(hi > 0)) return values.map(() => 4);
  return values.map((v) => Math.max(4, Math.round((v / hi) * 100)));
}

/** Evenly-sampled subset, oldest first — a 30-day series into a 9-point spark. */
export function sample(values: number[], count: number): number[] {
  if (values.length <= count) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) out.push(values[Math.round(i * step)]);
  return out;
}
