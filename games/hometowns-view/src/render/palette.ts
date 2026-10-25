// Colours for the M0 harness map, and the small colour arithmetic the model
// needs. Warm pastels in the "toy-town Britain" direction (§9.15); WP8's
// atlases replace the flat fills later. All colours are 0xRRGGBB numbers.

/** Terrain, by TERRAIN_KINDS index: grass, water, sand, forest, hill, rock. */
export const TERRAIN: readonly number[] = [0xa8d08d, 0x7cb8de, 0xecdcae, 0x6fa36a, 0xbfcf94, 0xa39f94];

export const ROADS: Record<string, number> = {
  lane: 0xcdbb98,
  street: 0xb0aaa2,
  avenue: 0x8f8a84,
  county: 0x7d7268,
};
export const RAIL = 0x6d5a4b;

/** Empty zoned lots, by ZONES index: homes, shops, leisure, industry, offices, farms. */
export const ZONE_LOT: readonly number[] = [0xeccfb4, 0xc4dbf0, 0xe0cdef, 0xebdba6, 0xbfe3dc, 0xe6e1a8];
/** Built blocks, by ZONES index (shaded by level). */
export const ZONE_BUILT: readonly number[] = [0xd9825b, 0x5f98d1, 0xa77bd0, 0xc89a2e, 0x3fa596, 0xb9ae4a];

/** Civic buildings, by catalogue group. */
export const BUILDING_GROUP: Record<string, number> = {
  civic: 0xf4f1ea,
  transit: 0x4a6fa5,
  freight: 0x6b6f78,
  gateway: 0x5b5f97,
  power: 0xf2c14e,
  water: 0x4fa3d1,
  police: 0x3a5a98,
  fire: 0xd9534f,
  health: 0xf28aa0,
  primary: 0xf39c6b,
  secondary: 0xe07b39,
  library: 0x9b6b43,
  university: 0x7d4e9e,
  park: 0x5fb35a,
  fun: 0x58c4b0,
  culture: 0xb36aa8,
  attraction: 0xe76f9a,
  youth: 0x8fbf3f,
  landmark: 0xc9a227,
};

/** Locked parcels are drawn at this brightness. */
export const LOCKED_SHADE = 0.72;

/**
 * The lens ramp: five steps of a colour-blind-safe sequential scale (dark
 * blue through teal and green to yellow, evenly spaced in lightness), so
 * "more" always reads as "lighter" whatever a viewer's colour vision (§9.4).
 */
export const LENS_RAMP: readonly number[] = [0x2b3a67, 0x2f6f8f, 0x2fa38c, 0x8cc865, 0xf2e35b];

const r = (c: number) => (c >> 16) & 255;
const g = (c: number) => (c >> 8) & 255;
const b = (c: number) => c & 255;
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const rgb = (rr: number, gg: number, bb: number) => (clamp(rr) << 16) | (clamp(gg) << 8) | clamp(bb);

/** Brightness × f (f > 1 lightens). */
export function shade(c: number, f: number): number {
  return rgb(r(c) * f, g(c) * f, b(c) * f);
}

/** a → b by s (0 = a, 1 = b). */
export function mix(a: number, bb: number, s: number): number {
  return rgb(r(a) + (r(bb) - r(a)) * s, g(a) + (g(bb) - g(a)) * s, b(a) + (b(bb) - b(a)) * s);
}

/** A light grey of the same lightness, for the map under a lens. */
export function grey(c: number): number {
  const y = 0.3 * r(c) + 0.59 * g(c) + 0.11 * b(c);
  const v = 150 + y * 0.35;
  return rgb(v, v, v);
}

/** 0xRRGGBB → "#rrggbb" for CSS (the legend). */
export function css(c: number): string {
  return '#' + (c + 0x1000000).toString(16).slice(1);
}
