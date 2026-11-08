// sky-ground.ts — the colour arithmetic under the place view's sky (sky.ts),
// and the one part of that sky the rest of the home page needs: the ground,
// which the place view carries on down the page below the hero.
//
// Kept apart from sky.ts so the home page's eager chunk, which paints that
// ground on first render for every view, carries these few lines rather
// than the whole sky (its stops, the light model and the contrast holds),
// which lives in the place view's own lazy chunks.
//
// Pure: numbers in, colours out.

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const r2 = (n: number) => Math.round(n * 100) / 100;
/** 0 below `a`, 1 above `b`, an S-curve between. */
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export type Rgb = [number, number, number];
export const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
export const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Two #rrggbb colours mixed, `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const A = hex(a);
  const B = hex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

/** How sunlit the scene is at a sun altitude in degrees, 0 (night) .. 1 (full day). */
export function daylightAt(alt: number): number {
  return r2(smooth(-8, 18, alt));
}

/** The street-level ground at night and in full day. */
const GROUND: [string, string] = ['#0b0806', '#131a23'];

/** The ground at street level (the hero's promenade, the page below it), #rrggbb: night ink, a blue-grey by day. */
export function groundAt(alt: number): string {
  return mix(GROUND[0], GROUND[1], daylightAt(alt));
}
