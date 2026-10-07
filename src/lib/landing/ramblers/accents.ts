// Comic accents: the marks that come off a cartoon head. Mort Walker named
// them in The Lexicon of Comicana (1980): grawlix for the swearing symbols,
// emanata for sweat drops, shock lines and steam. They let a small man shout
// without a word, which keeps his speech bubbles to the voice rules. Pure:
// pixels in art units relative to his feet; INK is swapped for the page ink.

import { GLYPHS, type Pixel } from './rig';

export type Accent = 'stressed' | 'mad' | 'surprised' | 'confused' | 'think' | 'pleased' | 'cold' | 'hot' | 'sleepy';

/** Placeholder colour the overlay replaces with the page's text colour. */
export const INK = 'ink';
/** Placeholder colour the overlay replaces with the page background. */
export const PAPER = 'paper';

const RED = '#d2402a';
const BLUE = '#6f9fd8';
const BLUE_L = '#a9c8ef';
const STEAM = '#d9d2c8';
const GOLD = '#e8b21f';
const GREY = '#9a948c';

const SWEARS = ['#@*%!', '$#&!', '%@#*!'];

/** Glyphs drawn `s` art pixels to the dot, so they read at any scale. */
function text(out: Pixel[], str: string, x: number, y: number, colour: (ch: string) => string, jitter?: (i: number) => number, s = 2) {
  [...str].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    const jy = jitter ? jitter(i) * s : 0;
    g.forEach((row, r) =>
      [...row].forEach((on, c) => {
        if (on !== '#') return;
        for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) out.push([x + (i * 4 + c) * s + a, y + r * s + b + jy, colour(ch)]);
      }),
    );
  });
}

/** Width in art pixels of `str` drawn at scale `s`. */
const width = (str: string, s = 2) => (str.length * 4 - 1) * s;

/** A spiky burst balloon, half-width w and half-height h, its spikes stepping round with `turn`. */
function burst(out: Pixel[], cx: number, cy: number, w: number, h: number, spikes: number, turn: number) {
  const inside = new Set<string>();
  const cells: [number, number][] = [];
  for (let y = -h; y <= h; y++)
    for (let x = -w; x <= w; x++) {
      const a = Math.atan2(y / h, x / w);
      const r = Math.hypot(x / w, y / h);
      if (r <= 0.82 + (Math.cos(a * spikes + turn) > 0.3 ? 0.22 : 0)) {
        inside.add(`${cx + x},${cy + y}`);
        cells.push([cx + x, cy + y]);
      }
    }
  for (const [x, y] of cells) {
    const edge = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([a, b]) => !inside.has(`${x + a},${y + b}`));
    out.push([x, y, edge ? INK : PAPER]);
  }
}

/**
 * The accent for a state, `t` seconds in. `head` is the centre of his head and
 * `crown` its top middle, both from the drawn figure; `dir` is where he faces.
 */
export function accents(kind: Accent, t: number, head: [number, number], crown: [number, number], dir: 1 | -1 = 1): Pixel[] {
  const out: Pixel[] = [];
  const [hx, hy] = head;
  const top = crown[1];
  const blink = (n: number) => Math.floor(t * n) % 2 === 1;
  switch (kind) {
    case 'stressed': {
      text(out, '!?!?', hx - width('!?!?') / 2, top - 14, (ch) => (ch === '!' ? RED : INK), (i) => (Math.floor(t * 8 + i) % 2 ? -1 : 0));
      const k = (t * 1.6) % 1;
      for (const side of [-1, 1]) {
        const x = hx + side * (7 + Math.round(k * 4));
        const y = hy - 3 + Math.round(k * k * 6);
        out.push([x, y, BLUE], [x, y + 1, BLUE], [x + side, y + 1, BLUE], [x, y - 1, BLUE_L]);
      }
      break;
    }
    case 'mad': {
      const swear = SWEARS[Math.floor(t / 1.2) % SWEARS.length];
      burst(out, hx, top - 18, 24, 10, 9, Math.floor(t * 6));
      text(out, swear, hx - Math.floor(width(swear) / 2), top - 23, (ch) => (ch === '!' ? RED : INK), (i) => (Math.floor(t * 10 + i * 3) % 3 === 0 ? -1 : 0));
      // An anger vein on the temple, pulsing.
      if (blink(3)) {
        const vx = hx + 4 * dir;
        const vy = top + 3;
        for (const [a, b] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -2], [1, -2], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, 2], [1, 2]]) out.push([vx + a, vy + b, RED]);
      }
      // Steam out of the top of his head.
      for (const side of [-1, 1]) {
        const k = (t * 1.3 + (side > 0 ? 0.5 : 0)) % 1;
        const x = hx + side * (3 + Math.round(k * 4));
        const y = top - 1 - Math.round(k * 7);
        const r = k < 0.5 ? 1 : 2;
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r + 1) out.push([x + a, y + b, STEAM]);
      }
      break;
    }
    case 'surprised':
      text(out, '!', hx - 3, top - 14, () => RED, () => (blink(6) ? -1 : 0));
      for (const [a, b, c, d] of [[-8, -2, -10, -3], [-8, 2, -10, 3], [8, -2, 10, -3], [8, 2, 10, 3], [-5, -7, -6, -9], [5, -7, 6, -9]])
        out.push([hx + a, top + 5 + b, INK], [hx + c, top + 5 + d, INK]);
      break;
    case 'confused':
      text(out, '?', hx + 6 * dir - 3, top - 13 + (blink(2) ? -1 : 0), () => INK);
      break;
    case 'think':
      text(out, '...'.slice(0, Math.floor(t * 2) % 4), hx + 4, top - 12, () => INK);
      break;
    case 'pleased':
      for (const [a, b, ph] of [[-9, -3, 0], [9, -6, 0.33], [0, -10, 0.66]]) {
        if ((t * 1.5 + ph) % 1 >= 0.6) continue;
        for (const [i, j] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([hx + a + i, top + b + j, GOLD]);
      }
      break;
    case 'cold':
      for (const side of [-1, 1])
        for (const dy of [0, 4]) {
          const x = hx + side * (9 + (blink(12) ? 1 : 0));
          out.push([x, hy + 8 + dy, INK], [x, hy + 9 + dy, INK]);
        }
      break;
    case 'hot': {
      const k = (t * 1.2) % 1;
      const x = hx - 6 * dir;
      const y = hy - 2 + Math.round(k * 7);
      out.push([x, y, BLUE], [x, y + 1, BLUE], [x - dir, y + 1, BLUE]);
      for (const i of [-1, 0, 1]) if ((t * 2 + i) % 1 < 0.5) out.push([hx + i * 4, top - 3 - (i === 0 ? 1 : 0), GOLD]);
      break;
    }
    case 'sleepy': {
      const T = t % 4.2;
      if (T > 0.8 && T < 2.4) text(out, 'z', hx + 7 * dir - 3, top - 6, () => GREY);
      break;
    }
  }
  return out;
}
