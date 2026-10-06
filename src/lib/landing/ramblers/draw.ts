// Paints the rambler and his props onto the overlay canvas. Everything is
// placed on the same art-pixel grid as the figure, P screen pixels per unit.

import { car, figure, GLYPHS, PALETTE, type Pixel } from './rig';
import type { Resident } from './resident';

export interface Ink {
  ink: string;
  paper: string;
  muted: string;
}

const ROPE = '#b58b52';
const ROPE_D = '#8a6538';
const HOOK = '#8c8780';
const LAMP = '#c4570a';
const GLOW = '#ffd77a';
const BLANKET = '#c4570a';
const BLANKET_L = '#e8863a';
const MATTRESS = '#f7f1e6';

function pixels(ctx: CanvasRenderingContext2D, px: Pixel[], ox: number, oy: number, P: number) {
  for (const [x, y, c] of px) {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x * P, oy + y * P, P, P);
  }
}

function block(ctx: CanvasRenderingContext2D, ox: number, oy: number, P: number, x0: number, x1: number, y0: number, y1: number, c: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c;
  ctx.fillRect(ox + x0 * P, oy + y0 * P, (x1 - x0 + 1) * P, (y1 - y0 + 1) * P);
  ctx.globalAlpha = 1;
}

// A grappling rope: a braided line, the hook claws at the top.
function drawRope(ctx: CanvasRenderingContext2D, rope: { x: number; top: number; bottom: number }, P: number) {
  const x = Math.round(rope.x) - Math.floor(P / 2);
  const top = Math.round(rope.top);
  const len = Math.round(rope.bottom) - top;
  if (len <= 0) return;
  ctx.fillStyle = ROPE;
  ctx.fillRect(x, top, P, len);
  ctx.fillStyle = ROPE_D;
  for (let y = top + P; y < top + len; y += 3 * P) ctx.fillRect(x, y, P, P);
  ctx.fillStyle = HOOK;
  ctx.fillRect(x - 2 * P, top - P, 5 * P, P);
  ctx.fillRect(x - 2 * P, top - 2 * P, P, P);
  ctx.fillRect(x + 2 * P, top - 2 * P, P, P);
}

function text(ctx: CanvasRenderingContext2D, word: string, x: number, y: number, s: number, colour: string) {
  ctx.fillStyle = colour;
  let cx = x;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, r) => [...row].forEach((on, c) => on === '#' && ctx.fillRect(cx + c * s, y + r * s, s, s)));
    cx += (g[0].length + 1) * s;
  }
  return cx - x - s;
}

function speech(ctx: CanvasRenderingContext2D, word: string, x: number, bottom: number, P: number, ink: Ink) {
  const s = Math.max(1, P - 1);
  const width = [...word].reduce((w, ch) => w + ((GLYPHS[ch]?.[0].length ?? 0) + 1) * s, -s);
  const w = width + 6 * s;
  const h = 9 * s;
  const left = Math.round(x - w / 2);
  const top = Math.round(bottom - h);
  ctx.fillStyle = ink.ink;
  ctx.fillRect(left - s, top - s, w + 2 * s, h + 2 * s);
  ctx.fillRect(left + 2 * s, top + h, 2 * s, 2 * s);
  ctx.fillStyle = ink.paper;
  ctx.fillRect(left, top, w, h);
  text(ctx, word, left + 3 * s, top + 2 * s, s, ink.ink);
}

function thought(ctx: CanvasRenderingContext2D, hx: number, hy: number, P: number, t: number, eureka: boolean, ink: Ink) {
  // Two rising puffs, then a cloud holding either ticking dots or a bulb.
  block(ctx, hx, hy, P, 2, 2, -4, -4, ink.ink);
  block(ctx, hx, hy, P, 3, 4, -7, -6, ink.ink);
  const cx = 2;
  const cy = -15;
  block(ctx, hx, hy, P, cx - 1, cx + 9, cy - 1, cy + 6, ink.ink);
  block(ctx, hx, hy, P, cx, cx + 8, cy, cy + 5, ink.paper);
  if (eureka) {
    block(ctx, hx, hy, P, cx + 3, cx + 5, cy + 1, cy + 3, GLOW);
    block(ctx, hx, hy, P, cx + 4, cx + 4, cy + 4, cy + 4, ink.muted);
    block(ctx, hx, hy, P, cx + 2, cx + 6, cy, cy, GLOW, 0.5);
  } else {
    const lit = Math.floor(t * 2.5) % 4;
    for (let i = 0; i < 3; i++) block(ctx, hx, hy, P, cx + 2 + i * 2, cx + 2 + i * 2, cy + 3, cy + 3, i < lit ? ink.ink : ink.muted, i < lit ? 1 : 0.35);
  }
}

function zs(ctx: CanvasRenderingContext2D, hx: number, hy: number, P: number, t: number, ink: Ink) {
  const s = Math.max(1, P - 1);
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.45 + k / 3) % 1;
    ctx.globalAlpha = 1 - u;
    text(ctx, 'z', Math.round(hx + u * 7 * P), Math.round(hy - 4 * P - u * 12 * P), s, ink.muted);
  }
  ctx.globalAlpha = 1;
}

/** Everything the rambler owns this frame: his car, any rope he has out, then him. */
export function drawWorld(ctx: CanvasRenderingContext2D, r: Resident, P: number, ink: Ink) {
  if (r.rope) drawRope(ctx, r.rope, P);

  if (r.car) {
    const cy = Math.round(r.car.floor.y) - P;
    pixels(ctx, car(r.car.dir, r.animT, r.inCar && r.mode !== 'idle', r.inCar ? PALETTE : null), Math.round(r.car.x), cy, P);
  }
  if (r.inCar) return;

  const ox = Math.round(r.x);
  const oy = Math.round(r.y) - P;
  const dir = r.mode === 'sleep' ? 1 : r.dir;
  const fig = figure(r.mode, r.animT, dir);
  if (r.mode === 'sleep') {
    block(ctx, ox, oy, P, -11, 10, 0, 0, MATTRESS);
    block(ctx, ox, oy, P, -11, -5, -1, -1, '#ffffff');
  }
  if (r.mode === 'study') {
    const lx = ox + 9 * P * r.dir;
    block(ctx, lx, oy, P, -1, 1, 0, 0, ink.ink);
    block(ctx, lx, oy, P, 0, 0, -5, -1, ink.ink);
    block(ctx, lx, oy, P, 0, 2, -7, -7, LAMP);
    block(ctx, lx, oy, P, -1, 3, -6, -6, LAMP);
    for (let i = 0; i < 3; i++) block(ctx, lx, oy, P, -1 - i, 3 + i, -5 + i, -5 + i, GLOW, 0.28 - i * 0.06);
  }
  pixels(ctx, fig.px, ox, oy, P);
  const hx = ox + fig.head[0] * P;
  const hy = oy + fig.head[1] * P;
  if (r.mode === 'sleep') {
    const breathe = Math.sin(r.animT * 1.6) > 0 ? 1 : 0;
    block(ctx, ox, oy, P, -4, 10, -2 - breathe, -1, BLANKET);
    block(ctx, ox, oy, P, -4, 10, -2 - breathe, -2 - breathe, BLANKET_L);
    zs(ctx, hx, hy, P, r.animT, ink);
  }
  if (r.mode === 'think') thought(ctx, hx, hy, P, r.actT, r.actDur - r.actT < 1.4, ink);
  if (r.say) speech(ctx, r.say, ox + P, oy + (fig.top - 2) * P, P, ink);
}
