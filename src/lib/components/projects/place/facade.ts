// The buildings of /projects read as a place ($lib/projects/place): one
// drawing per family, each in its own w × h box (x across, y down, the street
// at y = h), as layered path strings a component fills. Pure, and seeded by
// the project's key, so a project keeps its building.

import { seeded } from '$lib/landing/place-city';
import type { ProjectEntry, ProjectFamily } from '$lib/projects/views';

/* ------------------------------------------------------------ buildings */

export type Variant =
  | 'pediment'
  | 'dome'
  | 'clock'
  | 'arcade'
  | 'wheel'
  | 'helter'
  | 'sawtooth'
  | 'gantry'
  | 'tank'
  | 'slab'
  | 'shard'
  | 'setback'
  | 'crane';

export const VARIANTS: Record<ProjectFamily, Variant[]> = {
  study: ['pediment', 'dome', 'clock'],
  game: ['arcade', 'wheel', 'helter'],
  tool: ['sawtooth', 'gantry', 'tank'],
  agent: ['slab', 'shard', 'setback', 'crane'],
};

/** The material a family builds in; a product is petrol glass whatever its family. */
export type Material = 'stone' | 'fair' | 'metal' | 'glass' | 'petrol';

/** One building, as layered paths in its own w × h box (the street at y = h). */
export interface Facade {
  w: number;
  h: number;
  /** The highest point drawn, 0..h down: where a label's leader meets the roof. */
  top: number;
  material: Material;
  /** The walls, in the material's colour. */
  body: string;
  /** The shaded side of each mass, for depth. */
  shade: string;
  /** Roofs, domes and caps. */
  roof: string;
  /** Windows, recesses and curtain walls. */
  glaze: string;
  /** Pale stone or paint: columns, cornices, doors, clock faces. */
  trim: string;
  /** The family's colour: awnings, flags, gondolas, the crane. */
  accent: string;
  /** Lit panes and bulbs. */
  lit: string;
  /** Structure drawn as lines: spokes, frames, jibs. */
  line: string;
  /** Mullions and floor slabs on the glass, drawn fine. */
  fine: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const rect = (x: number, y: number, w: number, h: number) => (w <= 0 || h <= 0 ? '' : `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`);
const poly = (pts: Array<[number, number]>) => `M${pts.map(([a, b]) => `${r1(a)},${r1(b)}`).join('L')}Z`;
const seg = (x1: number, y1: number, x2: number, y2: number) => `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;
const disc = (cx: number, cy: number, r: number) =>
  `M${r1(cx - r)},${r1(cy)}a${r1(r)},${r1(r)} 0 1,0 ${r1(2 * r)},0a${r1(r)},${r1(r)} 0 1,0 ${r1(-2 * r)},0Z`;

/** Panes in a grid inside a box, a deterministic few of them lit. */
function panes(f: Facade, rnd: () => number, x: number, y: number, w: number, h: number, cols: number, rows: number, litShare: number, fill = 0.62) {
  if (cols < 1 || rows < 1 || w <= 0 || h <= 0) return;
  const cw = w / cols;
  const rh = h / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = rect(x + c * cw + cw * (1 - fill) * 0.5, y + r * rh + rh * 0.18, cw * fill, rh * 0.64);
      if (rnd() < litShare) f.lit += p;
      else f.glaze += p;
    }
}

function blank(w: number, h: number, material: Material): Facade {
  return { w, h, top: 0, material, body: '', shade: '', roof: '', glaze: '', trim: '', accent: '', lit: '', line: '', fine: '' };
}

/** A field study: a civic building, a colonnade at its foot, crowned by a pediment, a dome or a clock. */
function civic(f: Facade, v: Variant, rnd: () => number) {
  const { w, h } = f;
  const s = clamp(h * 0.03, 1.6, 4.5);
  const m = w * 0.07;
  const bw = w - 2 * m;
  f.trim += rect(0, h - s, w, s) + rect(w * 0.03, h - 2 * s, w * 0.94, s);
  const roofH = v === 'pediment' ? Math.min(bw * 0.24, h * 0.16) : v === 'dome' ? Math.min(bw * 0.62, h * 0.34) : Math.min(h * 0.36, bw * 1.5);
  const top = roofH;
  const foot = h - 2 * s;
  f.body += rect(m, top, bw, foot - top);
  f.shade += rect(m + bw * 0.86, top, bw * 0.14, foot - top);
  const cor = Math.max(1.6, h * 0.016);
  f.trim += rect(m - w * 0.03, top, bw + w * 0.06, cor);
  // The colonnade: a shadowed recess behind a row of columns, an entablature over it.
  const ph = Math.min((foot - top) * 0.4, 52);
  const pTop = foot - ph;
  const eh = Math.max(1.6, ph * 0.12);
  const cols = clamp(Math.round(bw / 11), 2, 8);
  f.glaze += rect(m + bw * 0.06, pTop, bw * 0.88, ph);
  f.trim += rect(m, pTop - eh, bw, eh);
  const pitch = (bw * 0.88) / cols;
  const cw = Math.max(1.1, pitch * 0.36);
  for (let i = 0; i <= cols; i++) {
    const cx = m + bw * 0.06 + pitch * i;
    f.trim += rect(cx - cw / 2, pTop, cw, ph);
  }
  // Tall windows over the colonnade, between its columns.
  const upTop = top + cor + 3;
  const upBot = pTop - eh - 2;
  const rows = Math.max(0, Math.floor((upBot - upTop) / 18));
  if (rows) panes(f, rnd, m + bw * 0.06 + pitch * 0.5 - pitch / 2, upTop, pitch * cols, upBot - upTop, cols, rows, 0.14, 0.42);
  const mid = w / 2;
  if (v === 'pediment') {
    f.roof += poly([[m - w * 0.03, top], [mid, 0], [m + bw + w * 0.03, top]]);
    if (roofH > 9) f.trim += disc(mid, top * 0.6, Math.min(roofH * 0.2, bw * 0.06));
    f.top = 0;
  } else if (v === 'dome') {
    const dw = bw * 0.5;
    const dh = roofH * 0.3;
    f.body += rect(mid - dw / 2, top - dh, dw, dh);
    panes(f, rnd, mid - dw / 2 + dw * 0.1, top - dh, dw * 0.8, dh, Math.max(2, Math.round(dw / 8)), 1, 0, 0.5);
    const rx = (dw / 2) * 1.04;
    const ry = roofH * 0.56;
    const base = top - dh;
    f.roof += `M${r1(mid - rx)},${r1(base)}A${r1(rx)},${r1(ry)} 0 0,1 ${r1(mid + rx)},${r1(base)}Z`;
    const lan = Math.max(1.6, dw * 0.12);
    f.trim += rect(mid - lan / 2, base - ry - lan * 1.2, lan, lan * 1.3);
    f.line += seg(mid, base - ry - lan * 1.2, mid, 0);
    f.top = 0;
  } else {
    const tw = Math.max(5, bw * 0.3);
    const capH = Math.min(roofH * 0.3, tw * 0.9);
    const tTop = capH;
    f.body += rect(mid - tw / 2, tTop, tw, top - tTop);
    f.shade += rect(mid + tw * 0.3, tTop, tw * 0.2, top - tTop);
    f.roof += poly([[mid - tw / 2 - 1, tTop], [mid, 0], [mid + tw / 2 + 1, tTop]]);
    const cy = tTop + (top - tTop) * 0.32;
    const cr = tw * 0.32;
    f.trim += disc(mid, cy, cr);
    f.line += seg(mid, cy, mid, cy - cr * 0.7) + seg(mid, cy, mid + cr * 0.5, cy + cr * 0.1);
    if (top - tTop > tw * 1.6) panes(f, rnd, mid - tw * 0.3, cy + cr + 3, tw * 0.6, top - cy - cr - 5, 1, Math.max(1, Math.floor((top - cy - cr) / 16)), 0.2, 0.5);
    f.top = 0;
  }
}

/** A game: the funfair, an arcade under its sign, a big wheel or a helter-skelter. */
function fair(f: Facade, v: Variant, rnd: () => number) {
  const { w, h } = f;
  if (v === 'wheel') {
    const R = Math.min(w * 0.46, (h - 4) / 2.3);
    const cx = w / 2;
    const cy = h - R * 1.25;
    const legs = R * 0.62;
    f.line += seg(cx, cy, cx - legs, h) + seg(cx, cy, cx + legs, h) + disc(cx, cy, R) + disc(cx, cy, R * 0.82);
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + 0.2;
      f.line += seg(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      const gx = cx + Math.cos(a) * R;
      const gy = cy + Math.sin(a) * R;
      const g = Math.max(1.6, R * 0.16);
      const car = rect(gx - g / 2, gy, g, g * 0.85);
      if (i % 2) f.accent += car;
      else f.lit += car;
    }
    f.trim += disc(cx, cy, Math.max(1.2, R * 0.08));
    // The pay booth at its foot.
    const bw = Math.min(w * 0.5, R * 1.1);
    const bh = Math.min(R * 0.42, 16);
    f.body += rect(cx - bw / 2, h - bh, bw, bh);
    f.glaze += rect(cx - bw * 0.3, h - bh * 0.72, bw * 0.6, bh * 0.4);
    f.accent += rect(cx - bw / 2 - 1, h - bh - 2.4, bw + 2, 2.4);
    f.top = cy - R - Math.max(1.6, R * 0.16) * 0.2;
    return;
  }
  if (v === 'helter') {
    const capBase = h * 0.24;
    const bw = w * 0.82;
    const tw = w * 0.42;
    const x0 = (w - bw) / 2;
    const x1 = (w - tw) / 2;
    f.body += poly([[x0, h], [x1, capBase], [x1 + tw, capBase], [x0 + bw, h]]);
    f.shade += poly([[x0 + bw * 0.78, h], [x1 + tw * 0.78, capBase], [x1 + tw, capBase], [x0 + bw, h]]);
    // The slide winding down, a band at a time.
    const k = clamp(Math.round((h - capBase) / 22), 3, 8);
    const at = (y: number) => {
      const t = (h - y) / (h - capBase);
      return [x0 + (x1 - x0) * t, x0 + bw + (x1 + tw - x0 - bw) * t] as const;
    };
    for (let i = 0; i < k; i++) {
      const yA = h - ((i + 0.15) * (h - capBase)) / k;
      const yB = yA - ((h - capBase) / k) * 0.45;
      const [la, ra] = at(yA);
      const [lb, rb] = at(yB);
      const t = 2.4;
      f.accent += poly([[la, yA], [ra, yA - (yA - yB) * 0.9], [rb, yB - (yA - yB) * 0.9 + t], [lb, yB + t]]);
    }
    f.roof += poly([[x1 - 2, capBase], [w / 2, capBase - Math.min(capBase * 0.8, tw * 1.1)], [x1 + tw + 2, capBase]]);
    const apex = capBase - Math.min(capBase * 0.8, tw * 1.1);
    f.line += seg(w / 2, apex, w / 2, 0);
    f.accent += poly([[w / 2, 0], [w / 2 + Math.max(4, w * 0.2), 2], [w / 2, 4.4]]);
    f.glaze += `M${r1(w / 2 - bw * 0.12)},${r1(h)}V${r1(h - bw * 0.2)}A${r1(bw * 0.12)},${r1(bw * 0.12)} 0 0,1 ${r1(w / 2 + bw * 0.12)},${r1(h - bw * 0.2)}V${r1(h)}Z`;
    f.top = 0;
    return;
  }
  // The arcade: a hall under a lit sign on legs, an arched door under a striped awning.
  const signH = Math.min(h * 0.2, 22);
  const top = signH + Math.min(5, h * 0.04);
  f.body += rect(0, top, w, h - top);
  f.shade += rect(w * 0.88, top, w * 0.12, h - top);
  f.roof += rect(w * 0.1, 0, w * 0.8, signH * 0.78);
  f.line += seg(w * 0.24, signH * 0.78, w * 0.24, top) + seg(w * 0.76, signH * 0.78, w * 0.76, top);
  const bulbs = clamp(Math.floor((w * 0.7) / 6), 2, 14);
  for (let i = 0; i < bulbs; i++) f.lit += disc(w * 0.15 + ((w * 0.7) / Math.max(1, bulbs - 1)) * i, signH * 0.39, Math.max(0.8, Math.min(1.6, signH * 0.08)));
  f.trim += rect(0, top, w, Math.max(1.6, h * 0.02));
  const doorH = Math.min((h - top) * 0.46, 40);
  const dw = w * 0.4;
  const dr = dw / 2;
  f.glaze += `M${r1(w / 2 - dr)},${r1(h)}V${r1(h - doorH + dr)}A${r1(dr)},${r1(dr)} 0 0,1 ${r1(w / 2 + dr)},${r1(h - doorH + dr)}V${r1(h)}Z`;
  f.lit += rect(w / 2 - dr * 0.5, h - doorH * 0.5, dr, doorH * 0.5);
  // The awning: stripes, and a scalloped hem.
  const aY = h - doorH - Math.min(10, h * 0.08);
  const aH = Math.min(7, h * 0.06);
  const aw = w * 0.92;
  const ax = (w - aw) / 2;
  const n = clamp(Math.round(aw / 6), 4, 18);
  for (let i = 0; i < n; i++) {
    const sx = ax + (aw / n) * i;
    const stripe = rect(sx, aY, aw / n, aH);
    if (i % 2) f.trim += stripe;
    else f.accent += stripe;
    const rr = aw / n / 2;
    const hem = `M${r1(sx)},${r1(aY + aH)}A${r1(rr)},${r1(rr)} 0 0,0 ${r1(sx + 2 * rr)},${r1(aY + aH)}Z`;
    if (i % 2) f.trim += hem;
    else f.accent += hem;
  }
  // Round windows over the awning.
  const wy = top + (aY - top) * 0.5;
  const pr = Math.min((aY - top) * 0.22, w * 0.06);
  if (pr > 1.4) {
    const k = clamp(Math.floor(w / (pr * 4.2)), 2, 6);
    for (let i = 0; i < k; i++) {
      const c = disc(w * 0.12 + ((w * 0.76) / (k - 1)) * i, wy, pr);
      if (rnd() < 0.34) f.lit += c;
      else f.glaze += c;
    }
  }
  f.top = 0;
}

/** A tool: the works, a north-light shed, with a chimney, a gantry crane or a water tank. */
function works(f: Facade, v: Variant, rnd: () => number) {
  const { w, h } = f;
  const extra = v === 'sawtooth' && rnd() < 0.6 ? 'chimney' : null;
  const tall = v === 'gantry' || v === 'tank' || extra;
  const wallH = h * (tall ? 0.56 : 0.78);
  const teeth = Math.min(14, h * 0.18, wallH * 0.3);
  const wallTop = h - wallH;
  f.body += rect(0, wallTop, w, wallH);
  f.shade += rect(w * 0.9, wallTop, w * 0.1, wallH);
  // The sawtooth: a glazed face and a slope per bay.
  const k = clamp(Math.round(w / 20), 2, 7);
  const tw = w / k;
  for (let i = 0; i < k; i++) {
    const x = i * tw;
    f.glaze += poly([[x, wallTop], [x + tw * 0.22, wallTop - teeth], [x + tw * 0.22, wallTop]]);
    f.roof += poly([[x + tw * 0.22, wallTop - teeth], [x + tw, wallTop], [x + tw * 0.22, wallTop]]);
  }
  // A clerestory of panes under the eaves, some lit: somebody is in.
  const band = Math.min(9, wallH * 0.18);
  panes(f, rnd, w * 0.04, wallTop + band * 0.5, w * 0.92, band, clamp(Math.round(w / 9), 2, 14), 1, 0.4, 0.7);
  // Roller doors.
  const dH = Math.min(wallH * 0.48, 26);
  const doors = w > 60 ? 2 : 1;
  for (let i = 0; i < doors; i++) {
    const dw = Math.min(w * 0.26, 30);
    const dx = doors === 1 ? w * 0.3 : w * (0.14 + i * 0.44);
    f.trim += rect(dx, h - dH, dw, dH);
    for (let y = h - dH + 3; y < h - 1; y += 3) f.fine += seg(dx + 1, y, dx + dw - 1, y);
  }
  f.top = wallTop - teeth;
  if (extra) {
    const cw = Math.max(3, w * 0.07);
    const cx = w * 0.8;
    f.body += rect(cx, 0, cw, wallTop - teeth + 2);
    f.shade += rect(cx + cw * 0.6, 0, cw * 0.4, wallTop - teeth + 2);
    f.trim += rect(cx - 0.6, 2, cw + 1.2, 1.6) + rect(cx - 0.6, 6, cw + 1.2, 1.2);
    f.top = 0;
  } else if (v === 'gantry') {
    const gTop = Math.max(2, (wallTop - teeth) * 0.2);
    f.line += seg(w * 0.08, wallTop, w * 0.08, gTop) + seg(w * 0.92, wallTop, w * 0.92, gTop);
    f.accent += rect(w * 0.04, gTop - 2.4, w * 0.92, 3.2);
    const hx = w * (0.32 + rnd() * 0.36);
    f.accent += rect(hx - 3, gTop + 0.8, 6, 3);
    const drop = (wallTop - teeth - gTop) * 0.62;
    f.line += seg(hx, gTop + 3.8, hx, gTop + 3.8 + drop);
    f.trim += rect(hx - 4, gTop + 3.8 + drop, 8, 5);
    f.top = gTop - 2.4;
  } else if (v === 'tank') {
    const tx = w * (rnd() < 0.5 ? 0.12 : 0.62);
    const tW = Math.min(w * 0.26, 26);
    const tH = Math.min(tW * 0.8, (wallTop - teeth) * 0.55);
    const legTop = tH + 2;
    f.line += seg(tx + tW * 0.15, legTop, tx + tW * 0.05, wallTop - teeth) + seg(tx + tW * 0.85, legTop, tx + tW * 0.95, wallTop - teeth);
    f.line += seg(tx + tW * 0.1, (legTop + wallTop - teeth) / 2, tx + tW * 0.9, (legTop + wallTop - teeth) / 2);
    f.roof += rect(tx, 2, tW, tH);
    f.trim += rect(tx, 2 + tH * 0.33, tW, 1.2) + rect(tx, 2 + tH * 0.66, tW, 1.2);
    f.roof += poly([[tx - 1, 2.4], [tx + tW / 2, 0], [tx + tW + 1, 2.4]]);
    f.top = 0;
  }
}

/** Built by an agent: a new glass tower, a slab, a shard, a setback, or one still under its crane. */
function tower(f: Facade, v: Variant, rnd: () => number) {
  const { w, h } = f;
  const crane = v === 'crane';
  const top = crane ? h * 0.2 : v === 'slab' && rnd() < 0.5 ? h * 0.06 : 0;
  const pitch = clamp(h / 26, 4.5, 8);
  const glassIn = w * 0.1;
  const tiers: Array<[number, number, number]> =
    v === 'setback'
      ? [
          [0, w, h * 0.42],
          [w * 0.14, w * 0.72, top],
        ]
      : [[0, w, top]];
  // [left, width, top]; the lower tier runs to the street, an upper one to the tier below it.
  tiers.forEach(([x, tw, ty], i) => {
    const yBot = i === 0 ? h : tiers[i - 1][2];
    if (v === 'shard') {
      const flip = rnd() < 0.5;
      const from = ty + (h - ty) * 0.42;
      const narrow = tw * 0.4;
      const pts: Array<[number, number]> = flip
        ? [[x, yBot], [x, from], [x + tw - narrow, ty], [x + tw, ty], [x + tw, yBot]]
        : [[x, yBot], [x, ty], [x + narrow, ty], [x + tw, from], [x + tw, yBot]];
      f.body += poly(pts);
      const gi = glassIn;
      const g: Array<[number, number]> = flip
        ? [[x + gi, yBot], [x + gi, from + gi], [x + tw - narrow + gi * 0.4, ty + gi], [x + tw - gi, ty + gi], [x + tw - gi, yBot]]
        : [[x + gi, yBot], [x + gi, ty + gi], [x + narrow - gi * 0.4, ty + gi], [x + tw - gi, from + gi], [x + tw - gi, yBot]];
      f.glaze += poly(g);
    } else {
      f.body += rect(x, ty, tw, yBot - ty);
      f.glaze += rect(x + glassIn, ty + (i === tiers.length - 1 ? 2.4 : 1), tw - 2 * glassIn, yBot - ty - (i === tiers.length - 1 ? 2.4 : 1));
    }
    f.shade += rect(x + tw * 0.86, ty, tw * 0.14, yBot - ty);
    // Mullions down the wall and a slab at every floor.
    const k = clamp(Math.round((tw - 2 * glassIn) / 9), 1, 6);
    for (let m = 1; m < k + 1; m++) {
      const mx = x + glassIn + ((tw - 2 * glassIn) * m) / (k + 1);
      f.fine += seg(mx, ty + (v === 'shard' ? (h - ty) * 0.42 : 3), mx, yBot);
    }
    for (let y = yBot - pitch; y > ty + 3; y -= pitch) f.fine += seg(x + glassIn, y, x + tw - glassIn, y);
    // A few panes lit, floor by floor.
    const floors = Math.floor((yBot - ty - 3) / pitch);
    for (let fl = 0; fl < floors; fl++) {
      if (rnd() > 0.2) continue;
      const c = Math.floor(rnd() * (k + 1));
      const cw = (tw - 2 * glassIn) / (k + 1);
      const py = yBot - (fl + 1) * pitch + 1;
      if (v === 'shard' && py < ty + (h - ty) * 0.5) continue;
      f.lit += rect(x + glassIn + c * cw + 0.6, py, cw - 1.2, pitch - 2);
    }
  });
  if (top && !crane) {
    // A mast on a slab.
    f.line += seg(w * 0.5, top, w * 0.5, 0);
    f.trim += rect(w * 0.3, top - 2, w * 0.4, 2);
  }
  if (crane) {
    // Still going up: the top floors are frame, and a tower crane stands on it.
    const frame = h * 0.12;
    f.line += rect(w * 0.08, top, w * 0.84, frame) + seg(w * 0.08, top + frame / 2, w * 0.92, top + frame / 2);
    const mx = w * 0.62;
    f.accent += rect(mx - 1.2, 3, 2.4, top);
    f.accent += rect(-w * 0.18, 2, w * 1.24, 2.2);
    f.line += seg(mx, 0, -w * 0.12, 2) + seg(mx, 0, w * 1.02, 2);
    const hook = w * 0.08;
    f.line += seg(hook, 4.2, hook, top * 0.62);
    f.trim += rect(hook - 2.2, top * 0.62, 4.4, 3);
    f.top = 0;
  }
}

/** One project's building, in a w × h box. */
export function facade(e: Pick<ProjectEntry, 'key' | 'family' | 'product'>, variant: Variant, w: number, h: number): Facade {
  const rnd = seeded(`${e.key}:facade`);
  const material: Material = e.product ? 'petrol' : e.family === 'study' ? 'stone' : e.family === 'game' ? 'fair' : e.family === 'tool' ? 'metal' : 'glass';
  const f = blank(w, h, material);
  if (e.family === 'study') civic(f, variant, rnd);
  else if (e.family === 'game') fair(f, variant, rnd);
  else if (e.family === 'tool') works(f, variant, rnd);
  else tower(f, variant, rnd);
  return f;
}

