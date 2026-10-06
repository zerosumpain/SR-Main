// Paints the rambler and his props onto the overlay canvas. Everything is
// placed on the same art-pixel grid as the figure, P screen pixels per unit.

import { car, figure, GLYPHS, PALETTE, type Pixel } from './rig';
import type { Resident } from './resident';
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
const TV_COLOURS = ['#2f8f86', '#e8863a', '#3a5f9a', '#d9a521', '#8a5bb0', '#f2ede4'];

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

// A cheap, repeatable scatter: the same i and frame always land in the same place.
const hash = (n: number) => {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function drawFlowers(ctx: CanvasRenderingContext2D, w: World, r: Resident, P: number) {
  for (const f of r.flowers) {
    const floor = w.floors.find((q) => q.keys.includes(f.key));
    if (!floor) continue;
    const ox = Math.round(f.x);
    const oy = floor.y - P;
    // Seedling, then stem and leaves, then the bloom opens.
    const grown = Math.min(1, (r.clock - f.born) / 4);
    const stem = 1 + Math.round(3 * grown);
    block(ctx, ox, oy, P, -1, 1, 0, 0, SOIL);
    block(ctx, ox, oy, P, 0, 0, -stem, 0, STEM);
    if (grown > 0.4) {
      block(ctx, ox, oy, P, -1, -1, -2, -2, STEM);
      block(ctx, ox, oy, P, 1, 1, -3, -3, STEM);
    }
    if (grown >= 0.75) {
      const top = -stem - 1;
      block(ctx, ox, oy, P, -1, 1, top, top, f.colour);
      block(ctx, ox, oy, P, 0, 0, top - 1, top + 1, f.colour);
      block(ctx, ox, oy, P, 0, 0, top, top, '#f4c430');
    }
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
function drawCloud(ctx: CanvasRenderingContext2D, r: Resident, P: number, umbrella: { x1: number; x2: number; y: number } | null) {
  const cl = r.cloud;
  if (!cl) return;
  const cx = Math.round(cl.x);
  const ground = Math.round(r.y);
  const base = ground - 18 * P - 22;
  const storm = cl.kind === 'storm';
  const flash = storm && r.clock % 4.2 < 0.12;
  const light = flash ? '#f2ede4' : storm ? '#5d6470' : cl.kind === 'snow' ? '#c9cfd6' : '#9aa3ad';
  const dark = flash ? '#d9d4ca' : storm ? '#474d57' : cl.kind === 'snow' ? '#aab2bb' : '#7d8691';
  CLOUD_ROWS.forEach(([a, b], i) => block(ctx, cx, base, P, a, b, i - 5, i - 5, i === CLOUD_ROWS.length - 1 ? dark : light));
  if (flash) {
    // A zigzag down to the floor beside him.
    ctx.fillStyle = '#ffd77a';
    let x = cx + 4 * P;
    for (let y = base; y < ground; y += 3 * P) {
      ctx.fillRect(x, y, P, 3 * P);
      x += ((y / (3 * P)) | 0) % 2 ? P : -P;
    }
  }
  for (let i = 0; i < 22; i++) {
    const u = (r.clock * (cl.kind === 'snow' ? 0.35 : 1.6) + hash(i) ) % 1;
    let x = cx + Math.round((hash(i + 7) * 18 - 9) * P);
    const y = Math.round(base + u * (ground - base));
    if (cl.kind === 'snow') {
      x += Math.round(Math.sin(r.clock * 2 + i) * P);
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(x, y, P, P);
      continue;
    }
    // Rain stops at the umbrella and splashes off its edge.
    if (umbrella && x >= umbrella.x1 && x <= umbrella.x2 && y > umbrella.y) {
      if (u % 0.25 < 0.04) {
        ctx.fillStyle = RAIN;
        ctx.fillRect(x + (x < (umbrella.x1 + umbrella.x2) / 2 ? -P : P), umbrella.y - P, P / 2, P / 2);
      }
      continue;
    }
    ctx.fillStyle = RAIN;
    ctx.fillRect(x, y, Math.max(1, P / 2), 2 * P);
  }
}

function drawUmbrella(ctx: CanvasRenderingContext2D, hx: number, hy: number, P: number) {
  // A long shaft up from his hand, clear of his head, to a striped canopy.
  block(ctx, hx, hy, P, 0, 0, -6, 0, '#4a4440');
  block(ctx, hx, hy, P, -1, 0, 1, 1, '#4a4440');
  const rows: [number, number][] = [
    [-2, 2],
    [-5, 5],
    [-7, 7],
    [-8, 8],
  ];
  rows.forEach(([a, b], i) => {
    for (let x = a; x <= b; x++) block(ctx, hx, hy, P, x, x, i - 10, i - 10, ((x + 20) >> 1) % 2 ? UMBRELLA : UMBRELLA_L);
  });
  return { x1: hx - 8 * P, x2: hx + 8 * P, y: hy - 10 * P };
}

function drawSofa(ctx: CanvasRenderingContext2D, ox: number, oy: number, P: number) {
  block(ctx, ox, oy, P, -7, -6, -10, -1, SOFA);
  block(ctx, ox, oy, P, -5, 8, -4, -2, SOFA_L);
  block(ctx, ox, oy, P, -5, 8, -1, -1, SOFA);
  block(ctx, ox, oy, P, 8, 10, -6, -1, SOFA);
  block(ctx, ox, oy, P, -7, -7, 0, 0, '#2a2420');
  block(ctx, ox, oy, P, 9, 9, 0, 0, '#2a2420');
}

function drawTv(ctx: CanvasRenderingContext2D, ox: number, oy: number, P: number, t: number) {
  block(ctx, ox, oy, P, -2, 2, 0, 0, '#2a2420');
  block(ctx, ox, oy, P, 0, 0, -2, -1, '#2a2420');
  block(ctx, ox, oy, P, -5, 5, -11, -3, '#2a2420');
  // The screen flickers through a programme's colours.
  const scene = Math.floor(t * 1.5);
  for (let x = -4; x <= 4; x++)
    for (let y = -10; y <= -4; y++) block(ctx, ox, oy, P, x, x, y, y, TV_COLOURS[Math.floor(hash(scene * 31 + (x + 5) * 3 + ((y + 11) >> 1)) * TV_COLOURS.length)]);
  // Its glow falls back across the room toward him.
  block(ctx, ox, oy, P, -16, -6, -10, -2, '#9ec5ff', 0.08 + 0.04 * Math.sin(t * 9));
}

function drawDirt(ctx: CanvasRenderingContext2D, ox: number, oy: number, P: number, dir: number, t: number, actT: number) {
  const mound = Math.min(2, Math.floor(actT / 1.5));
  block(ctx, ox, oy, P, 6 * dir - 1, 6 * dir + 1, -mound, 0, SOIL);
  // Clods thrown back over his shoulder with each spadeful.
  const u = (t * 0.8) % 1;
  if (u > 0.45 && u < 0.95) {
    const k = (u - 0.45) / 0.5;
    for (let i = 0; i < 3; i++) {
      const x = ox + Math.round((5 - k * 9 - i) * dir * P);
      const y = oy + Math.round((-6 * Math.sin(Math.PI * k) - i * 0.5) * P);
      ctx.fillStyle = SOIL;
      ctx.fillRect(x, y, P, P);
    }
  }
}

function scribble(ctx: CanvasRenderingContext2D, hx: number, hy: number, P: number, t: number) {
  const frame = Math.floor(t * 8);
  ctx.fillStyle = '#b8321f';
  for (let i = 0; i < 12; i++) {
    const x = Math.round((hash(frame * 13 + i) * 8 - 4) * P);
    const y = Math.round((hash(frame * 7 + i + 50) * 3 - 9) * P);
    ctx.fillRect(hx + x, hy + y, P, P);
  }
}

function sweat(ctx: CanvasRenderingContext2D, hx: number, hy: number, P: number, t: number, dir: number) {
  ctx.fillStyle = '#7fb8e8';
  for (let k = 0; k < 2; k++) {
    const u = (t * 0.9 + k * 0.5) % 1;
    ctx.fillRect(hx - dir * 3 * P, hy + Math.round((u * 5 - 2) * P), P, P);
  }
}

const BUBBLE_SIZE = 12;
const BUBBLE_LINE = 15;

/**
 * A speech bubble (pixel tail pointing at him) or a thought bubble (two dots
 * rising from his head), kept inside the visible width of the page.
 */
function bubble(ctx: CanvasRenderingContext2D, line: Line, x: number, bottom: number, P: number, ink: Ink, view: { left: number; right: number }) {
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
    // A stepped pixel tail down toward him.
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

/** Everything the rambler owns this frame: flowers, car, rope, props, him, weather. */
export function drawWorld(ctx: CanvasRenderingContext2D, w: World, r: Resident, P: number, ink: Ink, view: { left: number; right: number }) {
  drawFlowers(ctx, w, r, P);
  if (r.rope) drawRope(ctx, r.rope, P);
  if (r.prop && (r.mode === 'tv' || r.mode === 'sofa')) {
    const px = Math.round(r.prop.x);
    const py = Math.round(r.prop.y) - P;
    drawSofa(ctx, px, py, P);
    if (r.mode === 'tv') drawTv(ctx, px + 26 * P, py, P, r.animT);
  }

  if (r.car) {
    const cy = Math.round(r.car.floor.y) - P;
    pixels(ctx, car(r.car.dir, r.animT, r.inCar && r.mode !== 'idle', r.inCar ? PALETTE : null), Math.round(r.car.x), cy, P);
  }
  if (r.inCar) {
    drawCloud(ctx, r, P, null);
    if (r.bubble && r.car) bubble(ctx, r.bubble, Math.round(r.car.x), Math.round(r.car.floor.y) - 11 * P, P, ink, view);
    return;
  }

  const ox = Math.round(r.x);
  // On the sofa he sits on its cushions, four art pixels up.
  const seated = r.prop && (r.mode === 'tv' || r.mode === 'sofa') ? 4 * P : 0;
  const oy = Math.round(r.y) - P - seated;
  const dir = r.mode === 'sleep' ? 1 : r.dir;
  const fig = figure(r.mode, r.animT, dir, undefined, undefined, r.umbrella);
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
  if (r.mode === 'dig') drawDirt(ctx, ox, oy, P, dir, r.animT, r.actT);
  pixels(ctx, fig.px, ox, oy, P);
  const hx = ox + fig.head[0] * P;
  const hy = oy + fig.head[1] * P;
  let canopy: { x1: number; x2: number; y: number } | null = null;
  if (r.umbrella) canopy = drawUmbrella(ctx, ox + fig.hand[0] * P, oy + fig.hand[1] * P, P);
  if (r.mode === 'sleep') {
    const breathe = Math.sin(r.animT * 1.6) > 0 ? 1 : 0;
    block(ctx, ox, oy, P, -4, 10, -2 - breathe, -1, BLANKET);
    block(ctx, ox, oy, P, -4, 10, -2 - breathe, -2 - breathe, BLANKET_L);
    zs(ctx, hx, hy, P, r.animT, ink);
  }
  if (r.mode === 'think') thought(ctx, hx, hy, P, r.actT, r.actDur - r.actT < 1.4, ink);
  if (r.mode === 'stressed') scribble(ctx, hx, hy, P, r.animT);
  if (r.mode === 'anxious') sweat(ctx, hx, hy, P, r.animT, dir);
  drawCloud(ctx, r, P, canopy);
  if (r.bubble) bubble(ctx, r.bubble, ox + P, oy + (fig.top - 1) * P - (canopy ? 9 * P : 0), P, ink, view);
}
