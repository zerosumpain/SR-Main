// The town's low-poly art (spec §9.15's "toy-town Britain"): what a built
// tile, a catalogue building, a tree or a car looks like, drawn with flat
// shaded polygons into a Pixi Graphics. map.ts decides when and in what order
// things are painted; this file only knows how each one looks.
//
// Everything is placed in tile space (x, y on the ground, z up in world
// units) through a Pen, which projects to soft 2:1 isometric or to the flat
// top-down planning view. In top-down a solid is its roof and the fine detail
// (windows, awnings, signs) is skipped; it is also skipped at the far zoom
// (`hi` false), where it would be a pixel and would only cost triangles.
//
// Light comes from the front left: a solid's left face (facing +y) is lit,
// its right face (facing +x) is in shade, and shadows fall back and right.
// The zone's colour (the model's `block`) is always the biggest surface a
// building shows, roofs for houses, facades for offices, so the zones still
// read at a glance; under a lens the trim colours go grey with the map.

import type { Graphics } from 'pixi.js';
import { grey, mix, shade } from './palette';
import type { BuildingRect } from './model';

/** Isometric half-width and half-height of a tile (map.ts's HW and HH). */
const HW = 12;
const HH = 6;
/** Top-down tile size (map.ts's TILE). */
const TILE = 12;

export interface Pen {
  g: Graphics;
  /** Flat top-down planning view. */
  top: boolean;
  /** Fine detail (windows, signs, people-sized things): off at the far zoom. */
  hi: boolean;
  /** A lens greys the map: trim colours go grey too. */
  lens: boolean;
}

/** A point in tile space (z up, world units) on screen. */
export function pt(p: Pen, gx: number, gy: number, z = 0): [number, number] {
  return p.top ? [gx * TILE, gy * TILE] : [(gx - gy) * HW, (gx + gy) * HH - z];
}

/** A trim colour (windows, doors, signs): grey under a lens. */
const c = (p: Pen, colour: number) => (p.lens ? grey(colour) : colour);

/** A stable 0..1 per tile and salt, so a town looks the same every time it is drawn. */
export function rnd(x: number, y: number, salt = 0): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- Palette -------------------------------------------------------------------------------------

const GLASS = 0x41566d;
const GLASS_SKY = 0x8fb4cf;
const LIT = 0xf3d58a;
const FRAME = 0xf6f1e7;
const DOOR = 0x5b3a29;
const STONE = 0xe9e2d2;
const SLATE = 0x5d6672;
const BRICK = [0xb8664a, 0xa95b45, 0xc77d5c];
const RENDER = [0xf2e8d5, 0xeadfc8, 0xf5efe3, 0xe8d9bd];
const GREEN = 0x5f9e54;
const GREEN_DARK = 0x3f7a43;
const LEAF = [0x5ea65a, 0x4f9a55, 0x6db35f, 0x7aa84f];
const TRUNK = 0x7a5536;
const METAL = 0xb9bdc2;
const DARK = 0x3a3f46;
const WATER = 0x6fb2dc;
const RED = 0xc8443a;
const WHITE = 0xfaf8f2;
const CAR_COLOURS = [0xd8433b, 0x2f6fb2, 0xf1c232, 0xeeeeea, 0x2b2f36, 0x4f9a55, 0x9a9fa6, 0xe07b39, 0x7d4e9e];

// ---- Primitives ----------------------------------------------------------------------------------

type P3 = [number, number, number];

/** A polygon through tile-space points. */
export function poly(p: Pen, pts: P3[], colour: number, alpha = 1): void {
  const flat: number[] = [];
  for (const [x, y, z] of pts) {
    const [sx, sy] = pt(p, x, y, z);
    flat.push(sx, sy);
  }
  p.g.poly(flat).fill({ color: colour, alpha });
}

/** A line in tile space. */
function line(p: Pen, a: P3, b: P3, colour: number, width = 0.6, alpha = 1): void {
  const [ax, ay] = pt(p, ...a);
  const [bx, by] = pt(p, ...b);
  p.g.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color: colour, alpha });
}

/** A solid box over [x0, x1] × [y0, y1] from z0 up to z1: left face, right face, roof. */
export function prism(p: Pen, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, colour: number, alpha = 1): void {
  if (p.top) {
    const [ax, ay] = pt(p, x0, y0);
    const [cx, cy] = pt(p, x1, y1);
    p.g.rect(ax, ay, cx - ax, cy - ay).fill({ color: colour, alpha });
    // A taller solid gets a deeper shaded edge, so heights still read from above.
    const d = Math.min((cy - ay) * 0.4, 0.6 + z1 / 10);
    if (z1 - z0 > 1) p.g.rect(ax, cy - d, cx - ax, d).fill({ color: shade(colour, 0.78), alpha });
    return;
  }
  poly(p, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], shade(colour, 0.84), alpha);
  poly(p, [[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]], shade(colour, 0.66), alpha);
  poly(p, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], colour, alpha);
}

/** A roof edge (parapet) round a flat roof at z: a thin raised rim. */
function parapet(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, colour: number): void {
  if (p.top || !p.hi) return;
  const t = 0.05;
  prism(p, x0, y0, x1, y0 + t, z, z + 0.9, colour);
  prism(p, x0, y0, x0 + t, y1, z, z + 0.9, colour);
  prism(p, x0, y1 - t, x1, y1, z, z + 0.9, colour);
  prism(p, x1 - t, y0, x1, y1, z, z + 0.9, colour);
}

/** A pitched roof on walls ending at z, its ridge `rise` higher, running along x ('x') or y ('y'). */
export function gable(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, rise: number, roof: number, wall: number, along: 'x' | 'y', over = 0.05): void {
  if (p.top) {
    const [ax, ay] = pt(p, x0 - over, y0 - over);
    const [cx, cy] = pt(p, x1 + over, y1 + over);
    if (along === 'x') {
      const my = (ay + cy) / 2;
      p.g.rect(ax, ay, cx - ax, my - ay).fill(shade(roof, 0.8));
      p.g.rect(ax, my, cx - ax, cy - my).fill(roof);
    } else {
      const mx = (ax + cx) / 2;
      p.g.rect(ax, ay, mx - ax, cy - ay).fill(shade(roof, 0.8));
      p.g.rect(mx, ay, cx - mx, cy - ay).fill(roof);
    }
    return;
  }
  const r = z + rise;
  if (along === 'x') {
    const ym = (y0 + y1) / 2;
    // Back slope (facing -y), the gable end at x1 (facing +x), then the front slope.
    poly(p, [[x0 - over, y0 - over, z], [x1 + over, y0 - over, z], [x1 + over, ym, r], [x0 - over, ym, r]], shade(roof, 0.72));
    poly(p, [[x1, y0, z], [x1, y1, z], [x1, ym, r]], shade(wall, 0.66));
    poly(p, [[x0 - over, ym, r], [x1 + over, ym, r], [x1 + over, y1 + over, z], [x0 - over, y1 + over, z]], roof);
  } else {
    const xm = (x0 + x1) / 2;
    // Back slope (facing -x), the gable end at y1 (facing +y), then the front slope (facing +x).
    poly(p, [[x0 - over, y0 - over, z], [xm, y0 - over, r], [xm, y1 + over, r], [x0 - over, y1 + over, z]], shade(roof, 0.95));
    poly(p, [[x0, y1, z], [x1, y1, z], [xm, y1, r]], shade(wall, 0.84));
    poly(p, [[xm, y0 - over, r], [x1 + over, y0 - over, z], [x1 + over, y1 + over, z], [xm, y1 + over, r]], shade(roof, 0.74));
  }
}

/** A hipped (or, with a point ridge, pyramid) roof: four slopes up to a ridge inset by `inset`. */
export function hip(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, rise: number, roof: number, inset = 0.5): void {
  if (p.top) {
    prism(p, x0, y0, x1, y1, z, z, roof);
    return;
  }
  const r = z + rise;
  const ix = Math.min(inset, (x1 - x0) / 2);
  const iy = Math.min(inset, (y1 - y0) / 2);
  const a: P3 = [x0 + ix, y0 + iy, r];
  const b: P3 = [x1 - ix, y0 + iy, r];
  const cc: P3 = [x1 - ix, y1 - iy, r];
  const d: P3 = [x0 + ix, y1 - iy, r];
  poly(p, [[x0, y0, z], [x1, y0, z], b, a], shade(roof, 0.72)); // back
  poly(p, [[x0, y0, z], a, d, [x0, y1, z]], shade(roof, 0.9)); // left back
  poly(p, [[x1, y0, z], [x1, y1, z], cc, b], shade(roof, 0.74)); // right
  poly(p, [[x0, y1, z], d, cc, [x1, y1, z]], roof); // front
}

/** An upright cylinder (8 sides) centred on (x, y), radius r tiles, from z0 to z1. */
export function cylinder(p: Pen, x: number, y: number, r: number, z0: number, z1: number, colour: number, topColour = shade(colour, 1.08)): void {
  const [sx, sy] = pt(p, x, y, 0);
  if (p.top) {
    p.g.circle(sx, sy, r * TILE).fill(topColour);
    return;
  }
  const rx = r * HW * Math.SQRT2;
  const ry = r * HH * Math.SQRT2;
  p.g.ellipse(sx, sy - z0, rx, ry).fill(shade(colour, 0.7));
  p.g.rect(sx - rx, sy - z1, rx, z1 - z0).fill(shade(colour, 0.86));
  p.g.rect(sx, sy - z1, rx, z1 - z0).fill(shade(colour, 0.68));
  p.g.ellipse(sx, sy - z1, rx, ry).fill(topColour);
}

/** A cone (or a dome-ish cap when `round`) on a circle of radius r at z0, apex at z1. */
function cone(p: Pen, x: number, y: number, r: number, z0: number, z1: number, colour: number): void {
  const [sx, sy] = pt(p, x, y, 0);
  if (p.top) {
    p.g.circle(sx, sy, r * TILE).fill(colour);
    return;
  }
  const rx = r * HW * Math.SQRT2;
  const ry = r * HH * Math.SQRT2;
  p.g.ellipse(sx, sy - z0, rx, ry).fill(shade(colour, 0.7));
  p.g.poly([sx - rx, sy - z0, sx, sy - z0 + ry, sx, sy - z1]).fill(shade(colour, 0.95));
  p.g.poly([sx, sy - z0 + ry, sx + rx, sy - z0, sx, sy - z1]).fill(shade(colour, 0.72));
}

/** A dome: stacked shrinking ellipses on a drum. */
function dome(p: Pen, x: number, y: number, r: number, z: number, colour: number): void {
  if (p.top) {
    cylinder(p, x, y, r, z, z, colour);
    return;
  }
  const [sx, sy] = pt(p, x, y, 0);
  const rx = r * HW * Math.SQRT2;
  const ry = r * HH * Math.SQRT2;
  const steps = [1, 0.92, 0.78, 0.56, 0.3];
  for (let k = 0; k < steps.length; k++) {
    const f = steps[k];
    const zz = z + (r * 10) * Math.sqrt(1 - f * f) + k * 0.3;
    p.g.ellipse(sx, sy - zz, rx * f, ry * f).fill(shade(colour, 0.78 + 0.07 * k));
  }
}

/** A grid of windows on the lit left face (y = fy, x from x0 to x1) between z0 and z1. */
function windowsL(p: Pen, x0: number, x1: number, fy: number, z0: number, z1: number, cols: number, rows: number, seed: number, glass = GLASS): void {
  if (p.top || !p.hi || cols < 1 || rows < 1) return;
  const cw = (x1 - x0) / cols;
  const rh = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const u0 = x0 + cw * (k + 0.22);
      const u1 = x0 + cw * (k + 0.78);
      const v0 = z0 + rh * (r + 0.25);
      const v1 = z0 + rh * (r + 0.8);
      const lit = rnd(seed + k, r, 7) < 0.18;
      poly(p, [[u0, fy, v0], [u1, fy, v0], [u1, fy, v1], [u0, fy, v1]], c(p, lit ? LIT : shade(glass, 1.15)));
    }
}

/** The same on the shaded right face (x = fx, y from y0 to y1). */
function windowsR(p: Pen, fx: number, y0: number, y1: number, z0: number, z1: number, cols: number, rows: number, seed: number, glass = GLASS): void {
  if (p.top || !p.hi || cols < 1 || rows < 1) return;
  const cw = (y1 - y0) / cols;
  const rh = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const u0 = y0 + cw * (k + 0.22);
      const u1 = y0 + cw * (k + 0.78);
      const v0 = z0 + rh * (r + 0.25);
      const v1 = z0 + rh * (r + 0.8);
      const lit = rnd(seed + 31, r + k * 7, 9) < 0.14;
      poly(p, [[fx, u0, v0], [fx, u1, v0], [fx, u1, v1], [fx, u0, v1]], c(p, lit ? shade(LIT, 0.85) : glass));
    }
}

/** Windows on both visible faces of a solid. */
function windows(p: Pen, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, rows: number, seed: number, glass = GLASS, perTile = 3): void {
  windowsL(p, x0, x1, y1, z0, z1, Math.max(1, Math.round((x1 - x0) * perTile)), rows, seed, glass);
  windowsR(p, x1, y0, y1, z0, z1, Math.max(1, Math.round((y1 - y0) * perTile)), rows, seed, glass);
}

/** Continuous glass bands (an office's ribbon windows) on both visible faces. */
function bands(p: Pen, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, rows: number, glass: number): void {
  if (p.top || !p.hi) return;
  const rh = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++) {
    const v0 = z0 + rh * (r + 0.3);
    const v1 = z0 + rh * (r + 0.85);
    poly(p, [[x0 + 0.03, y1, v0], [x1 - 0.03, y1, v0], [x1 - 0.03, y1, v1], [x0 + 0.03, y1, v1]], c(p, shade(glass, 1.12)));
    poly(p, [[x1, y1 - 0.03, v0], [x1, y0 + 0.03, v0], [x1, y0 + 0.03, v1], [x1, y1 - 0.03, v1]], c(p, glass));
  }
}

/** Vertical mullions over a curtain wall. */
function mullions(p: Pen, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, n: number, colour: number): void {
  if (p.top || !p.hi) return;
  for (let k = 1; k < n; k++) {
    const u = x0 + ((x1 - x0) * k) / n;
    line(p, [u, y1, z0], [u, y1, z1], colour, 0.35, 0.7);
    const v = y0 + ((y1 - y0) * k) / n;
    line(p, [x1, v, z0], [x1, v, z1], colour, 0.35, 0.6);
  }
}

/** A door on the lit face. */
function door(p: Pen, x: number, fy: number, w: number, h: number, colour = DOOR): void {
  if (p.top || !p.hi) return;
  poly(p, [[x - w / 2, fy, 0], [x + w / 2, fy, 0], [x + w / 2, fy, h], [x - w / 2, fy, h]], c(p, colour));
}

/** A striped shop awning along the lit face and the shaded face, hung at z. */
function awning(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, colour: number, stripes = 6): void {
  if (p.top || !p.hi) return;
  const out = 0.12;
  const drop = 1.2;
  const w = (x1 - x0) / stripes;
  for (let k = 0; k < stripes; k++) {
    const col = k % 2 ? c(p, WHITE) : colour;
    poly(p, [[x0 + k * w, y1, z], [x0 + (k + 1) * w, y1, z], [x0 + (k + 1) * w, y1 + out, z - drop], [x0 + k * w, y1 + out, z - drop]], col);
  }
  const h = (y1 - y0) / stripes;
  for (let k = 0; k < stripes; k++) {
    const col = k % 2 ? c(p, shade(WHITE, 0.8)) : shade(colour, 0.78);
    poly(p, [[x1, y1 - k * h, z], [x1, y1 - (k + 1) * h, z], [x1 + out, y1 - (k + 1) * h, z - drop], [x1 + out, y1 - k * h, z - drop]], col);
  }
}

/** A shopfront: a glass band with a sign over it on both visible faces. */
function shopfront(p: Pen, x0: number, y0: number, x1: number, y1: number, sign: number): void {
  if (p.top || !p.hi) return;
  poly(p, [[x0 + 0.04, y1, 0.3], [x1 - 0.04, y1, 0.3], [x1 - 0.04, y1, 2.7], [x0 + 0.04, y1, 2.7]], c(p, GLASS_SKY));
  poly(p, [[x1, y1 - 0.04, 0.3], [x1, y0 + 0.04, 0.3], [x1, y0 + 0.04, 2.7], [x1, y1 - 0.04, 2.7]], c(p, shade(GLASS_SKY, 0.8)));
  poly(p, [[x0, y1, 2.9], [x1, y1, 2.9], [x1, y1, 3.8], [x0, y1, 3.8]], sign);
  poly(p, [[x1, y1, 2.9], [x1, y0, 2.9], [x1, y0, 3.8], [x1, y1, 3.8]], shade(sign, 0.75));
}

/** A tree on (x, y): round broadleaf or a conifer, `s` about its height in storeys. */
export function tree(p: Pen, x: number, y: number, s: number, conifer: boolean, leaf: number): void {
  const [sx, sy] = pt(p, x, y, 0);
  if (p.top) {
    p.g.circle(sx, sy, 2.2 * s).fill(shade(leaf, 0.9));
    p.g.circle(sx - 0.5 * s, sy - 0.5 * s, 1.3 * s).fill(shade(leaf, 1.1));
    return;
  }
  const trunk = 1.8 * s;
  p.g.rect(sx - 0.45 * s, sy - trunk, 0.9 * s, trunk).fill(c(p, TRUNK));
  if (conifer) {
    const w = 2.6 * s;
    const h = 7 * s;
    p.g.poly([sx - w, sy - trunk, sx, sy - trunk - h, sx, sy - trunk + 0.6 * s]).fill(shade(leaf, 0.86));
    p.g.poly([sx, sy - trunk + 0.6 * s, sx, sy - trunk - h, sx + w, sy - trunk]).fill(shade(leaf, 0.66));
    return;
  }
  // A low-poly crown: a hexagon, lit on the left, with a highlight facet.
  const r = 3 * s;
  const cy = sy - trunk - r * 0.85;
  const hex = [sx - r, cy, sx - r * 0.5, cy - r * 0.9, sx + r * 0.5, cy - r * 0.9, sx + r, cy, sx + r * 0.5, cy + r * 0.85, sx - r * 0.5, cy + r * 0.85];
  p.g.poly(hex).fill(shade(leaf, 0.78));
  p.g.poly([sx - r, cy, sx - r * 0.5, cy - r * 0.9, sx + r * 0.2, cy - r * 0.2, sx - r * 0.5, cy + r * 0.85]).fill(leaf);
  p.g.poly([sx - r * 0.5, cy - r * 0.9, sx + r * 0.5, cy - r * 0.9, sx + r * 0.2, cy - r * 0.2]).fill(shade(leaf, 1.14));
}

/** A low hedge along a lot edge. */
function hedge(p: Pen, x0: number, y0: number, x1: number, y1: number): void {
  if (!p.hi) return;
  prism(p, x0, y0, x1, y1, 0, 1, c(p, GREEN_DARK));
}

/** A shadow on the ground for a solid of footprint [x0, x1] × [y0, y1], `h` world units tall. */
export function shadow(p: Pen, x0: number, y0: number, x1: number, y1: number, h: number, alpha = 0.16): void {
  if (p.top || h <= 0) return;
  // Cast back and right (light from the front left), longer for a taller block.
  const k = Math.min(3.5, h * 0.045);
  const dx = 0.35 * k;
  const dy = -1 * k;
  const pts: P3[] = [[x0, y1, 0], [x0, y0, 0], [x0 + dx, y0 + dy, 0], [x1 + dx, y0 + dy, 0], [x1 + dx, y1 + dy, 0], [x1, y1, 0]];
  poly(p, pts, 0x1d2430, alpha);
}

// ---- Zoned buildings -----------------------------------------------------------------------------

/** Zones (ZONES index) for the recipes below. */
const Z_HOMES = 0;
const Z_SHOPS = 1;
const Z_LEISURE = 2;
const Z_INDUSTRY = 3;
const Z_OFFICES = 4;
const Z_FARMS = 5;

/** How tall a built zoned tile is (for its shadow and the smoke), by zone and level. */
export function zoneHeight(zone: number, level: number): number {
  const H: Record<number, number[]> = {
    [Z_HOMES]: [0, 7, 11, 14, 24, 40],
    [Z_SHOPS]: [0, 5, 9, 14, 22, 34],
    [Z_LEISURE]: [0, 7, 8, 12, 20, 22],
    [Z_INDUSTRY]: [0, 6, 7, 9, 11, 8],
    [Z_OFFICES]: [0, 8, 13, 20, 30, 46],
    [Z_FARMS]: [0, 2, 6, 8, 9, 6],
  };
  return (H[zone] ?? H[Z_HOMES])[level] ?? 10;
}

/** Where a working factory's chimney smokes from (tile space and height), or null. */
export function chimneyTop(zone: number, level: number, x: number, y: number): [number, number, number] | null {
  if (zone !== Z_INDUSTRY || level < 1 || level > 4) return null;
  if (level >= 3) return [x + 0.27, y + 0.3, level === 3 ? 19 : 21];
  return [x + 0.3, y + 0.3, zoneHeight(zone, level) + 3];
}

/** A built zoned tile at (x, y): zone (ZONES index), level 1–5, tier 0–2, the block colour. */
export function zoned(p: Pen, x: number, y: number, zone: number, level: number, tier: number, colour: number): void {
  switch (zone) {
    case Z_HOMES:
      return homes(p, x, y, level, tier, colour);
    case Z_SHOPS:
      return shops(p, x, y, level, tier, colour);
    case Z_LEISURE:
      return leisure(p, x, y, level, tier, colour);
    case Z_INDUSTRY:
      return industry(p, x, y, level, colour);
    case Z_OFFICES:
      return offices(p, x, y, level, tier, colour);
    case Z_FARMS:
      return farms(p, x, y, level, colour);
    default:
      prism(p, x + 0.15, y + 0.15, x + 0.85, y + 0.85, 0, zoneHeight(zone, level), colour);
  }
}

function wallFor(p: Pen, x: number, y: number, tier: number, colour: number): number {
  if (p.lens) return shade(colour, 1.15);
  const r = rnd(x, y, 3);
  if (tier === 0) return r < 0.6 ? BRICK[Math.floor(r * 5) % 3] : RENDER[Math.floor(r * 7) % 4];
  if (tier === 1) return RENDER[Math.floor(r * 4) % 4];
  return r < 0.5 ? STONE : WHITE;
}

function homes(p: Pen, x: number, y: number, lv: number, tier: number, roof: number): void {
  const wall = wallFor(p, x, y, tier, roof);
  const along = rnd(x, y, 1) < 0.5 ? 'x' : 'y';
  const seed = x * 64 + y;
  if (lv === 1) {
    // A cottage in its garden: hedge, a tree, a chimney.
    if (rnd(x, y, 2) < 0.6) hedge(p, x + 0.06, y + 0.88, x + 0.94, y + 0.95);
    const [x0, y0, x1, y1] = [x + 0.24, y + 0.22, x + 0.76, y + 0.7];
    prism(p, x0, y0, x1, y1, 0, 4.4, wall);
    windowsL(p, x0, x1, y1, 0.6, 4.2, 2, 1, seed);
    windowsR(p, x1, y0, y1, 0.6, 4.2, 1, 1, seed);
    door(p, (x0 + x1) / 2, y1, 0.09, 2.6);
    prism(p, x0 + 0.06, y0 + 0.06, x0 + 0.14, y0 + 0.14, 4.4, 9.2, c(p, BRICK[1]));
    gable(p, x0, y0, x1, y1, 4.4, 4.2, roof, wall, along);
    if (rnd(x, y, 4) < 0.7) tree(p, x + 0.84, y + 0.24, 0.5, false, c(p, LEAF[Math.floor(rnd(x, y, 5) * 4)]));
    return;
  }
  if (lv === 2) {
    // A two-storey house; the richer ones get a bay and a porch.
    if (rnd(x, y, 2) < 0.5) hedge(p, x + 0.05, y + 0.9, x + 0.95, y + 0.96);
    const [x0, y0, x1, y1] = [x + 0.16, y + 0.16, x + 0.84, y + 0.76];
    prism(p, x0, y0, x1, y1, 0, 8, wall);
    windowsL(p, x0, x1, y1, 0.4, 7.8, 3, 2, seed);
    windowsR(p, x1, y0, y1, 0.4, 7.8, 2, 2, seed);
    door(p, x0 + 0.2, y1, 0.09, 2.6);
    if (tier > 0) prism(p, x0 + 0.38, y1, x0 + 0.62, y1 + 0.08, 0, 3.4, shade(wall, 0.97));
    prism(p, x1 - 0.14, y0 + 0.06, x1 - 0.06, y0 + 0.14, 8, 13, c(p, BRICK[0]));
    gable(p, x0, y0, x1, y1, 8, 4.4, roof, wall, along);
    return;
  }
  if (lv === 3) {
    // A townhouse terrace: three storeys, a mansard with dormers.
    const [x0, y0, x1, y1] = [x + 0.1, y + 0.12, x + 0.9, y + 0.84];
    prism(p, x0, y0, x1, y1, 0, 11, wall);
    windowsL(p, x0, x1, y1, 0.4, 10.8, 4, 3, seed);
    windowsR(p, x1, y0, y1, 0.4, 10.8, 3, 3, seed);
    door(p, x0 + 0.18, y1, 0.08, 2.5);
    door(p, x0 + 0.58, y1, 0.08, 2.5);
    hip(p, x0, y0, x1, y1, 11, 3, roof, 0.18);
    if (p.hi && !p.top) {
      prism(p, x0 + 0.2, y1 - 0.12, x0 + 0.32, y1 - 0.04, 11, 13.2, shade(wall, 0.95));
      prism(p, x0 + 0.5, y1 - 0.12, x0 + 0.62, y1 - 0.04, 11, 13.2, shade(wall, 0.95));
    }
    return;
  }
  if (lv === 4) {
    // A block of flats: balconies on every floor, a flat roof with a stair house.
    const [x0, y0, x1, y1] = [x + 0.1, y + 0.1, x + 0.9, y + 0.88];
    const h = 22;
    prism(p, x0, y0, x1, y1, 0, h, wall);
    windowsL(p, x0, x1, y1, 0.6, h - 0.4, 4, 6, seed);
    windowsR(p, x1, y0, y1, 0.6, h - 0.4, 3, 6, seed);
    if (p.hi && !p.top)
      for (let f = 1; f < 6; f++) {
        const z = (h / 6) * f;
        prism(p, x0 + 0.08, y1, x1 - 0.08, y1 + 0.06, z - 0.5, z, c(p, shade(WHITE, 0.92)));
      }
    // The roof in the zone's colour, so a street of flats still reads as Homes.
    prism(p, x0, y0, x1, y1, h, h + 0.6, roof);
    parapet(p, x0, y0, x1, y1, h + 0.6, shade(wall, 0.9));
    prism(p, x0 + 0.12, y0 + 0.12, x0 + 0.32, y0 + 0.3, h + 0.6, h + 3, shade(wall, 0.9));
    if (tier === 2 && p.hi) {
      prism(p, x0 + 0.4, y0 + 0.36, x1 - 0.1, y1 - 0.1, h + 0.6, h + 1, c(p, GREEN));
      tree(p, x1 - 0.2, y0 + 0.5, 0.35, false, c(p, LEAF[0]));
    }
    return;
  }
  // Level 5: a residential tower with a setback crown.
  const [x0, y0, x1, y1] = [x + 0.14, y + 0.14, x + 0.86, y + 0.86];
  const h = 36;
  prism(p, x0, y0, x1, y1, 0, h, wall);
  windowsL(p, x0, x1, y1, 0.6, h - 0.5, 3, 9, seed);
  windowsR(p, x1, y0, y1, 0.6, h - 0.5, 3, 9, seed);
  prism(p, x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12, h, h + 4, roof);
  if (tier === 2) prism(p, x0, y0, x0 + 0.12, y1, h, h + 0.8, c(p, GREEN));
  if (p.hi) line(p, [x0 + 0.4, y0 + 0.4, h + 4], [x0 + 0.4, y0 + 0.4, h + 9], c(p, METAL), 0.5);
}

function shops(p: Pen, x: number, y: number, lv: number, tier: number, colour: number): void {
  const seed = x * 64 + y + 999;
  const wall = p.lens ? shade(colour, 1.2) : rnd(x, y, 3) < 0.5 ? RENDER[Math.floor(rnd(x, y, 8) * 4)] : BRICK[Math.floor(rnd(x, y, 9) * 3)];
  if (lv <= 2) {
    // A corner shop (and, at 2, a flat above it): shopfront, sign, striped awning.
    const [x0, y0, x1, y1] = [x + 0.12, y + 0.12, x + 0.88, y + 0.82];
    const h = lv === 1 ? 5 : 9;
    prism(p, x0, y0, x1, y1, 0, h, wall);
    shopfront(p, x0, y0, x1, y1, colour);
    awning(p, x0, y0, x1, y1, 2.8, shade(colour, 1.1), 5);
    if (lv === 2) windows(p, x0, y0, x1, y1, 4.2, h - 0.2, 1, seed);
    prism(p, x0, y0, x1, y1, h, h + 0.4, shade(colour, 0.9));
    parapet(p, x0, y0, x1, y1, h + 0.4, shade(wall, 0.9));
    if (p.hi) prism(p, x0 + 0.1, y0 + 0.1, x0 + 0.26, y0 + 0.24, h + 0.4, h + 1.6, c(p, METAL));
    return;
  }
  if (lv === 3) {
    // A high-street parade: shops under two floors of flats, a cornice on top.
    const [x0, y0, x1, y1] = [x + 0.08, y + 0.08, x + 0.92, y + 0.88];
    prism(p, x0, y0, x1, y1, 0, 14, wall);
    shopfront(p, x0, y0, x1, y1, colour);
    awning(p, x0, y0, x1, y1, 2.8, shade(colour, 1.1), 6);
    windows(p, x0, y0, x1, y1, 4.2, 13.6, 2, seed);
    prism(p, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, 14, 14.8, shade(colour, 0.95));
    return;
  }
  if (lv === 4) {
    // A department store: a big glazed box, its name on a board, a rooftop plant room.
    const [x0, y0, x1, y1] = [x + 0.06, y + 0.06, x + 0.94, y + 0.9];
    const h = 22;
    prism(p, x0, y0, x1, y1, 0, h, wall);
    shopfront(p, x0, y0, x1, y1, colour);
    bands(p, x0, y0, x1, y1, 4.2, h - 4, 3, GLASS);
    if (p.hi && !p.top) {
      poly(p, [[x0 + 0.15, y1, h - 3.2], [x1 - 0.15, y1, h - 3.2], [x1 - 0.15, y1, h - 0.6], [x0 + 0.15, y1, h - 0.6]], colour);
      poly(p, [[x1, y1 - 0.15, h - 3.2], [x1, y0 + 0.15, h - 3.2], [x1, y0 + 0.15, h - 0.6], [x1, y1 - 0.15, h - 0.6]], shade(colour, 0.78));
    }
    prism(p, x0, y0, x1, y1, h, h + 0.5, shade(colour, 0.9));
    prism(p, x0 + 0.5, y0 + 0.1, x1 - 0.1, y0 + 0.4, h + 0.5, h + 2.6, c(p, METAL));
    return;
  }
  // Level 5: a glass shopping tower over a podium.
  const [x0, y0, x1, y1] = [x + 0.06, y + 0.06, x + 0.94, y + 0.94];
  prism(p, x0, y0, x1, y1, 0, 6, wall);
  shopfront(p, x0, y0, x1, y1, colour);
  const glass = p.lens ? colour : mix(colour, GLASS, 0.45);
  prism(p, x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12, 6, 34, glass);
  mullions(p, x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12, 6, 34, 5, c(p, WHITE));
  bands(p, x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12, 6, 34, 8, shade(glass, 0.8));
  prism(p, x0 + 0.24, y0 + 0.24, x1 - 0.24, y1 - 0.24, 34, 36, shade(colour, 0.9));
  if (tier === 2 && p.hi) line(p, [x0 + 0.5, y0 + 0.5, 36], [x0 + 0.5, y0 + 0.5, 42], c(p, METAL), 0.6);
}

function leisure(p: Pen, x: number, y: number, lv: number, tier: number, colour: number): void {
  const seed = x * 64 + y + 555;
  const wall = p.lens ? shade(colour, 1.2) : RENDER[Math.floor(rnd(x, y, 4) * 4)];
  if (lv === 1) {
    // A pub: whitewashed, a pitched roof in the zone colour, a hanging sign and tables outside.
    const [x0, y0, x1, y1] = [x + 0.14, y + 0.14, x + 0.78, y + 0.62];
    prism(p, x0, y0, x1, y1, 0, 5, wall);
    windows(p, x0, y0, x1, y1, 0.6, 4.8, 1, seed);
    door(p, x0 + 0.32, y1, 0.1, 2.8);
    gable(p, x0, y0, x1, y1, 5, 3.6, colour, wall, 'x');
    if (p.hi && !p.top) {
      line(p, [x0 + 0.08, y1 + 0.02, 4.2], [x0 + 0.08, y1 + 0.16, 4.2], c(p, DARK), 0.5);
      poly(p, [[x0 + 0.04, y1 + 0.16, 4], [x0 + 0.12, y1 + 0.16, 4], [x0 + 0.12, y1 + 0.16, 2.6], [x0 + 0.04, y1 + 0.16, 2.6]], c(p, 0xd9a33b));
      for (const [ux, uy] of [[0.3, 0.82], [0.6, 0.84], [0.88, 0.5]] as const) parasol(p, x + ux, y + uy, k2(x, y, ux) ? colour : c(p, RED));
    }
    return;
  }
  if (lv === 2) {
    // A restaurant with a terrace: awning, bunting, tables.
    const [x0, y0, x1, y1] = [x + 0.12, y + 0.12, x + 0.86, y + 0.7];
    prism(p, x0, y0, x1, y1, 0, 7.5, wall);
    shopfront(p, x0, y0, x1, y1, colour);
    awning(p, x0, y0, x1, y1, 2.8, colour, 6);
    windows(p, x0, y0, x1, y1, 4, 7.3, 1, seed);
    prism(p, x0, y0, x1, y1, 7.5, 8, shade(colour, 0.85));
    if (p.hi && !p.top) {
      bunting(p, [x0, y1 + 0.24, 4.5], [x1, y1 + 0.24, 4.5]);
      parasol(p, x + 0.3, y + 0.86, colour);
      parasol(p, x + 0.66, y + 0.86, c(p, 0xf2c14e));
    }
    return;
  }
  if (lv === 3) {
    // A picture house: a tall box with a lit marquee and a big sign.
    const [x0, y0, x1, y1] = [x + 0.1, y + 0.1, x + 0.9, y + 0.86];
    prism(p, x0, y0, x1, y1, 0, 12, shade(colour, 1.05));
    if (p.hi && !p.top) {
      prism(p, x0 + 0.08, y1, x1 - 0.08, y1 + 0.14, 3, 4.4, c(p, WHITE));
      for (let k = 0; k < 7; k++) {
        const [sx, sy] = pt(p, x0 + 0.12 + k * 0.09, y1 + 0.14, 3.7);
        p.g.circle(sx, sy, 0.45).fill(c(p, LIT));
      }
      poly(p, [[x0 + 0.06, y1, 0], [x1 - 0.06, y1, 0], [x1 - 0.06, y1, 2.8], [x0 + 0.06, y1, 2.8]], c(p, GLASS));
      poly(p, [[x1, y1 - 0.2, 5.5], [x1, y0 + 0.2, 5.5], [x1, y0 + 0.2, 11], [x1, y1 - 0.2, 11]], c(p, shade(LIT, 0.8)));
    }
    prism(p, x0, y0, x1, y1, 12, 12.6, shade(colour, 0.8));
    return;
  }
  if (lv === 4) {
    // A hotel: a slab of rooms, a canopy over the door and, for the smart ones, a rooftop pool.
    const [x0, y0, x1, y1] = [x + 0.1, y + 0.1, x + 0.9, y + 0.88];
    prism(p, x0, y0, x1, y1, 0, 20, wall);
    windows(p, x0, y0, x1, y1, 3.5, 19.6, 5, seed);
    prism(p, x0 + 0.25, y1, x1 - 0.25, y1 + 0.16, 2.6, 3.2, colour);
    poly(p, [[x0 + 0.04, y1, 0.2], [x1 - 0.04, y1, 0.2], [x1 - 0.04, y1, 2.4], [x0 + 0.04, y1, 2.4]], c(p, GLASS_SKY));
    prism(p, x0, y0, x1, y1, 20, 20.6, colour);
    parapet(p, x0, y0, x1, y1, 20.6, shade(wall, 0.9));
    if (tier > 0 && p.hi) prism(p, x0 + 0.15, y0 + 0.2, x1 - 0.3, y1 - 0.2, 20.6, 20.8, c(p, WATER));
    return;
  }
  // Level 5: an entertainment dome on a drum, flags round it.
  prism(p, x + 0.08, y + 0.08, x + 0.92, y + 0.92, 0, 4, wall);
  shopfront(p, x + 0.08, y + 0.08, x + 0.92, y + 0.92, colour);
  cylinder(p, x + 0.5, y + 0.5, 0.36, 4, 10, shade(colour, 1.1), colour);
  dome(p, x + 0.5, y + 0.5, 0.36, 10, colour);
  if (p.hi) line(p, [x + 0.5, y + 0.5, 14], [x + 0.5, y + 0.5, 20], c(p, METAL), 0.6);
}

function k2(x: number, y: number, s: number): boolean {
  return rnd(x, y, Math.floor(s * 100)) < 0.5;
}

/** A café parasol: a pole and a little cone. */
function parasol(p: Pen, x: number, y: number, colour: number): void {
  if (p.top || !p.hi) return;
  line(p, [x, y, 0], [x, y, 2.6], c(p, DARK), 0.4);
  cone(p, x, y, 0.09, 2.4, 3.4, colour);
}

/** A string of bunting between two points. */
function bunting(p: Pen, a: P3, b: P3): void {
  line(p, a, b, c(p, DARK), 0.3, 0.6);
  const cols = [RED, 0xf2c14e, 0x2f6fb2, WHITE, 0x4f9a55];
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const [sx, sy] = pt(p, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    p.g.poly([sx - 0.7, sy, sx + 0.7, sy, sx, sy + 1.4]).fill(c(p, cols[k % cols.length]));
  }
}

function industry(p: Pen, x: number, y: number, lv: number, colour: number): void {
  const metal = c(p, METAL);
  if (lv === 1) {
    // A workshop: a corrugated shed and a roller door.
    const [x0, y0, x1, y1] = [x + 0.14, y + 0.16, x + 0.86, y + 0.78];
    prism(p, x0, y0, x1, y1, 0, 4.5, shade(colour, 1.12));
    rollerDoor(p, x0 + 0.2, x0 + 0.46, y1, 3.2);
    gable(p, x0, y0, x1, y1, 4.5, 2.4, metal, shade(colour, 1.12), 'x', 0.03);
    ribs(p, x0, x1, y0, y1, 4.5, 2.4);
    if (p.hi) crates(p, x + 0.18, y + 0.84, colour);
    return;
  }
  if (lv === 2) {
    // A warehouse: a sawtooth roof of north lights, loading bays.
    const [x0, y0, x1, y1] = [x + 0.08, y + 0.1, x + 0.92, y + 0.84];
    prism(p, x0, y0, x1, y1, 0, 5.5, shade(colour, 1.1));
    rollerDoor(p, x0 + 0.1, x0 + 0.34, y1, 3.6);
    rollerDoor(p, x0 + 0.46, x0 + 0.7, y1, 3.6);
    sawtooth(p, x0, y0, x1, y1, 5.5, 3, colour);
    return;
  }
  if (lv <= 4) {
    // A factory (and, at 4, its tanks): sawtooth sheds and a banded chimney.
    const [x0, y0, x1, y1] = [x + 0.06, y + 0.08, x + 0.94, y + 0.9];
    const tanks = lv === 4;
    const sx1 = tanks ? x + 0.62 : x1;
    prism(p, x0, y0, sx1, y1, 0, 6.5, shade(colour, 1.05));
    rollerDoor(p, x0 + 0.12, x0 + 0.36, y1, 4);
    sawtooth(p, x0, y0, sx1, y1, 6.5, 3, colour);
    chimney(p, x + 0.27, y + 0.3, lv === 3 ? 19 : 21);
    if (tanks) {
      cylinder(p, x + 0.8, y + 0.3, 0.13, 0, 8, metal, shade(metal, 1.1));
      cylinder(p, x + 0.8, y + 0.7, 0.13, 0, 8, metal, shade(metal, 1.1));
      if (p.hi) line(p, [x + 0.62, y + 0.5, 5], [x + 0.8, y + 0.5, 5], c(p, DARK), 0.6);
    }
    return;
  }
  // Level 5: clean makers' sheds, solar panels on the roof.
  const [x0, y0, x1, y1] = [x + 0.08, y + 0.1, x + 0.92, y + 0.88];
  prism(p, x0, y0, x1, y1, 0, 7, shade(colour, 1.18));
  bands(p, x0, y0, x1, y1, 0.5, 6.5, 2, GLASS);
  if (p.hi && !p.top)
    for (let k = 0; k < 3; k++) {
      const a = x0 + 0.08 + k * 0.26;
      poly(p, [[a, y0 + 0.1, 7.2], [a + 0.2, y0 + 0.1, 7.2], [a + 0.2, y1 - 0.1, 8.4], [a, y1 - 0.1, 8.4]], c(p, 0x2c4a7a));
    }
  else prism(p, x0, y0, x1, y1, 7, 7.2, c(p, 0x2c4a7a));
}

function rollerDoor(p: Pen, x0: number, x1: number, fy: number, h: number): void {
  if (p.top || !p.hi) return;
  poly(p, [[x0, fy, 0], [x1, fy, 0], [x1, fy, h], [x0, fy, h]], c(p, 0x9aa0a6));
  for (let k = 1; k < 5; k++) line(p, [x0, fy, (h * k) / 5], [x1, fy, (h * k) / 5], c(p, 0x7b8188), 0.25);
}

/** Ribs on a corrugated roof running along x. */
function ribs(p: Pen, x0: number, x1: number, y0: number, y1: number, z: number, rise: number): void {
  if (p.top || !p.hi) return;
  const ym = (y0 + y1) / 2;
  for (let k = 1; k < 6; k++) {
    const u = x0 + ((x1 - x0) * k) / 6;
    line(p, [u, ym, z + rise], [u, y1 + 0.03, z], c(p, 0x8f969d), 0.25);
  }
}

/** A sawtooth roof: teeth along x, glazing facing back. */
function sawtooth(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, n: number, colour: number): void {
  if (p.top) {
    prism(p, x0, y0, x1, y1, z, z, shade(colour, 0.95));
    return;
  }
  const d = (y1 - y0) / n;
  for (let k = 0; k < n; k++) {
    const a = y0 + k * d;
    const b = a + d;
    // The slope up from the back of the tooth, its end, then the glazing upright at its front.
    poly(p, [[x0, a, z], [x1, a, z], [x1, b, z + 2.4], [x0, b, z + 2.4]], shade(colour, 0.92));
    poly(p, [[x1, a, z], [x1, b, z], [x1, b, z + 2.4]], shade(colour, 0.7));
    poly(p, [[x0, b, z], [x1, b, z], [x1, b, z + 2.4], [x0, b, z + 2.4]], c(p, GLASS_SKY));
  }
}

/** A brick chimney with white bands. */
function chimney(p: Pen, x: number, y: number, h: number): void {
  cylinder(p, x, y, 0.07, 0, h, c(p, BRICK[0]), c(p, DARK));
  if (p.hi && !p.top) {
    const [sx, sy] = pt(p, x, y, 0);
    const rx = 0.07 * HW * Math.SQRT2;
    for (const zz of [h - 2.4, h - 4.4]) p.g.rect(sx - rx, sy - zz - 0.8, rx * 2, 0.8).fill(c(p, WHITE));
  }
}

function crates(p: Pen, x: number, y: number, colour: number): void {
  prism(p, x, y - 0.06, x + 0.1, y + 0.04, 0, 1.2, c(p, 0xa77b4f));
  prism(p, x + 0.12, y - 0.06, x + 0.22, y + 0.04, 0, 1.2, shade(colour, 0.9));
}

function offices(p: Pen, x: number, y: number, lv: number, tier: number, colour: number): void {
  const glass = p.lens ? shade(colour, 0.8) : mix(colour, GLASS, 0.5);
  const stone = p.lens ? shade(colour, 1.2) : tier === 2 ? WHITE : STONE;
  if (lv <= 2) {
    // A small office: ribbon windows between stone bands.
    const [x0, y0, x1, y1] = [x + 0.1, y + 0.12, x + 0.9, y + 0.86];
    const h = lv === 1 ? 8 : 13;
    prism(p, x0, y0, x1, y1, 0, h, stone);
    bands(p, x0, y0, x1, y1, 0.2, h - 0.4, lv === 1 ? 2 : 3, glass);
    prism(p, x0, y0, x1, y1, h, h + 0.6, colour);
    if (p.hi) prism(p, x0 + 0.5, y0 + 0.1, x0 + 0.72, y0 + 0.3, h + 0.6, h + 2, c(p, METAL));
    return;
  }
  if (lv === 3) {
    // A mid-rise: a curtain wall in the zone's colour.
    const [x0, y0, x1, y1] = [x + 0.08, y + 0.08, x + 0.92, y + 0.92];
    prism(p, x0, y0, x1, y1, 0, 20, glass);
    mullions(p, x0, y0, x1, y1, 0, 20, 6, c(p, shade(WHITE, 0.9)));
    bands(p, x0, y0, x1, y1, 0, 20, 5, shade(glass, 0.75));
    prism(p, x0, y0, x1, y1, 20, 21, colour);
    parapet(p, x0, y0, x1, y1, 21, shade(colour, 0.85));
    return;
  }
  // Levels 4–5: towers; the tallest step back, wear a crown, a mast or a helipad.
  const [x0, y0, x1, y1] = [x + 0.1, y + 0.1, x + 0.9, y + 0.9];
  const h = lv === 4 ? 30 : 38;
  prism(p, x0, y0, x1, y1, 0, h, glass);
  mullions(p, x0, y0, x1, y1, 0, h, 5, c(p, WHITE));
  bands(p, x0, y0, x1, y1, 0, h, lv === 4 ? 7 : 9, shade(glass, 0.75));
  if (lv === 4) {
    prism(p, x0, y0, x1, y1, h, h + 1.2, colour);
    prism(p, x0 + 0.2, y0 + 0.2, x1 - 0.3, y1 - 0.3, h + 1.2, h + 3.4, c(p, METAL));
    return;
  }
  prism(p, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, h, h + 8, shade(glass, 1.08));
  mullions(p, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, h, h + 8, 4, c(p, WHITE));
  prism(p, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, h + 8, h + 9, colour);
  if (tier === 2 && p.hi && !p.top) {
    // A helipad: a pale disc with an H.
    const [sx, sy] = pt(p, x + 0.5, y + 0.5, h + 9.05);
    p.g.ellipse(sx, sy, 0.26 * HW * Math.SQRT2, 0.26 * HH * Math.SQRT2).fill(c(p, 0x4a4f57));
    p.g.ellipse(sx, sy, 0.2 * HW * Math.SQRT2, 0.2 * HH * Math.SQRT2).stroke({ width: 0.4, color: c(p, 0xf2c14e) });
  } else if (p.hi) line(p, [x + 0.5, y + 0.5, h + 9], [x + 0.5, y + 0.5, h + 17], c(p, METAL), 0.6);
}

function farms(p: Pen, x: number, y: number, lv: number, colour: number): void {
  // Crop rows on every farm tile, running one way or the other.
  const rows = 6;
  const across = rnd(x, y, 1) < 0.5;
  const crop = shade(colour, 1.05);
  for (let k = 0; k < rows; k++) {
    const a = 0.04 + (0.92 * k) / rows;
    const b = a + (0.92 / rows) * 0.55;
    const col = k % 2 ? crop : shade(colour, 0.82);
    if (across) poly(p, [[x + 0.04, y + a, 0], [x + 0.96, y + a, 0], [x + 0.96, y + b, 0], [x + 0.04, y + b, 0]], col);
    else poly(p, [[x + a, y + 0.04, 0], [x + b, y + 0.04, 0], [x + b, y + 0.96, 0], [x + a, y + 0.96, 0]], col);
  }
  const red = c(p, 0xa8432f);
  if (lv === 1) {
    prism(p, x + 0.66, y + 0.1, x + 0.88, y + 0.3, 0, 2.4, c(p, 0x9a6b44));
    gable(p, x + 0.66, y + 0.1, x + 0.88, y + 0.3, 2.4, 1.2, c(p, SLATE), c(p, 0x9a6b44), 'y', 0.02);
    return;
  }
  if (lv <= 4) {
    // A red barn, and silos as the farm grows.
    const big = lv >= 3;
    const [x0, y0, x1, y1] = big ? [x + 0.12, y + 0.1, x + 0.62, y + 0.5] : [x + 0.12, y + 0.12, x + 0.5, y + 0.44];
    prism(p, x0, y0, x1, y1, 0, big ? 5 : 4, red);
    if (p.hi && !p.top) {
      const mx = (x0 + x1) / 2;
      poly(p, [[mx - 0.08, y1, 0], [mx + 0.08, y1, 0], [mx + 0.08, y1, 3], [mx - 0.08, y1, 3]], c(p, WHITE));
      poly(p, [[mx - 0.06, y1, 0.2], [mx + 0.06, y1, 0.2], [mx + 0.06, y1, 2.8], [mx - 0.06, y1, 2.8]], shade(red, 0.8));
    }
    gable(p, x0, y0, x1, y1, big ? 5 : 4, 3, c(p, SLATE), red, 'y', 0.03);
    if (lv >= 3) silo(p, x + 0.76, y + 0.24, lv === 4 ? 9 : 8);
    if (lv === 4) silo(p, x + 0.78, y + 0.56, 7);
    return;
  }
  // Level 5: glasshouses in rows.
  for (const a of [0.1, 0.4, 0.7]) {
    const [x0, y0, x1, y1] = [x + a, y + 0.1, x + a + 0.22, y + 0.9];
    prism(p, x0, y0, x1, y1, 0, 2.6, c(p, 0xcfe6ea), 0.9);
    gable(p, x0, y0, x1, y1, 2.6, 1.6, c(p, 0xe4f2f4), c(p, 0xcfe6ea), 'y', 0.01);
  }
}

function silo(p: Pen, x: number, y: number, h: number): void {
  cylinder(p, x, y, 0.11, 0, h, c(p, 0xd8d4c8));
  cone(p, x, y, 0.11, h, h + 2, c(p, 0x9aa0a6));
}

// ---- Catalogue buildings -------------------------------------------------------------------------

/** How tall a placed building is, for its shadow. */
export function buildingHeight(b: BuildingRect): number {
  const tall: Record<string, number> = {
    townHall: 18, clockTower: 30, windmill: 16, windTurbine: 26, waterTower: 14, coalPlant: 22, hospital: 18,
    university: 16, stadium: 10, gasPlant: 14, railStation: 7, theatre: 15, museum: 12, townLandmark: 18,
  };
  return tall[b.id] ?? 8 + 2 * Math.min(b.w, b.h);
}

/** A placed catalogue building, drawn by what it is. */
export function building(p: Pen, b: BuildingRect): void {
  const { x, y, w, h } = b;
  const x1 = x + w;
  const y1 = y + h;
  const col = b.colour;
  const seed = x * 64 + y + 77;
  // The wide axis of the footprint, for long roofs.
  const along: 'x' | 'y' = w >= h ? 'x' : 'y';
  switch (b.id) {
    case 'townHall': {
      // Stone hall, a portico of columns, a pediment and a clock tower with a flag.
      const [a0, b0, a1, b1] = [x + 0.12, y + 0.12, x1 - 0.12, y1 - 0.2];
      paving(p, x, y, x1, y1);
      prism(p, a0, b0, a1, b1, 0, 9, col);
      windows(p, a0, b0, a1, b1, 1, 8.6, 2, seed, GLASS, 2);
      columns(p, a0 + 0.25, a1 - 0.25, b1 + 0.1, 0, 7, 5, col);
      prism(p, a0 + 0.2, b1, a1 - 0.2, b1 + 0.16, 7, 8, shade(col, 0.95));
      gable(p, a0 + 0.2, b1 - 0.1, a1 - 0.2, b1 + 0.16, 8, 2, shade(col, 0.9), col, 'x', 0);
      hip(p, a0, b0, a1, b1, 9, 2.4, c(p, SLATE), 0.4);
      const tx = (a0 + a1) / 2;
      const ty = (b0 + b1) / 2 - 0.1;
      prism(p, tx - 0.22, ty - 0.22, tx + 0.22, ty + 0.22, 9, 16, col);
      clockFace(p, tx, ty + 0.22, 13.6);
      hip(p, tx - 0.26, ty - 0.26, tx + 0.26, ty + 0.26, 16, 4, c(p, 0x2f6f5a), 0.26);
      flag(p, tx, ty, 20, c(p, RED));
      return;
    }
    case 'busDepot': {
      prism(p, x + 0.08, y + 0.1, x1 - 0.08, y1 - 0.1, 0, 6, col);
      for (let k = 0; k < 3; k++) rollerDoorL(p, x + 0.2 + k * 0.55, x + 0.6 + k * 0.55, y1 - 0.1, 4.4);
      gable(p, x + 0.08, y + 0.1, x1 - 0.08, y1 - 0.1, 6, 2, c(p, METAL), col, along, 0.02);
      return;
    }
    case 'busStop': {
      paving(p, x, y, x1, y1);
      prism(p, x + 0.2, y + 0.42, x + 0.8, y + 0.48, 0, 3, c(p, GLASS_SKY), 0.7);
      prism(p, x + 0.16, y + 0.36, x + 0.84, y + 0.62, 3, 3.5, col);
      if (p.hi) line(p, [x + 0.86, y + 0.7, 0], [x + 0.86, y + 0.7, 4.6], c(p, DARK), 0.5);
      bus(p, x + 0.5, y + 0.82, 'x', c(p, RED));
      return;
    }
    case 'railStation': {
      paving(p, x, y, x1, y1);
      const [a0, b0, a1, b1] = along === 'x' ? [x + 0.1, y + 0.12, x1 - 0.1, y + 0.55] : [x + 0.12, y + 0.1, x + 0.55, y1 - 0.1];
      prism(p, a0, b0, a1, b1, 0, 6, c(p, BRICK[2]));
      windows(p, a0, b0, a1, b1, 0.6, 5.6, 1, seed, GLASS, 3);
      gable(p, a0, b0, a1, b1, 6, 2.6, col, c(p, BRICK[2]), along, 0.04);
      // The platform canopy on posts.
      const [c0, d0, c1, d1] = along === 'x' ? [x + 0.05, y + 0.6, x1 - 0.05, y + 0.95] : [x + 0.6, y + 0.05, x + 0.95, y1 - 0.05];
      if (p.hi) for (let k = 0; k < 4; k++) {
        const t = (k + 0.5) / 4;
        const px = along === 'x' ? c0 + (c1 - c0) * t : (c0 + c1) / 2;
        const py = along === 'x' ? (d0 + d1) / 2 : d0 + (d1 - d0) * t;
        line(p, [px, py, 0], [px, py, 4], c(p, DARK), 0.5);
      }
      prism(p, c0, d0, c1, d1, 4, 4.5, shade(col, 1.1));
      clockFace(p, (a0 + a1) / 2, b1, 4.6);
      return;
    }
    case 'freightYard':
    case 'harbour': {
      paving(p, x, y, x1, y1, b.id === 'harbour' ? c(p, 0xb8b0a0) : c(p, 0x9a948a));
      if (b.id === 'harbour') {
        // Water along the far side, a moored boat.
        poly(p, [[x, y, 0], [x1, y, 0], [x1, y + 0.9, 0], [x, y + 0.9, 0]], c(p, WATER));
        boat(p, x + 1.4, y + 0.45);
      }
      const rows = Math.max(1, h - 1);
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < w * 2 - 1; k++) {
          if (rnd(x + k, y + r, 13) < 0.25) continue;
          const cx = x + 0.2 + k * 0.48;
          const cy = y1 - 0.75 - r * 0.6;
          const stack = rnd(x + k, y + r, 14) < 0.4 ? 2 : 1;
          for (let s = 0; s < stack; s++)
            prism(p, cx, cy, cx + 0.4, cy + 0.2, s * 2, s * 2 + 2, c(p, CAR_COLOURS[Math.floor(rnd(x + k, y + r + s, 15) * CAR_COLOURS.length)]));
        }
      crane(p, x1 - 0.6, y + 0.5, col);
      return;
    }
    case 'airfield': {
      paving(p, x, y, x1, y1, c(p, 0x8fb06a));
      const [r0, s0, r1, s1] = along === 'x' ? [x + 0.1, y1 - 1.1, x1 - 0.1, y1 - 0.5] : [x1 - 1.1, y + 0.1, x1 - 0.5, y1 - 0.1];
      poly(p, [[r0, s0, 0], [r1, s0, 0], [r1, s1, 0], [r0, s1, 0]], c(p, 0x50555c));
      if (p.hi) for (let k = 0; k < 8; k++) {
        const t0 = k / 8 + 0.02;
        const t1 = t0 + 0.05;
        if (along === 'x') poly(p, [[r0 + (r1 - r0) * t0, (s0 + s1) / 2 - 0.02, 0], [r0 + (r1 - r0) * t1, (s0 + s1) / 2 - 0.02, 0], [r0 + (r1 - r0) * t1, (s0 + s1) / 2 + 0.02, 0], [r0 + (r1 - r0) * t0, (s0 + s1) / 2 + 0.02, 0]], c(p, WHITE));
      }
      // A hangar and the control tower.
      prism(p, x + 0.2, y + 0.2, x + 1.6, y + 1.3, 0, 4, col);
      gable(p, x + 0.2, y + 0.2, x + 1.6, y + 1.3, 4, 3, shade(col, 1.1), col, 'y', 0.02);
      cylinder(p, x + 2.2, y + 0.6, 0.14, 0, 10, c(p, WHITE));
      cylinder(p, x + 2.2, y + 0.6, 0.24, 10, 12.5, c(p, GLASS));
      plane(p, x + 3.6, y + 0.7);
      return;
    }
    case 'well': {
      cylinder(p, x + 0.5, y + 0.5, 0.2, 0, 2, c(p, STONE));
      if (p.hi) {
        line(p, [x + 0.34, y + 0.5, 2], [x + 0.34, y + 0.5, 4.5], c(p, TRUNK), 0.6);
        line(p, [x + 0.66, y + 0.5, 2], [x + 0.66, y + 0.5, 4.5], c(p, TRUNK), 0.6);
      }
      gable(p, x + 0.28, y + 0.36, x + 0.72, y + 0.64, 4.5, 1.6, c(p, BRICK[0]), c(p, TRUNK), 'x', 0.02);
      return;
    }
    case 'windmill': {
      cone(p, x + 0.5, y + 0.5, 0.3, 0, 12, c(p, WHITE));
      cylinder(p, x + 0.5, y + 0.5, 0.17, 0, 9, c(p, WHITE));
      cone(p, x + 0.5, y + 0.5, 0.2, 9, 13, col);
      sails(p, x + 0.5, y + 0.72, 10, 7, c(p, 0xe9dfc8));
      return;
    }
    case 'windTurbine': {
      cylinder(p, x + 0.5, y + 0.5, 0.05, 0, 24, c(p, WHITE));
      prism(p, x + 0.44, y + 0.44, x + 0.64, y + 0.56, 23.4, 25, c(p, WHITE));
      sails(p, x + 0.5, y + 0.62, 24.2, 10, c(p, WHITE), 3);
      return;
    }
    case 'generator': {
      paving(p, x, y, x1, y1);
      prism(p, x + 0.18, y + 0.24, x + 0.82, y + 0.76, 0, 4, col);
      cylinder(p, x + 0.68, y + 0.36, 0.06, 4, 7.5, c(p, DARK));
      if (p.hi) for (let k = 0; k < 3; k++) line(p, [x + 0.24 + k * 0.12, y + 0.76, 1], [x + 0.24 + k * 0.12, y + 0.76, 3], c(p, DARK), 0.4);
      return;
    }
    case 'waterTower': {
      if (p.hi) for (const [dx, dy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) line(p, [x + dx, y + dy, 0], [x + 0.5 + (dx - 0.5) * 0.6, y + 0.5 + (dy - 0.5) * 0.6, 8], c(p, DARK), 0.6);
      cylinder(p, x + 0.5, y + 0.5, 0.26, 8, 12.5, col);
      cone(p, x + 0.5, y + 0.5, 0.27, 12.5, 14.5, shade(col, 0.8));
      return;
    }
    case 'coalPlant':
    case 'gasPlant': {
      paving(p, x, y, x1, y1, c(p, 0x9a948a));
      const coal = b.id === 'coalPlant';
      prism(p, x + 0.12, y + 0.12, x + w * 0.55, y1 - 0.12, 0, 9, c(p, 0x8c8f94));
      bands(p, x + 0.12, y + 0.12, x + w * 0.55, y1 - 0.12, 1, 8, 2, GLASS);
      if (coal) {
        tower(p, x + w * 0.76, y + 0.8, 0.5, 16, c(p, 0xd8d4c8));
        tower(p, x + w * 0.76, y + 2.1, 0.5, 16, c(p, 0xd8d4c8));
        chimney(p, x + 0.4, y + 0.4, 22);
      } else {
        cylinder(p, x + w * 0.78, y + 0.8, 0.36, 0, 7, col);
        cylinder(p, x + w * 0.78, y + 2.1, 0.36, 0, 7, col);
        cylinder(p, x + 0.5, y + 0.4, 0.05, 0, 14, c(p, METAL));
      }
      return;
    }
    case 'pumpingStation':
    case 'waterWorks': {
      paving(p, x, y, x1, y1);
      if (b.id === 'waterWorks') {
        for (const [dx, dy] of [[0.9, 0.9], [2.1, 0.9], [0.9, 2.1]]) {
          cylinder(p, x + dx, y + dy, 0.55, 0, 1.4, c(p, STONE), c(p, WATER));
        }
        prism(p, x + 1.6, y + 1.6, x1 - 0.2, y1 - 0.2, 0, 5, c(p, BRICK[2]));
        gable(p, x + 1.6, y + 1.6, x1 - 0.2, y1 - 0.2, 5, 2, c(p, SLATE), c(p, BRICK[2]), 'x', 0.03);
      } else {
        prism(p, x + 0.2, y + 0.2, x1 - 0.2, y1 - 0.3, 0, 6, c(p, BRICK[0]));
        windows(p, x + 0.2, y + 0.2, x1 - 0.2, y1 - 0.3, 1, 5.6, 1, seed, GLASS, 2);
        gable(p, x + 0.2, y + 0.2, x1 - 0.2, y1 - 0.3, 6, 3, c(p, SLATE), c(p, BRICK[0]), 'x', 0.04);
        cylinder(p, x + 1.6, y1 - 0.2, 0.08, 0, 2, col);
      }
      return;
    }
    case 'solarFarm': {
      paving(p, x, y, x1, y1, c(p, 0x9fc489));
      for (let r = 0; r < h * 2; r++)
        for (let k = 0; k < w; k++) {
          const a = x + k + 0.08;
          const bb = y + r * 0.5 + 0.1;
          if (p.top) poly(p, [[a, bb, 0], [a + 0.84, bb, 0], [a + 0.84, bb + 0.3, 0], [a, bb + 0.3, 0]], c(p, 0x2c4a7a));
          else {
            poly(p, [[a, bb, 1.6], [a + 0.84, bb, 1.6], [a + 0.84, bb + 0.3, 0.4], [a, bb + 0.3, 0.4]], c(p, 0x2c4a7a));
            if (p.hi) line(p, [a, bb + 0.02, 1.55], [a + 0.84, bb + 0.02, 1.55], c(p, 0x8fb4cf), 0.3);
          }
        }
      return;
    }
    case 'constablePost':
    case 'policeStation': {
      const big = b.id === 'policeStation';
      const [a0, b0, a1, b1] = [x + 0.14, y + 0.14, x1 - 0.14, y1 - 0.18];
      if (big) paving(p, x, y, x1, y1);
      prism(p, a0, b0, a1, b1, 0, big ? 9 : 5, c(p, big ? STONE : RENDER[0]));
      windows(p, a0, b0, a1, b1, 0.8, big ? 8.6 : 4.6, big ? 2 : 1, seed, GLASS, 2);
      stripe(p, a0, b0, a1, b1, big ? 3.2 : 2.6, col);
      door(p, (a0 + a1) / 2, b1, 0.12, 2.8, col);
      if (big) prism(p, a0, b0, a1, b1, 9, 9.6, col);
      else gable(p, a0, b0, a1, b1, 5, 2.6, c(p, SLATE), c(p, RENDER[0]), 'x');
      lamp(p, (a0 + a1) / 2, b1 + 0.1, big ? 3.8 : 3.2, c(p, 0x3d7ad6));
      return;
    }
    case 'fireVolunteers':
    case 'fireStation': {
      const big = b.id === 'fireStation';
      const [a0, b0, a1, b1] = [x + 0.1, y + 0.12, x1 - 0.1, y1 - 0.12];
      if (big) paving(p, x, y, x1, y1);
      prism(p, a0, b0, a1, b1, 0, big ? 8 : 5, c(p, BRICK[0]));
      const doors = big ? 3 : 1;
      if (p.hi && !p.top) for (let k = 0; k < doors; k++) {
        const u0 = a0 + 0.08 + ((a1 - a0 - 0.16) * k) / doors;
        const u1 = u0 + (a1 - a0 - 0.16) / doors - 0.06;
        poly(p, [[u0, b1, 0], [u1, b1, 0], [u1, b1, 4], [u0, b1, 4]], col);
        poly(p, [[u0 + 0.03, b1, 0.3], [u1 - 0.03, b1, 0.3], [u1 - 0.03, b1, 3.6], [u0 + 0.03, b1, 3.6]], c(p, shade(WHITE, 0.92)));
      }
      if (big) {
        windowsL(p, a0, a1, b1, 4.6, 7.8, 4, 1, seed);
        prism(p, a0, b0, a1, b1, 8, 8.6, col);
        prism(p, a1 - 0.4, b0, a1, b0 + 0.4, 8.6, 14, c(p, BRICK[1]));
        prism(p, a1 - 0.44, b0 - 0.04, a1 + 0.04, b0 + 0.44, 14, 14.6, col);
      } else gable(p, a0, b0, a1, b1, 5, 2.4, c(p, SLATE), c(p, BRICK[0]), 'x');
      return;
    }
    case 'healthCentre':
    case 'hospital': {
      const big = b.id === 'hospital';
      paving(p, x, y, x1, y1);
      const [a0, b0, a1, b1] = [x + 0.12, y + 0.12, x1 - 0.12, y1 - 0.12];
      const hh = big ? 16 : 8;
      prism(p, a0, b0, a1, b1, 0, hh, c(p, WHITE));
      windows(p, a0, b0, a1, b1, 0.6, hh - 0.4, big ? 5 : 2, seed, GLASS, 3);
      stripe(p, a0, b0, a1, b1, 0.2, col, 1);
      prism(p, a0, b0, a1, b1, hh, hh + 0.6, col);
      cross(p, (a0 + a1) / 2, (b0 + b1) / 2, hh + 0.65, big ? 0.5 : 0.3, c(p, big ? RED : 0x3a9a5b));
      if (big) {
        prism(p, (a0 + a1) / 2 - 0.4, b1, (a0 + a1) / 2 + 0.4, b1 + 0.1, 3, 3.6, col);
      }
      return;
    }
    case 'schoolHouse':
    case 'villageSchool':
    case 'primarySchool':
    case 'secondarySchool': {
      const small = b.id === 'schoolHouse' || b.id === 'villageSchool';
      if (!small) playground(p, x, y + h * 0.55, x1, y1);
      const [a0, b0, a1, b1] = small ? [x + 0.14, y + 0.16, x1 - 0.14, y1 - 0.2] : [x + 0.14, y + 0.12, x1 - 0.14, y + h * 0.52];
      const hh = b.id === 'secondarySchool' ? 9 : small ? 5 : 6;
      prism(p, a0, b0, a1, b1, 0, hh, c(p, BRICK[2]));
      windows(p, a0, b0, a1, b1, 0.6, hh - 0.4, small ? 1 : 2, seed, GLASS, 3);
      door(p, (a0 + a1) / 2, b1, 0.12, 2.6, col);
      if (small) {
        gable(p, a0, b0, a1, b1, hh, 3, c(p, SLATE), c(p, BRICK[2]), along);
        // The bell cote.
        prism(p, (a0 + a1) / 2 - 0.07, (b0 + b1) / 2 - 0.07, (a0 + a1) / 2 + 0.07, (b0 + b1) / 2 + 0.07, hh + 2.4, hh + 4.4, c(p, WHITE));
        hip(p, (a0 + a1) / 2 - 0.09, (b0 + b1) / 2 - 0.09, (a0 + a1) / 2 + 0.09, (b0 + b1) / 2 + 0.09, hh + 4.4, 1.4, col, 0.09);
      } else {
        prism(p, a0, b0, a1, b1, hh, hh + 0.5, col);
        parapet(p, a0, b0, a1, b1, hh + 0.5, c(p, shade(BRICK[2], 0.9)));
      }
      return;
    }
    case 'library':
    case 'museum': {
      paving(p, x, y, x1, y1, c(p, STONE));
      const [a0, b0, a1, b1] = [x + 0.12, y + 0.12, x1 - 0.12, y1 - 0.24];
      const hh = b.id === 'museum' ? 9 : 7;
      prism(p, a0, b0, a1, b1, 0, hh, c(p, STONE));
      columns(p, a0 + 0.2, a1 - 0.2, b1 + 0.1, 0, hh - 1, b.id === 'museum' ? 8 : 5, c(p, WHITE));
      prism(p, a0 + 0.1, b1, a1 - 0.1, b1 + 0.16, hh - 1, hh, c(p, STONE));
      gable(p, a0 + 0.1, b1 - 0.1, a1 - 0.1, b1 + 0.16, hh, 1.8, shade(col, 1.1), c(p, STONE), 'x', 0);
      prism(p, a0, b0, a1, b1, hh, hh + 0.4, col);
      if (b.id === 'museum') {
        cylinder(p, (a0 + a1) / 2, (b0 + b1) / 2, 0.42, hh + 0.4, hh + 2.5, c(p, STONE));
        dome(p, (a0 + a1) / 2, (b0 + b1) / 2, 0.42, hh + 2.5, c(p, 0x6f9a8a));
      }
      return;
    }
    case 'university': {
      // A quad: ranges on three sides of a lawn, a tower at the corner.
      grass(p, x, y, x1, y1);
      const t = 0.9;
      const hh = 10;
      const range = (a0: number, b0: number, a1: number, b1: number) => {
        prism(p, a0, b0, a1, b1, 0, hh, c(p, STONE));
        windows(p, a0, b0, a1, b1, 0.8, hh - 0.6, 2, seed, GLASS, 2);
        hip(p, a0, b0, a1, b1, hh, 2.6, col, 0.3);
      };
      range(x + 0.2, y + 0.2, x1 - 0.2, y + 0.2 + t);
      range(x + 0.2, y + 0.2 + t, x + 0.2 + t, y1 - 0.2);
      range(x1 - 0.2 - t, y + 0.2 + t, x1 - 0.2, y1 - 1);
      prism(p, x + 0.3, y + 0.3, x + 0.9, y + 0.9, hh, 18, c(p, STONE));
      clockFace(p, x + 0.6, y + 0.9, 15.5);
      hip(p, x + 0.3, y + 0.3, x + 0.9, y + 0.9, 18, 5, col, 0.3);
      tree(p, x + 2.3, y + 2.4, 0.6, false, c(p, LEAF[1]));
      return;
    }
    case 'villageGreen':
    case 'pocketPark':
    case 'park':
    case 'botanicGarden': {
      grass(p, x, y, x1, y1);
      // A cross of gravel paths, a pond in the bigger ones, trees and benches.
      const mx = (x + x1) / 2;
      const my = (y + y1) / 2;
      poly(p, [[mx - 0.06, y + 0.04, 0], [mx + 0.06, y + 0.04, 0], [mx + 0.06, y1 - 0.04, 0], [mx - 0.06, y1 - 0.04, 0]], c(p, 0xe0d2b0));
      poly(p, [[x + 0.04, my - 0.06, 0], [x1 - 0.04, my - 0.06, 0], [x1 - 0.04, my + 0.06, 0], [x + 0.04, my + 0.06, 0]], c(p, 0xe0d2b0));
      if (w >= 2) {
        const [sx, sy] = pt(p, x + w * 0.27, y + h * 0.72);
        if (p.top) p.g.ellipse(sx, sy, 0.4 * TILE, 0.3 * TILE).fill(c(p, WATER));
        else p.g.ellipse(sx, sy, 0.42 * HW * Math.SQRT2, 0.3 * HH * Math.SQRT2 * 1.4).fill(c(p, WATER));
      }
      if (b.id === 'botanicGarden') {
        // The glasshouse.
        prism(p, x + w * 0.55, y + 0.3, x1 - 0.3, y + h * 0.45, 0, 4, c(p, 0xcfe6ea), 0.85);
        gable(p, x + w * 0.55, y + 0.3, x1 - 0.3, y + h * 0.45, 4, 3, c(p, 0xe4f2f4), c(p, 0xcfe6ea), 'x', 0.02);
        dome(p, x + w * 0.73, y + h * 0.37, 0.35, 5, c(p, 0xdcefee));
      }
      const n = w * h * 2;
      for (let k = 0; k < n; k++) {
        const tx = x + 0.15 + rnd(x + k, y, 21) * (w - 0.3);
        const ty = y + 0.15 + rnd(x, y + k, 22) * (h - 0.3);
        if (Math.abs(tx - mx) < 0.14 || Math.abs(ty - my) < 0.14) continue;
        if (b.id === 'botanicGarden' && tx > x + w * 0.5 && ty < y + h * 0.5) continue;
        tree(p, tx, ty, 0.4 + 0.25 * rnd(k, x, 23), rnd(k, y, 24) < 0.25, c(p, LEAF[k % 4]));
      }
      if (b.id === 'villageGreen' && p.hi) flag(p, x + 0.5, y + 0.5, 0, c(p, RED), 7);
      return;
    }
    case 'playground': {
      paving(p, x, y, x1, y1, c(p, 0xd9b48a));
      // A slide and a swing frame.
      prism(p, x + 0.2, y + 0.2, x + 0.4, y + 0.4, 0, 3, col);
      poly(p, [[x + 0.4, y + 0.24, 3], [x + 0.4, y + 0.36, 3], [x + 0.8, y + 0.36, 0], [x + 0.8, y + 0.24, 0]], c(p, 0xf2c14e));
      if (p.hi) {
        line(p, [x + 0.25, y + 0.7, 0], [x + 0.35, y + 0.7, 3.5], c(p, RED), 0.6);
        line(p, [x + 0.75, y + 0.7, 0], [x + 0.65, y + 0.7, 3.5], c(p, RED), 0.6);
        line(p, [x + 0.35, y + 0.7, 3.5], [x + 0.65, y + 0.7, 3.5], c(p, RED), 0.6);
        line(p, [x + 0.45, y + 0.7, 3.5], [x + 0.45, y + 0.7, 1.2], c(p, DARK), 0.3);
        line(p, [x + 0.55, y + 0.7, 3.5], [x + 0.55, y + 0.7, 1.2], c(p, DARK), 0.3);
      }
      return;
    }
    case 'sportsPitches': {
      pitch(p, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, along);
      return;
    }
    case 'stadium': {
      // A bowl of stands round a pitch, floodlights at the corners.
      prism(p, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 0, 7, col);
      prism(p, x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1, 7, 7.5, shade(col, 1.15));
      pitch(p, x + 0.7, y + 0.7, x1 - 0.7, y1 - 0.7, 'x', 7.6);
      if (p.hi && !p.top) {
        // Stepped seating inside the rim.
        for (let k = 0; k < 3; k++) {
          const i = 0.18 + k * 0.17;
          poly(p, [[x + i, y + i, 7.5], [x1 - i, y + i, 7.5], [x1 - i, y + i + 0.1, 7.5], [x + i, y + i + 0.1, 7.5]], shade(col, 0.9 - k * 0.05));
          poly(p, [[x + i, y + i, 7.5], [x + i + 0.1, y + i, 7.5], [x + i + 0.1, y1 - i, 7.5], [x + i, y1 - i, 7.5]], shade(col, 0.95 - k * 0.05));
        }
        for (const [dx, dy] of [[0.2, 0.2], [w - 0.2, 0.2], [0.2, h - 0.2], [w - 0.2, h - 0.2]]) {
          line(p, [x + dx, y + dy, 7], [x + dx, y + dy, 16], c(p, METAL), 0.6);
          prism(p, x + dx - 0.1, y + dy - 0.04, x + dx + 0.1, y + dy + 0.04, 16, 17.4, c(p, LIT));
        }
      }
      return;
    }
    case 'swimmingPool': {
      paving(p, x, y, x1, y1, c(p, 0xe6ebee));
      poly(p, [[x + 0.2, y + 0.9, 0], [x1 - 0.2, y + 0.9, 0], [x1 - 0.2, y1 - 0.2, 0], [x + 0.2, y1 - 0.2, 0]], c(p, 0x4fb3e0));
      if (p.hi) for (let k = 1; k < 4; k++) line(p, [x + 0.2, y + 0.9 + k * 0.22, 0], [x1 - 0.2, y + 0.9 + k * 0.22, 0], c(p, WHITE), 0.3, 0.8);
      prism(p, x + 0.12, y + 0.1, x1 - 0.12, y + 0.7, 0, 5, col);
      bands(p, x + 0.12, y + 0.1, x1 - 0.12, y + 0.7, 0.4, 4.6, 1, GLASS_SKY);
      gable(p, x + 0.12, y + 0.1, x1 - 0.12, y + 0.7, 5, 1.6, shade(col, 1.12), col, 'x', 0.03);
      return;
    }
    case 'cinema':
    case 'theatre': {
      const [a0, b0, a1, b1] = [x + 0.1, y + 0.12, x1 - 0.1, y1 - 0.12];
      const hh = b.id === 'theatre' ? 10 : 8;
      if (b.id === 'theatre') paving(p, x, y, x1, y1, c(p, STONE));
      prism(p, a0, b0, a1, b1, 0, hh, col);
      if (b.id === 'theatre') prism(p, a0 + 0.6, b0 + 0.3, a1 - 0.6, b0 + 1.4, hh, hh + 5, shade(col, 0.95));
      if (p.hi && !p.top) {
        prism(p, a0 + 0.2, b1, a1 - 0.2, b1 + 0.18, 3, 4.4, c(p, WHITE));
        const n = Math.round((a1 - a0) * 6);
        for (let k = 0; k < n; k++) {
          const [sx, sy] = pt(p, a0 + 0.26 + k * ((a1 - a0 - 0.52) / Math.max(1, n - 1)), b1 + 0.18, 3.7);
          p.g.circle(sx, sy, 0.45).fill(c(p, LIT));
        }
        poly(p, [[a0 + 0.1, b1, 0.2], [a1 - 0.1, b1, 0.2], [a1 - 0.1, b1, 2.8], [a0 + 0.1, b1, 2.8]], c(p, GLASS));
        poly(p, [[a1, b1 - 0.15, 5], [a1, b0 + 0.15, 5], [a1, b0 + 0.15, hh - 1], [a1, b1 - 0.15, hh - 1]], c(p, shade(LIT, 0.8)));
      }
      prism(p, a0, b0, a1, b1, hh, hh + 0.5, shade(col, 0.8));
      return;
    }
    case 'communityHall':
    case 'youthClub': {
      const [a0, b0, a1, b1] = [x + 0.12, y + 0.14, x1 - 0.12, y1 - 0.18];
      const wall = b.id === 'youthClub' ? shade(col, 1.15) : c(p, RENDER[1]);
      prism(p, a0, b0, a1, b1, 0, 5, wall);
      windows(p, a0, b0, a1, b1, 0.8, 4.6, 1, seed, GLASS, 3);
      door(p, (a0 + a1) / 2, b1, 0.12, 2.8, col);
      if (b.id === 'youthClub' && p.hi && !p.top) {
        // A painted mural band.
        const cols = [0xe76f9a, 0xf2c14e, 0x58c4b0, 0x7d4e9e];
        for (let k = 0; k < 4; k++) poly(p, [[a1, b1 - k * 0.16, 0.4], [a1, b1 - (k + 1) * 0.16, 0.4], [a1, b1 - (k + 1) * 0.16, 2.8], [a1, b1 - k * 0.16, 2.8]], c(p, cols[k]));
      }
      gable(p, a0, b0, a1, b1, 5, 2.6, b.id === 'youthClub' ? c(p, DARK) : col, wall, along);
      return;
    }
    case 'viewpoint':
    case 'grandPier': {
      // A boardwalk on piles over the water, a pavilion on the big one.
      const [a0, b0, a1, b1] = [x + 0.05, y + 0.25, x1 - 0.05, y1 - 0.25];
      if (p.hi && !p.top) for (let k = 0; k <= w * 2; k++) {
        const px = a0 + ((a1 - a0) * k) / (w * 2);
        line(p, [px, b1, -1], [px, b1, 1.4], c(p, TRUNK), 0.6);
      }
      prism(p, a0, b0, a1, b1, 1.4, 2, c(p, 0xb08a5e));
      if (p.hi && !p.top) line(p, [a0, b1, 3], [a1, b1, 3], c(p, WHITE), 0.4);
      if (b.id === 'grandPier') {
        prism(p, x1 - 1.6, b0 + 0.05, x1 - 0.3, b1 - 0.05, 2, 6, c(p, WHITE));
        dome(p, x1 - 0.95, (b0 + b1) / 2, 0.36, 6, col);
        flag(p, x1 - 0.95, (b0 + b1) / 2, 9.6, c(p, RED));
      } else if (p.hi) {
        line(p, [x + 0.7, y + 0.5, 2], [x + 0.7, y + 0.5, 4], c(p, DARK), 0.6);
        prism(p, x + 0.62, y + 0.46, x + 0.82, y + 0.54, 4, 4.8, col);
      }
      return;
    }
    case 'clockTower': {
      paving(p, x, y, x1, y1, c(p, STONE));
      const [a0, b0, a1, b1] = [x + 0.6, y + 0.6, x1 - 0.6, y1 - 0.6];
      prism(p, a0, b0, a1, b1, 0, 22, c(p, 0xd9c9a3));
      for (let k = 1; k < 5; k++) stripe(p, a0, b0, a1, b1, k * 4.4, c(p, 0xc4b28a), 0.4);
      prism(p, a0 - 0.06, b0 - 0.06, a1 + 0.06, b1 + 0.06, 22, 26, col);
      clockFace(p, (a0 + a1) / 2, b1 + 0.06, 24, 0.16);
      clockFaceR(p, a1 + 0.06, (b0 + b1) / 2, 24, 0.16);
      hip(p, a0 - 0.08, b0 - 0.08, a1 + 0.08, b1 + 0.08, 26, 8, c(p, 0x2f6f5a), 0.4);
      return;
    }
    case 'townLandmark': {
      paving(p, x, y, x1, y1, c(p, STONE));
      const m = 1.5;
      cylinder(p, x + m, y + m, 0.9, 0, 0.6, c(p, 0xcfc6b3), c(p, 0xddd5c3));
      cylinder(p, x + m, y + m, 0.7, 0.6, 1.4, c(p, WATER), c(p, 0x8fcbe9));
      prism(p, x + m - 0.18, y + m - 0.18, x + m + 0.18, y + m + 0.18, 1.4, 4, c(p, STONE));
      prism(p, x + m - 0.11, y + m - 0.11, x + m + 0.11, y + m + 0.11, 4, 15, col);
      hip(p, x + m - 0.11, y + m - 0.11, x + m + 0.11, y + m + 0.11, 15, 3, shade(col, 1.1), 0.11);
      for (const [dx, dy] of [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]]) tree(p, x + dx, y + dy, 0.5, false, c(p, LEAF[2]));
      return;
    }
    case 'attraction':
    default: {
      // Anything new: a tidy block in its group's colour with windows and a hipped roof.
      const [a0, b0, a1, b1] = [x + 0.1, y + 0.1, x1 - 0.1, y1 - 0.1];
      const hh = buildingHeight(b) - 3;
      prism(p, a0, b0, a1, b1, 0, hh, col);
      windows(p, a0, b0, a1, b1, 0.6, hh - 0.4, Math.max(1, Math.round(hh / 4.5)), seed, GLASS, 3);
      hip(p, a0, b0, a1, b1, hh, 3, shade(col, 0.8), 0.3);
    }
  }
}

function paving(p: Pen, x0: number, y0: number, x1: number, y1: number, colour = c(p, 0xd7d0c2)): void {
  poly(p, [[x0 + 0.03, y0 + 0.03, 0], [x1 - 0.03, y0 + 0.03, 0], [x1 - 0.03, y1 - 0.03, 0], [x0 + 0.03, y1 - 0.03, 0]], colour);
}

function grass(p: Pen, x0: number, y0: number, x1: number, y1: number): void {
  paving(p, x0, y0, x1, y1, c(p, 0x8fc777));
}

function columns(p: Pen, x0: number, x1: number, fy: number, z0: number, z1: number, n: number, colour: number): void {
  if (p.top || !p.hi) return;
  for (let k = 0; k < n; k++) {
    const u = x0 + ((x1 - x0) * k) / Math.max(1, n - 1);
    prism(p, u - 0.035, fy - 0.035, u + 0.035, fy + 0.035, z0, z1, shade(colour, 1.05));
  }
}

function clockFace(p: Pen, x: number, fy: number, z: number, r = 0.14): void {
  if (p.top || !p.hi) return;
  const [sx, sy] = pt(p, x, fy, z);
  p.g.ellipse(sx, sy, r * HW, r * HW).fill(c(p, WHITE));
  p.g.moveTo(sx, sy).lineTo(sx, sy - r * HW * 0.7).stroke({ width: 0.4, color: c(p, DARK) });
  p.g.moveTo(sx, sy).lineTo(sx + r * HW * 0.5, sy).stroke({ width: 0.4, color: c(p, DARK) });
}

function clockFaceR(p: Pen, fx: number, y: number, z: number, r = 0.14): void {
  if (p.top || !p.hi) return;
  const [sx, sy] = pt(p, fx, y, z);
  p.g.ellipse(sx, sy, r * HW * 0.8, r * HW).fill(c(p, shade(WHITE, 0.85)));
}

function flag(p: Pen, x: number, y: number, z: number, colour: number, pole = 4): void {
  if (p.top || !p.hi) return;
  line(p, [x, y, z], [x, y, z + pole], c(p, DARK), 0.4);
  const [sx, sy] = pt(p, x, y, z + pole);
  p.g.poly([sx, sy, sx + 3, sy + 0.8, sx, sy + 2]).fill(colour);
}

/** A coloured band round the two visible faces at height z. */
function stripe(p: Pen, x0: number, y0: number, x1: number, y1: number, z: number, colour: number, h = 0.7): void {
  if (p.top || !p.hi) return;
  poly(p, [[x0, y1, z], [x1, y1, z], [x1, y1, z + h], [x0, y1, z + h]], colour);
  poly(p, [[x1, y1, z], [x1, y0, z], [x1, y0, z + h], [x1, y1, z + h]], shade(colour, 0.78));
}

function cross(p: Pen, x: number, y: number, z: number, s: number, colour: number): void {
  const a = s * 0.3;
  poly(p, [[x - s, y - a, z], [x + s, y - a, z], [x + s, y + a, z], [x - s, y + a, z]], colour);
  poly(p, [[x - a, y - s, z], [x + a, y - s, z], [x + a, y + s, z], [x - a, y + s, z]], colour);
}

function lamp(p: Pen, x: number, y: number, z: number, colour: number): void {
  if (p.top || !p.hi) return;
  const [sx, sy] = pt(p, x, y, z);
  p.g.rect(sx - 1.2, sy - 0.8, 2.4, 1.6).fill(colour);
}

function rollerDoorL(p: Pen, x0: number, x1: number, fy: number, h: number): void {
  rollerDoor(p, x0, x1, fy, h);
}

/** A cooling tower: a waisted drum. */
function tower(p: Pen, x: number, y: number, r: number, h: number, colour: number): void {
  cylinder(p, x, y, r, 0, h * 0.5, colour);
  cylinder(p, x, y, r * 0.78, h * 0.5, h * 0.8, colour);
  cylinder(p, x, y, r * 0.86, h * 0.8, h, colour, shade(colour, 0.6));
}

/** Windmill or turbine sails on a hub at (x, y, z), `len` world units long. */
function sails(p: Pen, x: number, y: number, z: number, len: number, colour: number, n = 4): void {
  if (p.top) return;
  const [sx, sy] = pt(p, x, y, z);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.4;
    const ex = sx + Math.cos(a) * len * 0.9;
    const ey = sy + Math.sin(a) * len;
    const nx = -Math.sin(a) * (n === 3 ? 0.5 : 1.3);
    const ny = Math.cos(a) * (n === 3 ? 0.5 : 1.3);
    p.g.poly([sx, sy, ex, ey, ex + nx, ey + ny, sx + nx * 0.3, sy + ny * 0.3]).fill(colour);
  }
  p.g.circle(sx, sy, 0.8).fill(c(p, DARK));
}

function crane(p: Pen, x: number, y: number, colour: number): void {
  if (p.top || !p.hi) return;
  line(p, [x, y, 0], [x, y, 14], c(p, 0xf2c14e), 1);
  line(p, [x - 1.2, y, 14], [x + 0.4, y, 14], c(p, 0xf2c14e), 0.8);
  line(p, [x - 1, y, 14], [x - 1, y, 6], c(p, DARK), 0.3);
  prism(p, x - 0.1, y - 0.1, x + 0.1, y + 0.1, 12.5, 14.5, colour);
}

function boat(p: Pen, x: number, y: number): void {
  poly(p, [[x - 0.6, y - 0.12, 0], [x + 0.5, y - 0.12, 0], [x + 0.7, y, 0], [x + 0.5, y + 0.12, 0], [x - 0.6, y + 0.12, 0]], c(p, 0x2b3a67));
  prism(p, x - 0.5, y - 0.1, x + 0.45, y + 0.1, 0, 1.4, c(p, 0x2b3a67));
  prism(p, x - 0.45, y - 0.08, x - 0.1, y + 0.08, 1.4, 3.4, c(p, WHITE));
  prism(p, x, y - 0.08, x + 0.3, y + 0.08, 1.4, 2.4, c(p, RED));
}

function plane(p: Pen, x: number, y: number): void {
  // A little propeller plane parked by the runway.
  prism(p, x - 0.4, y - 0.05, x + 0.4, y + 0.05, 0.6, 1.4, c(p, WHITE));
  prism(p, x - 0.05, y - 0.45, x + 0.08, y + 0.45, 1, 1.25, c(p, RED));
  prism(p, x - 0.4, y - 0.15, x - 0.32, y + 0.15, 1.4, 2.6, c(p, RED));
}

function playground(p: Pen, x0: number, y0: number, x1: number, y1: number): void {
  paving(p, x0, y0, x1, y1, c(p, 0xb7b1a6));
  if (p.top || !p.hi) return;
  // Hopscotch and a painted court.
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const [sx, sy] = pt(p, mx, my);
  p.g.ellipse(sx, sy, 0.3 * HW * Math.SQRT2, 0.3 * HH * Math.SQRT2).stroke({ width: 0.4, color: c(p, WHITE) });
  line(p, [x0 + 0.2, my, 0], [x1 - 0.2, my, 0], c(p, 0xf2c14e), 0.4);
}

function pitch(p: Pen, x0: number, y0: number, x1: number, y1: number, along: 'x' | 'y', z = 0): void {
  // Mown stripes, white lines, goals.
  const n = 6;
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const col = c(p, k % 2 ? 0x6fb35a : 0x7cc067);
    if (along === 'x') poly(p, [[x0 + (x1 - x0) * t0, y0, z], [x0 + (x1 - x0) * t1, y0, z], [x0 + (x1 - x0) * t1, y1, z], [x0 + (x1 - x0) * t0, y1, z]], col);
    else poly(p, [[x0, y0 + (y1 - y0) * t0, z], [x1, y0 + (y1 - y0) * t0, z], [x1, y0 + (y1 - y0) * t1, z], [x0, y0 + (y1 - y0) * t1, z]], col);
  }
  if (p.top || !p.hi) return;
  const W = c(p, WHITE);
  line(p, [x0 + 0.05, y0 + 0.05, z], [x1 - 0.05, y0 + 0.05, z], W, 0.4);
  line(p, [x1 - 0.05, y0 + 0.05, z], [x1 - 0.05, y1 - 0.05, z], W, 0.4);
  line(p, [x1 - 0.05, y1 - 0.05, z], [x0 + 0.05, y1 - 0.05, z], W, 0.4);
  line(p, [x0 + 0.05, y1 - 0.05, z], [x0 + 0.05, y0 + 0.05, z], W, 0.4);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  if (along === 'x') line(p, [mx, y0 + 0.05, z], [mx, y1 - 0.05, z], W, 0.4);
  else line(p, [x0 + 0.05, my, z], [x1 - 0.05, my, z], W, 0.4);
  const [sx, sy] = pt(p, mx, my, z);
  p.g.ellipse(sx, sy, 0.25 * HW * Math.SQRT2, 0.25 * HH * Math.SQRT2).stroke({ width: 0.4, color: W });
}

// ---- Vehicles ------------------------------------------------------------------------------------

/** A car at (x, y) in tile space, facing along x or y (`back` true when it drives the other way). */
export function car(p: Pen, x: number, y: number, along: 'x' | 'y', colour: number): void {
  const L = 0.17;
  const W = 0.09;
  const [hx, hy] = along === 'x' ? [L, W] : [W, L];
  if (p.top) {
    prism(p, x - hx, y - hy, x + hx, y + hy, 0, 1, colour);
    return;
  }
  shadow(p, x - hx, y - hy, x + hx, y + hy, 2, 0.12);
  prism(p, x - hx, y - hy, x + hx, y + hy, 0.35, 1.25, colour);
  // The cabin, set back, with its glass.
  const [cx, cy] = along === 'x' ? [L * 0.55, W * 0.85] : [W * 0.85, L * 0.55];
  prism(p, x - cx, y - cy, x + cx, y + cy, 1.25, 2.05, c(p, 0x33414f));
  prism(p, x - cx * 0.9, y - cy * 0.9, x + cx * 0.9, y + cy * 0.9, 2.05, 2.15, colour);
}

/** A bus: a long box in the zone's red with a band of windows. */
export function bus(p: Pen, x: number, y: number, along: 'x' | 'y', colour: number): void {
  const [hx, hy] = along === 'x' ? [0.32, 0.1] : [0.1, 0.32];
  shadow(p, x - hx, y - hy, x + hx, y + hy, 3, 0.12);
  prism(p, x - hx, y - hy, x + hx, y + hy, 0.3, 2.8, colour);
  if (p.hi && !p.top) {
    if (along === 'x') poly(p, [[x - hx + 0.03, y + hy, 1.5], [x + hx - 0.03, y + hy, 1.5], [x + hx - 0.03, y + hy, 2.4], [x - hx + 0.03, y + hy, 2.4]], c(p, GLASS));
    else poly(p, [[x + hx, y + hy - 0.03, 1.5], [x + hx, y - hy + 0.03, 1.5], [x + hx, y - hy + 0.03, 2.4], [x + hx, y + hy - 0.03, 2.4]], c(p, GLASS));
  }
}

/** A colour for car `k`. */
export function carColour(k: number): number {
  return CAR_COLOURS[k % CAR_COLOURS.length];
}

// ---- Terrain and roads ---------------------------------------------------------------------------

/** Neighbour bits: +x (east), +y (south), -x (west), -y (north). */
export const E = 1;
export const S = 2;
export const W = 4;
export const N = 8;

const ROAD_TOP: Record<number, number> = { 1: 0xb9a888, 2: 0x7d7f84, 3: 0x6c6e73, 4: 0x635f5a };
const PAVEMENT = 0xd6d0c4;

/**
 * A road tile: pavements where it does not join another road, tarmac, and
 * markings along the way it runs (centre dashes on streets, a double line on
 * avenues and the County Road, zebra crossings next to a junction).
 */
export function road(p: Pen, x: number, y: number, kind: number, links: number, junctionNext: number): void {
  const lane = kind === 1;
  const base = c(p, lane ? 0xcdbb98 : PAVEMENT);
  poly(p, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], base);
  const top = c(p, ROAD_TOP[kind] ?? ROAD_TOP[2]);
  const k = lane ? 0.2 : kind === 2 ? 0.14 : 0.08;
  const x0 = links & W ? x : x + k;
  const x1 = links & E ? x + 1 : x + 1 - k;
  const y0 = links & N ? y : y + k;
  const y1 = links & S ? y + 1 : y + 1 - k;
  // The tarmac: the tile's middle, run out to every side that joins.
  poly(p, [[x + k, y + k, 0], [x + 1 - k, y + k, 0], [x + 1 - k, y + 1 - k, 0], [x + k, y + 1 - k, 0]], top);
  if (links & W) poly(p, [[x0, y + k, 0], [x + k, y + k, 0], [x + k, y + 1 - k, 0], [x0, y + 1 - k, 0]], top);
  if (links & E) poly(p, [[x + 1 - k, y + k, 0], [x1, y + k, 0], [x1, y + 1 - k, 0], [x + 1 - k, y + 1 - k, 0]], top);
  if (links & N) poly(p, [[x + k, y0, 0], [x + 1 - k, y0, 0], [x + 1 - k, y + k, 0], [x + k, y + k, 0]], top);
  if (links & S) poly(p, [[x + k, y + 1 - k, 0], [x + 1 - k, y + 1 - k, 0], [x + 1 - k, y1, 0], [x + k, y1, 0]], top);
  if (lane || !p.hi || p.top) return;
  const ew = (links & (E | W)) !== 0;
  const ns = (links & (N | S)) !== 0;
  const n = (links & E ? 1 : 0) + (links & W ? 1 : 0) + (links & N ? 1 : 0) + (links & S ? 1 : 0);
  if (n >= 3) return; // A junction: clear tarmac.
  const paint = c(p, kind >= 3 ? 0xf2d16b : 0xf4f1ea);
  const double = kind >= 3;
  if (ew && !ns) {
    if (double) {
      for (const o of [-0.025, 0.025]) poly(p, [[x0, y + 0.5 + o - 0.008, 0], [x1, y + 0.5 + o - 0.008, 0], [x1, y + 0.5 + o + 0.008, 0], [x0, y + 0.5 + o + 0.008, 0]], paint);
    } else
      for (const a of [0.12, 0.62]) poly(p, [[x + a, y + 0.49, 0], [x + a + 0.26, y + 0.49, 0], [x + a + 0.26, y + 0.51, 0], [x + a, y + 0.51, 0]], paint);
  } else if (ns && !ew) {
    if (double) {
      for (const o of [-0.025, 0.025]) poly(p, [[x + 0.5 + o - 0.008, y0, 0], [x + 0.5 + o + 0.008, y0, 0], [x + 0.5 + o + 0.008, y1, 0], [x + 0.5 + o - 0.008, y1, 0]], paint);
    } else
      for (const a of [0.12, 0.62]) poly(p, [[x + 0.49, y + a, 0], [x + 0.51, y + a, 0], [x + 0.51, y + a + 0.26, 0], [x + 0.49, y + a + 0.26, 0]], paint);
  }
  // Zebra crossings on the side that meets a junction.
  const zebra = c(p, 0xf4f1ea);
  for (const [bit, horiz] of [[E, false], [W, false], [S, true], [N, true]] as const) {
    if (!(junctionNext & bit)) continue;
    for (let s = 0; s < 4; s++) {
      const a = k + 0.04 + s * ((1 - 2 * k - 0.08) / 4);
      const b = a + (1 - 2 * k - 0.08) / 8;
      if (horiz) {
        const yy = bit === S ? y + 0.82 : y + 0.06;
        poly(p, [[x + a, yy, 0], [x + b, yy, 0], [x + b, yy + 0.12, 0], [x + a, yy + 0.12, 0]], zebra);
      } else {
        const xx = bit === E ? x + 0.82 : x + 0.06;
        poly(p, [[xx, y + a, 0], [xx + 0.12, y + a, 0], [xx + 0.12, y + b, 0], [xx, y + b, 0]], zebra);
      }
    }
  }
}

/** A railway tile: ballast, sleepers and two rails along the way it runs. */
export function rail(p: Pen, x: number, y: number, links: number): void {
  poly(p, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], c(p, 0xa39a8c));
  const ew = (links & (E | W)) !== 0 || !(links & (N | S));
  if (!p.hi || p.top) return;
  for (let s = 0; s < 5; s++) {
    const a = 0.05 + s * 0.2;
    if (ew) poly(p, [[x + a, y + 0.3, 0], [x + a + 0.07, y + 0.3, 0], [x + a + 0.07, y + 0.7, 0], [x + a, y + 0.7, 0]], c(p, 0x6d5a4b));
    else poly(p, [[x + 0.3, y + a, 0], [x + 0.7, y + a, 0], [x + 0.7, y + a + 0.07, 0], [x + 0.3, y + a + 0.07, 0]], c(p, 0x6d5a4b));
  }
  for (const o of [0.38, 0.62]) {
    if (ew) line(p, [x, y + o, 0.2], [x + 1, y + o, 0.2], c(p, 0x8c9096), 0.5);
    else line(p, [x + o, y, 0.2], [x + o, y + 1, 0.2], c(p, 0x8c9096), 0.5);
  }
}

/** Ground texture on a bare terrain tile: a little variation, ripples on water, tufts on grass. */
export function terrainDetail(p: Pen, x: number, y: number, kind: number, base: number, shore: number): void {
  if (!p.hi || p.top) return;
  const r = rnd(x, y, 40);
  if (kind === 1) {
    // Water: two ripples, and foam where it meets land.
    if (r < 0.5) line(p, [x + 0.2 + r * 0.4, y + 0.3, 0], [x + 0.45 + r * 0.4, y + 0.3, 0], shade(base, 1.18), 0.5, 0.8);
    if (r > 0.3) line(p, [x + 0.15, y + 0.4 + r * 0.4, 0], [x + 0.4, y + 0.4 + r * 0.4, 0], shade(base, 1.14), 0.5, 0.7);
    const foam = shade(base, 1.35);
    if (shore & N) line(p, [x, y + 0.04, 0], [x + 1, y + 0.04, 0], foam, 0.7, 0.8);
    if (shore & W) line(p, [x + 0.04, y, 0], [x + 0.04, y + 1, 0], foam, 0.7, 0.8);
    if (shore & S) line(p, [x, y + 0.96, 0], [x + 1, y + 0.96, 0], foam, 0.7, 0.8);
    if (shore & E) line(p, [x + 0.96, y, 0], [x + 0.96, y + 1, 0], foam, 0.7, 0.8);
    return;
  }
  if (kind === 0 || kind === 4) {
    // Grass and hills: a tuft or two in a darker green.
    if (r < 0.35) {
      const [sx, sy] = pt(p, x + 0.2 + r, y + 0.3 + r * 0.8);
      p.g.poly([sx - 0.8, sy, sx, sy - 1.6, sx + 0.8, sy]).fill(shade(base, 0.82));
    }
    return;
  }
  if (kind === 2 && r < 0.4) {
    const [sx, sy] = pt(p, x + 0.3 + r, y + 0.6);
    p.g.circle(sx, sy, 0.6).fill(shade(base, 0.86));
  }
}

/** What stands on a bare terrain tile (drawn with the solids): forest trees, rocks, the odd bush. */
export function terrainSolids(p: Pen, x: number, y: number, kind: number, open: boolean): void {
  const r = rnd(x, y, 50);
  const dim = open ? 1 : 0.8;
  if (kind === 3) {
    // Forest: three or four trees, mostly conifers, at varied heights.
    const n = p.hi ? 3 + (r < 0.5 ? 1 : 0) : 1;
    for (let k = 0; k < n; k++) {
      const tx = x + 0.2 + rnd(x, y, 51 + k) * 0.6;
      const ty = y + 0.2 + rnd(x, y, 61 + k) * 0.6;
      tree(p, tx, ty, 0.5 + rnd(x, y, 71 + k) * 0.3, rnd(x, y, 81 + k) < 0.65, c(p, shade(LEAF[(x + y + k) % 4], 0.85 * dim)));
    }
    return;
  }
  if (kind === 5 && p.hi) {
    // Rock: a couple of boulders.
    prism(p, x + 0.2, y + 0.3, x + 0.45, y + 0.52, 0, 1.6 + r, c(p, shade(0x9a958b, dim)));
    prism(p, x + 0.55, y + 0.5, x + 0.72, y + 0.68, 0, 1 + r, c(p, shade(0xa9a49a, dim)));
    return;
  }
  if ((kind === 0 || kind === 4) && r < 0.07 && p.hi) tree(p, x + 0.5, y + 0.5, 0.45, r < 0.02, c(p, shade(LEAF[(x * 3 + y) % 4], dim)));
}
