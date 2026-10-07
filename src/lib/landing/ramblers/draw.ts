// Paints the rambler and his props onto the overlay canvas. He is drawn on a
// grid of P screen pixels per art pixel; props, weather and furniture on a
// coarser grid of Q = 2P, which keeps them in proportion to him.

import { accents, INK, PAPER, type Accent } from './accents';
import type { Resident } from './resident';
import { car, GLYPHS, PALETTE, render, type Mode, type Pixel } from './rig';
import { wrap, type Line } from './talk';
import type { World } from './world';

export interface Ink {
  ink: string;
  paper: string;
  muted: string;
  /** The site's mono family, for his speech bubbles. */
  font: string;
}

const ROPE = '#b58b52';
const ROPE_D = '#8a6538';
const HOOK = '#8c8780';
const LAMP = '#c4570a';
const GLOW = '#ffd77a';
const BLANKET = '#c4570a';
const BLANKET_L = '#e8863a';
const MATTRESS = '#f7f1e6';
const SOIL = '#6b4a2e';
const STEM = '#4f8a3a';
const RAIN = '#6f9fd8';
const UMBRELLA = '#c4570a';
const UMBRELLA_L = '#7a2f0a';
const SOFA = '#6a4a7a';
const SOFA_L = '#8a6a9a';
const WOOD = '#8a6538';
const WOOD_D = '#6b4a2e';
const MAT = '#3fa3b0';
const PUDDLE = '#7fa8d8';
const PUDDLE_L = '#b9d3f0';
const SNOW = '#f4f6f8';
const SNOW_D = '#cfd6de';
const TV_COLOURS = ['#2f8f86', '#e8863a', '#3a5f9a', '#d9a521', '#8a5bb0', '#f2ede4'];

/** Which comic accent each mode wears. */
export const ACCENT: Partial<Record<Mode, Accent>> = {
  stressed: 'stressed',
  mad: 'mad',
  surprised: 'surprised',
  fidget: 'confused',
  celebrate: 'pleased',
  shiver: 'cold',
  fan: 'hot',
  yawn: 'sleepy',
};

/** Modes where he sits on a seat four prop units up. */
const SEATED = new Set<Mode>(['tv', 'sofa', 'tea', 'eat', 'nap']);

export function pixels(ctx: CanvasRenderingContext2D, px: Pixel[], ox: number, oy: number, P: number, ink?: Ink) {
  for (const [x, y, c] of px) {
    ctx.fillStyle = c === INK ? ink!.ink : c === PAPER ? ink!.paper : c;
    ctx.fillRect(ox + x * P, oy + y * P, P, P);
  }
}

function block(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, x0: number, x1: number, y0: number, y1: number, c: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c;
  ctx.fillRect(ox + x0 * Q, oy + y0 * Q, (x1 - x0 + 1) * Q, (y1 - y0 + 1) * Q);
  ctx.globalAlpha = 1;
}

// A grappling rope: a braided line, the hook claws at the top.
function drawRope(ctx: CanvasRenderingContext2D, rope: { x: number; top: number; bottom: number }, Q: number) {
  const x = Math.round(rope.x) - Math.floor(Q / 2);
  const top = Math.round(rope.top);
  const len = Math.round(rope.bottom) - top;
  if (len <= 0) return;
  ctx.fillStyle = ROPE;
  ctx.fillRect(x, top, Q, len);
  ctx.fillStyle = ROPE_D;
  for (let y = top + Q; y < top + len; y += 3 * Q) ctx.fillRect(x, y, Q, Q);
  ctx.fillStyle = HOOK;
  ctx.fillRect(x - 2 * Q, top - Q, 5 * Q, Q);
  ctx.fillRect(x - 2 * Q, top - 2 * Q, Q, Q);
  ctx.fillRect(x + 2 * Q, top - 2 * Q, Q, Q);
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

function thought(ctx: CanvasRenderingContext2D, hx: number, hy: number, Q: number, t: number, eureka: boolean, ink: Ink) {
  // Two rising puffs, then a cloud holding either ticking dots or a bulb.
  block(ctx, hx, hy, Q, 3, 3, -5, -5, ink.ink);
  block(ctx, hx, hy, Q, 4, 5, -8, -7, ink.ink);
  const cx = 3;
  const cy = -16;
  block(ctx, hx, hy, Q, cx - 1, cx + 9, cy - 1, cy + 6, ink.ink);
  block(ctx, hx, hy, Q, cx, cx + 8, cy, cy + 5, ink.paper);
  if (eureka) {
    block(ctx, hx, hy, Q, cx + 3, cx + 5, cy + 1, cy + 3, GLOW);
    block(ctx, hx, hy, Q, cx + 4, cx + 4, cy + 4, cy + 4, ink.muted);
    block(ctx, hx, hy, Q, cx + 2, cx + 6, cy, cy, GLOW, 0.5);
  } else {
    const lit = Math.floor(t * 2.5) % 4;
    for (let i = 0; i < 3; i++) block(ctx, hx, hy, Q, cx + 2 + i * 2, cx + 2 + i * 2, cy + 3, cy + 3, i < lit ? ink.ink : ink.muted, i < lit ? 1 : 0.35);
  }
}

function zs(ctx: CanvasRenderingContext2D, hx: number, hy: number, Q: number, t: number, ink: Ink) {
  const s = Math.max(1, Q / 2);
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.45 + k / 3) % 1;
    ctx.globalAlpha = 1 - u;
    text(ctx, 'z', Math.round(hx + u * 7 * Q), Math.round(hy - 4 * Q - u * 12 * Q), s, ink.muted);
  }
  ctx.globalAlpha = 1;
}

// A cheap, repeatable scatter: the same i and frame always land in the same place.
const hash = (n: number) => {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function drawFlowers(ctx: CanvasRenderingContext2D, w: World, r: Resident, Q: number) {
  for (const f of r.flowers) {
    const floor = w.floors.find((q) => q.keys.includes(f.key));
    if (!floor) continue;
    const ox = Math.round(f.x);
    const oy = floor.y - Q;
    // Seedling, then stem and leaves, then the bloom opens.
    const grown = Math.min(1, (r.clock - f.born) / 4);
    const stem = 1 + Math.round(3 * grown);
    block(ctx, ox, oy, Q, -1, 1, 0, 0, SOIL);
    block(ctx, ox, oy, Q, 0, 0, -stem, 0, STEM);
    if (grown > 0.4) {
      block(ctx, ox, oy, Q, -1, -1, -2, -2, STEM);
      block(ctx, ox, oy, Q, 1, 1, -3, -3, STEM);
    }
    if (grown >= 0.75) {
      const top = -stem - 1;
      block(ctx, ox, oy, Q, -1, 1, top, top, f.colour);
      block(ctx, ox, oy, Q, 0, 0, top - 1, top + 1, f.colour);
      block(ctx, ox, oy, Q, 0, 0, top, top, '#f4c430');
    }
  }
}

function drawSnowmen(ctx: CanvasRenderingContext2D, w: World, r: Resident, Q: number) {
  for (const s of r.snowmen) {
    const floor = w.floors.find((q) => q.keys.includes(s.key));
    if (!floor) continue;
    const ox = Math.round(s.x);
    const oy = floor.y - Q;
    const ball = (cy: number, rad: number) => {
      for (let y = -rad; y <= rad; y++)
        for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.6) block(ctx, ox, oy, Q, x, x, cy + y, cy + y, x + y < 0 ? SNOW : SNOW_D);
    };
    ball(-3, 3);
    ball(-8, 2);
    block(ctx, ox, oy, Q, 0, 0, -9, -9, '#24170c');
    block(ctx, ox, oy, Q, 1, 2, -8, -8, '#e8863a');
    block(ctx, ox, oy, Q, -1, 1, -11, -11, '#24170c');
    block(ctx, ox, oy, Q, 0, 0, -12, -12, '#24170c');
  }
}

const CLOUD_ROWS: [number, number][] = [
  [-4, 1],
  [-7, 4],
  [-9, 7],
  [-10, 9],
  [-10, 9],
];

/** The cloud that follows him, and whatever it is letting fall. */
function drawCloud(ctx: CanvasRenderingContext2D, r: Resident, Q: number, umbrella: { x1: number; x2: number; y: number } | null) {
  const cl = r.cloud;
  if (!cl) return;
  const cx = Math.round(cl.x);
  const ground = Math.round(r.y);
  const base = ground - r.height - 3 * Q - 22;
  const storm = cl.kind === 'storm';
  const flash = storm && r.clock % 4.2 < 0.12;
  const light = flash ? '#f2ede4' : storm ? '#5d6470' : cl.kind === 'snow' ? '#c9cfd6' : '#9aa3ad';
  const dark = flash ? '#d9d4ca' : storm ? '#474d57' : cl.kind === 'snow' ? '#aab2bb' : '#7d8691';
  CLOUD_ROWS.forEach(([a, b], i) => block(ctx, cx, base, Q, a, b, i - 5, i - 5, i === CLOUD_ROWS.length - 1 ? dark : light));
  if (flash) {
    // A zigzag down to the floor beside him.
    ctx.fillStyle = '#ffd77a';
    let x = cx + 4 * Q;
    for (let y = base; y < ground; y += 3 * Q) {
      ctx.fillRect(x, y, Q, 3 * Q);
      x += ((y / (3 * Q)) | 0) % 2 ? Q : -Q;
    }
  }
  for (let i = 0; i < 22; i++) {
    const u = (r.clock * (cl.kind === 'snow' ? 0.35 : 1.6) + hash(i)) % 1;
    let x = cx + Math.round((hash(i + 7) * 18 - 9) * Q);
    const y = Math.round(base + u * (ground - base));
    if (cl.kind === 'snow') {
      x += Math.round(Math.sin(r.clock * 2 + i) * Q);
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(x, y, Q, Q);
      continue;
    }
    // Rain stops at the umbrella and splashes off its edge.
    if (umbrella && x >= umbrella.x1 && x <= umbrella.x2 && y > umbrella.y) {
      if (u % 0.25 < 0.04) {
        ctx.fillStyle = RAIN;
        ctx.fillRect(x + (x < (umbrella.x1 + umbrella.x2) / 2 ? -Q : Q), umbrella.y - Q, Q / 2, Q / 2);
      }
      continue;
    }
    ctx.fillStyle = RAIN;
    ctx.fillRect(x, y, Math.max(1, Q / 2), 2 * Q);
  }
}

function drawUmbrella(ctx: CanvasRenderingContext2D, hx: number, hy: number, Q: number) {
  // A long shaft up from his hand, clear of his head, to a striped canopy.
  block(ctx, hx, hy, Q, 0, 0, -4, 0, '#4a4440');
  block(ctx, hx, hy, Q, -1, 0, 1, 1, '#4a4440');
  const rows: [number, number][] = [
    [-2, 2],
    [-5, 5],
    [-7, 7],
    [-8, 8],
  ];
  rows.forEach(([a, b], i) => {
    for (let x = a; x <= b; x++) block(ctx, hx, hy, Q, x, x, i - 8, i - 8, ((x + 20) >> 1) % 2 ? UMBRELLA : UMBRELLA_L);
  });
  return { x1: hx - 8 * Q, x2: hx + 8 * Q, y: hy - 8 * Q };
}

function drawSofa(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number) {
  block(ctx, ox, oy, Q, -7, -6, -10, -1, SOFA);
  block(ctx, ox, oy, Q, -5, 8, -4, -2, SOFA_L);
  block(ctx, ox, oy, Q, -5, 8, -1, -1, SOFA);
  block(ctx, ox, oy, Q, 8, 10, -6, -1, SOFA);
  block(ctx, ox, oy, Q, -7, -7, 0, 0, '#2a2420');
  block(ctx, ox, oy, Q, 9, 9, 0, 0, '#2a2420');
}

function drawTv(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, t: number) {
  block(ctx, ox, oy, Q, -2, 2, 0, 0, '#2a2420');
  block(ctx, ox, oy, Q, 0, 0, -2, -1, '#2a2420');
  block(ctx, ox, oy, Q, -5, 5, -11, -3, '#2a2420');
  // The screen flickers through a programme's colours.
  const scene = Math.floor(t * 1.5);
  for (let x = -4; x <= 4; x++)
    for (let y = -10; y <= -4; y++) block(ctx, ox, oy, Q, x, x, y, y, TV_COLOURS[Math.floor(hash(scene * 31 + (x + 5) * 3 + ((y + 11) >> 1)) * TV_COLOURS.length)]);
  // Its glow falls back across the room toward him.
  block(ctx, ox, oy, Q, -16, -6, -10, -2, '#9ec5ff', 0.08 + 0.04 * Math.sin(t * 9));
}

/** A stool under him and a little table in front, with a plate or a teapot. */
function drawTable(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, dir: number, eating: boolean, t: number) {
  block(ctx, ox, oy, Q, -3, 2, -4, -4, WOOD);
  block(ctx, ox, oy, Q, -3, -3, -3, 0, WOOD_D);
  block(ctx, ox, oy, Q, 2, 2, -3, 0, WOOD_D);
  const tx = ox + 9 * Q * dir;
  block(ctx, tx, oy, Q, -4, 4, -7, -7, WOOD);
  block(ctx, tx, oy, Q, -3, -3, -6, 0, WOOD_D);
  block(ctx, tx, oy, Q, 3, 3, -6, 0, WOOD_D);
  if (eating) {
    block(ctx, tx, oy, Q, -2, 2, -8, -8, '#f3e9d8');
    block(ctx, tx, oy, Q, -1, 1, -9, -9, '#d9a521');
  } else {
    block(ctx, tx, oy, Q, -1, 2, -10, -8, '#2f8f86');
    block(ctx, tx, oy, Q, 3, 3, -9, -9, '#2f8f86');
    // Steam off the pot.
    for (let k = 0; k < 2; k++) {
      const u = (t * 0.7 + k * 0.5) % 1;
      block(ctx, tx + Math.round(Math.sin(u * 6 + k) * Q), oy, Q, 0, 0, -11 - Math.round(u * 4), -11 - Math.round(u * 4), '#d9d2c8', 1 - u);
    }
  }
}

function drawPuddle(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, lift: number, t: number) {
  block(ctx, ox, oy, Q, -8, 8, 0, 0, PUDDLE);
  block(ctx, ox, oy, Q, -5, 5, 0, 0, PUDDLE_L);
  if (lift < 1) {
    // Splash as his feet come down.
    for (let i = 0; i < 6; i++) {
      const a = (i / 5) * Math.PI;
      const k = (t * 3) % 1;
      block(ctx, ox + Math.round(Math.cos(a) * 6 * k * Q), oy - Math.round(Math.sin(a) * 4 * k * Q), Q, 0, 0, 0, 0, PUDDLE_L, 1 - k);
    }
  }
}

function drawDirt(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, dir: number, t: number, actT: number) {
  const mound = Math.min(2, Math.floor(actT / 1.5));
  block(ctx, ox, oy, Q, 6 * dir - 1, 6 * dir + 1, -mound, 0, SOIL);
  // Clods thrown back over his shoulder with each spadeful.
  const u = (t * 0.8) % 1;
  if (u > 0.45 && u < 0.95) {
    const k = (u - 0.45) / 0.5;
    for (let i = 0; i < 3; i++) {
      const x = ox + Math.round((5 - k * 9 - i) * dir * Q);
      const y = oy + Math.round((-6 * Math.sin(Math.PI * k) - i * 0.5) * Q);
      ctx.fillStyle = SOIL;
      ctx.fillRect(x, y, Q, Q);
    }
  }
}

function sweat(ctx: CanvasRenderingContext2D, hx: number, hy: number, Q: number, t: number, dir: number) {
  ctx.fillStyle = '#7fb8e8';
  for (let k = 0; k < 2; k++) {
    const u = (t * 0.9 + k * 0.5) % 1;
    ctx.fillRect(hx - dir * 4 * Q, hy + Math.round((u * 5 - 2) * Q), Q, Q);
  }
}

function stars(ctx: CanvasRenderingContext2D, ox: number, oy: number, Q: number, t: number) {
  for (let i = 0; i < 7; i++) {
    const x = Math.round((hash(i + 3) * 40 - 20) * Q);
    const y = -Math.round((26 + hash(i + 11) * 14) * Q);
    const on = (t * 0.8 + hash(i)) % 1 < 0.7;
    block(ctx, ox + x, oy + y, Q / 2, 0, 0, 0, 0, '#ffd77a', on ? 1 : 0.3);
  }
}

/** Accent marks with a paper halo round the ink ones, so they read on dark ground too. */
export function paintAccent(ctx: CanvasRenderingContext2D, marks: Pixel[], ox: number, oy: number, P: number, ink: Ink) {
  const taken = new Set(marks.map(([x, y]) => `${x},${y}`));
  const halo: Pixel[] = [];
  for (const [x, y, c] of marks)
    if (c === INK)
      for (const [a, b] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${x + a},${y + b}`;
        if (!taken.has(k)) {
          taken.add(k);
          halo.push([x + a, y + b, PAPER]);
        }
      }
  pixels(ctx, halo, ox, oy, P, ink);
  pixels(ctx, marks, ox, oy, P, ink);
}

const BUBBLE_SIZE = 12;
const BUBBLE_LINE = 15;

/**
 * A speech bubble (pixel tail pointing at him) or a thought bubble (two dots
 * rising from his head), kept inside the visible width of the page.
 */
function bubble(ctx: CanvasRenderingContext2D, line: Line, x: number, bottom: number, Q: number, ink: Ink, view: { left: number; right: number }) {
  const P = Q / 2;
  const rows = wrap(line.text);
  ctx.font = `500 ${BUBBLE_SIZE}px ${ink.font}`;
  const textW = Math.max(...rows.map((r) => ctx.measureText(r).width));
  const w = Math.ceil(textW) + 16;
  const h = rows.length * BUBBLE_LINE + 10;
  const gap = line.kind === 'think' ? 5 * P : 3 * P;
  const left = Math.round(Math.max(view.left + 4, Math.min(view.right - w - 4, x - w / 2)));
  const top = Math.round(bottom - gap - h);
  ctx.fillStyle = ink.ink;
  ctx.fillRect(left - 2, top - 2, w + 4, h + 4);
  ctx.fillStyle = ink.paper;
  ctx.fillRect(left, top, w, h);
  const tx = Math.round(Math.max(left + 6, Math.min(left + w - 10, x)));
  // Tails are paper-filled with an ink rim, so they show on the dark hero too.
  const dot = (dx: number, dy: number, size: number) => {
    ctx.fillStyle = ink.ink;
    ctx.fillRect(dx - 1, dy - 1, size + 2, size + 2);
    ctx.fillStyle = ink.paper;
    ctx.fillRect(dx, dy, size, size);
  };
  if (line.kind === 'say') {
    dot(tx, top + h, 2 * P);
    dot(tx, top + h + 2 * P, P);
    ctx.fillStyle = ink.paper;
    ctx.fillRect(tx, top + h - 2, 2 * P, 3);
  } else {
    dot(tx, top + h + P + 1, 2 * P);
    dot(tx + P, top + h + 3 * P + 3, P);
  }
  ctx.fillStyle = ink.ink;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `${line.kind === 'think' ? 'italic ' : ''}500 ${BUBBLE_SIZE}px ${ink.font}`;
  rows.forEach((r, i) => ctx.fillText(r, left + 8, top + 6 + i * BUBBLE_LINE));
}

export interface Bounds {
  /** His body on the page, for the link that follows him. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Everything the rambler owns this frame: flowers, car, rope, props, him,
 * weather. `dpr` snaps him to whole device pixels. Returns where he is.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, w: World, r: Resident, P: number, ink: Ink, view: { left: number; right: number }, dpr = 1): Bounds | null {
  const Q = 2 * P;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  drawFlowers(ctx, w, r, Q);
  drawSnowmen(ctx, w, r, Q);
  if (r.rope) drawRope(ctx, r.rope, Q);
  const prop = r.prop;
  if (prop && (prop.kind === 'sofa' || prop.kind === 'tv') && SEATED.has(r.mode)) {
    const px = snap(prop.x);
    const py = Math.round(prop.y) - Q;
    drawSofa(ctx, px, py, Q);
    if (prop.kind === 'tv') drawTv(ctx, px + 26 * Q, py, Q, r.animT);
  }
  if (prop?.kind === 'mat') block(ctx, snap(prop.x), Math.round(prop.y) - Q, Q, -9, 9, 0, 0, MAT);

  if (r.car) {
    const cy = Math.round(r.car.floor.y) - Q;
    pixels(ctx, car(r.car.dir, r.animT, r.inCar && r.mode !== 'idle', r.inCar ? PALETTE : null, r.stalling ? 1 : 0), snap(r.car.x), cy, Q);
    if (r.stalling && r.animT % 0.5 < 0.25) block(ctx, snap(r.car.x) - 10 * Q * r.car.dir, cy, Q, -1, 0, -3, -2, '#9a948c', 0.7);
  }
  if (r.inCar) {
    drawCloud(ctx, r, Q, null);
    if (r.bubble && r.car) bubble(ctx, r.bubble, Math.round(r.car.x), Math.round(r.car.floor.y) - 11 * Q, Q, ink, view);
    return r.car ? { x: r.car.x - 9 * Q, y: r.car.floor.y - 10 * Q, w: 18 * Q, h: 10 * Q } : null;
  }

  const ox = snap(r.x);
  const seated = SEATED.has(r.mode) && prop ? 4 * Q : 0;
  const oy = Math.round(r.y) - P - seated;
  const dir = r.mode === 'sleep' || r.mode === 'nap' ? 1 : r.dir;
  if (prop?.kind === 'table' && (r.mode === 'tea' || r.mode === 'eat')) drawTable(ctx, ox, Math.round(r.y) - Q, Q, r.dir, r.mode === 'eat', r.animT);
  if (prop?.kind === 'puddle') drawPuddle(ctx, ox, Math.round(r.y) - Q, Q, r.pose?.lift ?? 0, r.animT);
  if (!r.pose) return null;
  const fig = render(r.pose, dir, {
    scarf: r.mood.scarf ? (r.pose.view === 'side' ? r.anim.scarf : true) : undefined,
    scarfSway: Math.sin(r.clock * 2) * 0.8,
    hairTip: r.anim.hairTip,
    umbrella: r.umbrella,
  });
  if (r.mode === 'sleep') {
    block(ctx, ox, oy, Q, -11, 10, 0, 0, MATTRESS);
    block(ctx, ox, oy, Q, -11, -5, -1, -1, '#ffffff');
  }
  if (r.mode === 'study') {
    const lx = ox + 11 * Q * r.dir;
    block(ctx, lx, oy, Q, -1, 1, 0, 0, ink.ink);
    block(ctx, lx, oy, Q, 0, 0, -5, -1, ink.ink);
    block(ctx, lx, oy, Q, 0, 2, -7, -7, LAMP);
    block(ctx, lx, oy, Q, -1, 3, -6, -6, LAMP);
    for (let i = 0; i < 3; i++) block(ctx, lx, oy, Q, -1 - i, 3 + i, -5 + i, -5 + i, GLOW, 0.28 - i * 0.06);
  }
  if (r.mode === 'dig') drawDirt(ctx, ox, oy, Q, dir, r.animT, r.actT);
  if (r.mode === 'stargaze') stars(ctx, ox, oy, Q, r.animT);
  pixels(ctx, fig.px, ox, oy, P);
  const hx = ox + fig.head[0] * P;
  const hy = oy + fig.head[1] * P;
  let canopy: { x1: number; x2: number; y: number } | null = null;
  if (r.umbrella) canopy = drawUmbrella(ctx, ox + fig.hand[0] * P, oy + fig.hand[1] * P, Q);
  if (r.mode === 'sleep') {
    const breathe = Math.sin(r.animT * 1.6) > 0 ? 1 : 0;
    block(ctx, ox, oy, Q, -4, 10, -2 - breathe, -1, BLANKET);
    block(ctx, ox, oy, Q, -4, 10, -2 - breathe, -2 - breathe, BLANKET_L);
  }
  if (r.mode === 'sleep' || r.mode === 'nap') zs(ctx, hx, hy, Q, r.animT, ink);
  if (r.mode === 'think') thought(ctx, hx, hy, Q, r.actT, r.actDur - r.actT < 1.4, ink);
  if (r.mode === 'anxious') sweat(ctx, hx, hy, Q, r.animT, dir);
  const accent = ACCENT[r.mode];
  let raise = 0;
  if (accent) {
    const marks = accents(accent, r.animT, fig.head, fig.crown, dir);
    paintAccent(ctx, marks, ox, oy, P, ink);
    if (marks.length) raise = Math.max(0, fig.top - Math.min(...marks.map((m) => m[1]))) * P;
  }
  drawCloud(ctx, r, Q, canopy);
  if (r.bubble) bubble(ctx, r.bubble, ox + P, oy + (fig.top - 1) * P - raise - (canopy ? 9 * Q : 0), Q, ink, view);
  const xs = fig.px.map((p) => p[0]);
  const ys = fig.px.map((p) => p[1]);
  const x1 = Math.min(...xs);
  const y1 = Math.min(...ys);
  return { x: ox + x1 * P, y: oy + y1 * P, w: (Math.max(...xs) - x1 + 1) * P, h: (Math.max(...ys) - y1 + 1) * P };
}
