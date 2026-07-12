// Transition wipe renderers — canvas2d overlays played by TransitionFx while
// the player switches slides. One factory per wipe id in effects.ts (plus the
// generic directional sweep used by background effects with role transition).
// Each factory captures its particle state in a closure; render(ctx, t, now)
// is called once per frame over a cleared canvas until t reaches 1.

import type { Travel } from './navigation';
import { TINT_COLORS, type Zone } from './effects';

export interface WipeCtx {
  /** Canvas size in device px (already dpr-scaled). */
  w: number;
  h: number;
  /** CSS-px size (zones are in CSS px). */
  cw: number;
  ch: number;
  dpr: number;
  travel: Travel;
  /** Unit vector the OUTGOING content leaves along (opposite the camera move). */
  dir: [number, number];
  intensity: number;
  /** Resolved tint hex for the block's tint. */
  color: string;
  /** Outgoing block rects in CSS px (melt/shatter spawn areas). */
  zones: Zone[];
}

export interface Wipe {
  duration: number;
  render(ctx: CanvasRenderingContext2D, t: number, now: number): void;
}

/* ------------------------------------------------------------------ sweep */

function sweep({ w, h, dpr, dir, intensity, color }: WipeCtx): Wipe {
  const parts = Array.from({ length: Math.round(90 + 160 * intensity) }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    v: 0.55 + Math.random(),
    r: (0.6 + Math.random() * 1.8) * dpr,
  }));
  return {
    duration: 700,
    render(ctx, t) {
      ctx.fillStyle = color;
      const speedBase = (w / 900) * 26;
      const fade = t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.globalAlpha = 0.5 * fade;
      for (const p of parts) {
        p.x += dir[0] * p.v * speedBase * (1 - t * 0.4);
        p.y += dir[1] * p.v * speedBase * (1 - t * 0.4);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * (dir[0] ? 4 : 1), p.r * (dir[1] ? 4 : 1), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

/* ------------------------------------------------------------------- melt */

function melt({ w, h, cw, ch, dpr, dir, intensity, zones }: WipeCtx): Wipe {
  // Spawn inside the outgoing content's rects, density ∝ area.
  const areas = zones.length ? zones : [{ x: cw * 0.1, y: ch * 0.15, w: cw * 0.8, h: ch * 0.6 }];
  const total = Math.round(500 + 500 * intensity);
  const sumArea = areas.reduce((a, z) => a + z.w * z.h, 0) || 1;
  const parts = areas.flatMap((z) => {
    const n = Math.max(8, Math.round((total * (z.w * z.h)) / sumArea));
    return Array.from({ length: n }, () => ({
      x: (z.x + Math.random() * z.w) * dpr,
      y: (z.y + Math.random() * z.h) * dpr,
      v: 0.5 + Math.random(),
      r: (0.7 + Math.random() * 1.6) * dpr,
      wob: Math.random() * Math.PI * 2,
    }));
  });
  const MELT_PHASE = 0.28; // first stretch: sag; after: blow away
  return {
    duration: 1050,
    render(ctx, t, now) {
      ctx.fillStyle = TINT_COLORS.ink;
      const speedBase = (w / 900) * 30;
      const fade = t < 0.15 ? t / 0.15 : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      ctx.globalAlpha = 0.75 * fade;
      for (const p of parts) {
        if (t < MELT_PHASE) {
          // melt: sag downward with a wobble, barely drifting
          p.y += p.v * dpr * 2.6 * (t / MELT_PHASE);
          p.x += Math.sin(now / 300 + p.wob) * 0.5 * dpr;
        } else {
          // blow away: accelerate along the travel direction + turbulence
          const gust = (t - MELT_PHASE) / (1 - MELT_PHASE);
          p.x += dir[0] * p.v * speedBase * gust + Math.sin(now / 180 + p.wob) * 1.1 * dpr;
          p.y += dir[1] * p.v * speedBase * gust + Math.cos(now / 210 + p.wob) * 0.9 * dpr - p.v * dpr * 0.4;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

/* ---------------------------------------------------------------- shatter */

function shatter({ w, cw, ch, dpr, dir, intensity, color, zones }: WipeCtx): Wipe {
  // Angular shards born from the outgoing content's rects: a beat of stillness
  // (the crack), then they tumble away along the travel direction.
  const areas = zones.length ? zones : [{ x: cw * 0.1, y: ch * 0.15, w: cw * 0.8, h: ch * 0.6 }];
  const total = Math.round(70 + 80 * intensity);
  const sumArea = areas.reduce((a, z) => a + z.w * z.h, 0) || 1;
  const shards = areas.flatMap((z) => {
    const n = Math.max(4, Math.round((total * (z.w * z.h)) / sumArea));
    return Array.from({ length: n }, () => {
      const size = (6 + Math.random() * 22) * dpr;
      // shard silhouette: 3 or 4 offset vertices
      const nv = Math.random() < 0.5 ? 3 : 4;
      const verts: [number, number][] = Array.from({ length: nv }, (_, k) => {
        const a = (k / nv) * Math.PI * 2 + Math.random() * 0.7;
        const r = size * (0.5 + Math.random() * 0.5);
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
      return {
        x: (z.x + Math.random() * z.w) * dpr,
        y: (z.y + Math.random() * z.h) * dpr,
        size,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.18,
        v: 0.6 + Math.random() * 1.2,
        sx: (Math.random() - 0.5) * 2.4, // sideways scatter
        verts,
      };
    });
  });
  const HOLD = 0.12;
  return {
    duration: 900,
    render(ctx, t) {
      ctx.fillStyle = color;
      const speedBase = (w / 900) * 34;
      const fade = t < 0.1 ? t / 0.1 : t > 0.62 ? 1 - (t - 0.62) / 0.38 : 1;
      ctx.globalAlpha = 0.8 * fade;
      const gust = t < HOLD ? 0 : (t - HOLD) / (1 - HOLD);
      for (const s of shards) {
        if (t >= HOLD) {
          s.x += (dir[0] * s.v * speedBase + s.sx * dpr) * gust;
          s.y += (dir[1] * s.v * speedBase + s.v * dpr * 3.2) * gust * (dir[1] ? 1 : 0.4);
          s.rot += s.vr * gust;
        }
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.beginPath();
        ctx.moveTo(s.verts[0][0], s.verts[0][1]);
        for (let k = 1; k < s.verts.length; k++) ctx.lineTo(s.verts[k][0], s.verts[k][1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },
  };
}

/* --------------------------------------------------------------- inkbleed */

function inkbleed({ w, h, dpr, dir, intensity, color }: WipeCtx): Wipe {
  // Ink dropped in water: blobs bloom from the travel-source edge until they
  // flood the page, then the wash clears. Each blob is a cluster of offset
  // circles so the edge reads organic, not geometric.
  const N = Math.round(10 + 8 * intensity);
  const rmax = Math.hypot(w, h) * 0.34;
  const blobs = Array.from({ length: N }, (_, i) => {
    // bias spawn toward the edge the new slide arrives from (opposite dir)
    const ex = dir[0] === 0 ? Math.random() : dir[0] < 0 ? 0.65 + Math.random() * 0.35 : Math.random() * 0.35;
    const ey = dir[1] === 0 ? Math.random() : dir[1] < 0 ? 0.65 + Math.random() * 0.35 : Math.random() * 0.35;
    return {
      x: ex * w,
      y: ey * h,
      delay: (i / N) * 0.3,
      rmax: rmax * (0.6 + Math.random() * 0.8),
      lobes: Array.from({ length: 5 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: 0.25 + Math.random() * 0.35,
        s: 0.55 + Math.random() * 0.4,
      })),
    };
  });
  return {
    duration: 1150,
    render(ctx, t) {
      ctx.fillStyle = color;
      // flood to ~0.9 alpha by mid-wipe, then the wash clears
      const alpha = t < 0.45 ? (t / 0.45) * 0.9 : t > 0.6 ? 0.9 * (1 - (t - 0.6) / 0.4) : 0.9;
      ctx.globalAlpha = Math.max(0, alpha);
      for (const b of blobs) {
        const bt = Math.max(0, Math.min(1, (t - b.delay) / (0.6 - b.delay * 0.4)));
        if (bt <= 0) continue;
        const grow = 1 - Math.pow(1 - bt, 3); // ease-out bloom
        const r = b.rmax * grow;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
        for (const l of b.lobes) {
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(l.a) * r * l.d, b.y + Math.sin(l.a) * r * l.d, r * l.s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ slats */

function slats({ w, h, travel, intensity, color }: WipeCtx): Wipe {
  // Staggered paper slats sweep across with the camera move: each strip wipes
  // on from its leading edge, then clears. Crisp and mechanical.
  const N = Math.round(9 + 6 * intensity);
  const vertical = travel === 'up' || travel === 'down';
  // sweep the way the outgoing content leaves (opposite the camera move)
  const reverse = travel === 'right' || travel === 'down';
  const STAGGER = 0.45;
  return {
    duration: 800,
    render(ctx, t) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.92;
      for (let i = 0; i < N; i++) {
        const order = reverse ? N - 1 - i : i;
        const p = Math.max(0, Math.min(1, (t * (1 + STAGGER) - (order / (N - 1)) * STAGGER)));
        const cover = 1 - Math.abs(2 * p - 1); // wipe on, then off
        if (cover <= 0) continue;
        const lead = p < 0.5 ? 0 : 1 - cover; // grows from leading edge, clears from trailing
        if (vertical) {
          const strip = w / N;
          const y0 = (reverse ? 1 - lead - cover : lead) * h;
          ctx.fillRect(i * strip, y0, strip + 1, cover * h);
        } else {
          const strip = h / N;
          const x0 = (reverse ? 1 - lead - cover : lead) * w;
          ctx.fillRect(x0, i * strip, cover * w, strip + 1);
        }
      }
    },
  };
}

/* --------------------------------------------------------------- dissolve */

function dissolve({ w, h, dpr, travel, intensity, color }: WipeCtx): Wipe {
  // A halftone screen cascades across the page: each dot swells to cover its
  // cell then shrinks away, thresholded by position along the travel + noise.
  const cell = 26 * dpr;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const noise = new Float32Array(cols * rows);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random();
  const vertical = travel === 'up' || travel === 'down';
  // cascade the way the outgoing content leaves (opposite the camera move)
  const reverse = travel === 'right' || travel === 'down';
  const WINDOW = 0.42; // how long one dot's swell-shrink lasts, in t units
  return {
    duration: 900,
    render(ctx, t) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      const rmaxBase = cell * (0.62 + intensity * 0.2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const along = vertical ? r / rows : c / cols;
          const pos = reverse ? 1 - along : along;
          const th = pos * (1 - WINDOW) * 0.75 + noise[r * cols + c] * 0.25;
          const dt = (t - th) / WINDOW;
          if (dt <= 0 || dt >= 1) continue;
          const swell = 1 - Math.abs(2 * dt - 1);
          ctx.beginPath();
          ctx.arc((c + 0.5) * cell, (r + 0.5) * cell, rmaxBase * swell, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}

/* ------------------------------------------------------------------- iris */

function iris({ w, h, color }: WipeCtx): Wipe {
  // Clean cinema iris: ink closes over the page from the centre, then opens
  // onto the next slide. Cover 0→0.48, hold, reveal 0.55→1.
  const cx = w / 2;
  const cy = h / 2;
  const rmax = Math.hypot(w, h) / 2 + 4;
  return {
    duration: 1000,
    render(ctx, t) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      if (t < 0.48) {
        const grow = 1 - Math.pow(1 - t / 0.48, 2.4); // ease-out close
        ctx.beginPath();
        ctx.arc(cx, cy, rmax * grow, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(0, 0, w, h);
        if (t > 0.55) {
          const open = Math.pow((t - 0.55) / 0.45, 1.8); // ease-in open
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(cx, cy, rmax * open, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ erode */

function erode({ w, h, dpr, travel, intensity, color }: WipeCtx): Wipe {
  // The page is eaten from the edge: a jagged front advances (per-column
  // noise), specks crumbling in a band ahead of it; a second jagged front
  // follows and clears. Sweeps the way the outgoing content leaves.
  const vertical = travel === 'up' || travel === 'down';
  const reverse = travel === 'right' || travel === 'down';
  const span = vertical ? h : w;
  const across = vertical ? w : h;
  const COL = 10 * dpr;
  const cols = Math.ceil(across / COL);
  const jag = new Float32Array(cols);
  const jag2 = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    jag[i] = Math.random();
    jag2[i] = Math.random();
  }
  const JAG = 70 * dpr;
  const speckCount = Math.round(160 + intensity * 160);
  const specks = Array.from({ length: speckCount }, () => ({
    a: Math.random(), // position across
    lead: Math.random() * 120 * dpr, // distance ahead of the front
    r: (0.6 + Math.random() * 1.6) * dpr,
  }));
  const rect = (ctx: CanvasRenderingContext2D, a0: number, f0: number, f1: number) => {
    // fill from f0 to f1 along the span at across-position a0 (one column)
    const lo = Math.min(f0, f1);
    const hi = Math.max(f0, f1);
    if (vertical) ctx.fillRect(a0, reverse ? span - hi : lo, COL + 1, hi - lo);
    else ctx.fillRect(reverse ? span - hi : lo, a0, hi - lo, COL + 1);
  };
  return {
    duration: 950,
    render(ctx, t) {
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = color;
      const lead = t * (span + JAG) * 1.35; // eating front
      const trail = Math.max(0, (t - 0.42) * (span + JAG) * 1.75); // clearing front
      for (let i = 0; i < cols; i++) {
        const f0 = Math.min(span, Math.max(0, trail - jag2[i] * JAG));
        const f1 = Math.min(span, Math.max(0, lead - jag[i] * JAG));
        if (f1 > f0) rect(ctx, i * COL, f0, f1);
      }
      // crumbs ahead of the eating front
      for (const s of specks) {
        const pos = lead - jag[Math.floor(s.a * (cols - 1))] * JAG + s.lead;
        if (pos < 0 || pos > span) continue;
        const ax = s.a * across;
        ctx.beginPath();
        if (vertical) ctx.arc(ax, reverse ? span - pos : pos, s.r, 0, Math.PI * 2);
        else ctx.arc(reverse ? span - pos : pos, ax, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

const WIPES: Record<string, (ctx: WipeCtx) => Wipe> = {
  sweep,
  melt,
  shatter,
  inkbleed,
  slats,
  dissolve,
  iris,
  erode,
};

export function createWipe(mode: string, ctx: WipeCtx): Wipe {
  return (WIPES[mode] ?? sweep)(ctx);
}

/** Unit vector the outgoing content leaves along, from the camera's travel. */
export function exitDir(travel: Travel): [number, number] {
  return { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] }[travel] as [number, number];
}

export type { Zone };
