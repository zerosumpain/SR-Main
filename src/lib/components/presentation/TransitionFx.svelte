<script lang="ts">
  // Transition effects over the stage. Two modes:
  //  - sweep: a directional particle burst travelling with the camera
  //  - melt: particles are born from the OUTGOING content's block rects (the
  //    player captures them just before the switch), sag/melt downward for a
  //    beat, then blow away along the travel direction
  // Short-lived canvas overlay; calls onDone so the player unmounts it.
  // Skipped entirely under prefers-reduced-motion.
  import { onMount } from 'svelte';
  import { TINT_COLORS, type EffectTint, type Zone } from '$lib/presentation/effects';
  import type { Travel } from '$lib/presentation/navigation';

  let {
    mode = 'sweep',
    travel,
    tint = 'accent',
    intensity = 0.5,
    zones = [],
    onDone,
  }: {
    mode?: 'sweep' | 'melt';
    travel: Travel;
    tint?: EffectTint;
    intensity?: number;
    /** Outgoing block rects in stage-relative px (melt spawn areas). */
    zones?: Zone[];
    onDone: () => void;
  } = $props();

  let canvas: HTMLCanvasElement | undefined; // plain render handle

  onMount(() => {
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone();
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onDone();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const w = (canvas.width = cw * dpr);
    const h = (canvas.height = ch * dpr);
    const color = TINT_COLORS[tint] ?? TINT_COLORS.accent;
    const dir = { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] }[travel] as [number, number];

    interface P {
      x: number;
      y: number;
      v: number;
      r: number;
      wob: number;
    }
    let parts: P[];

    if (mode === 'melt') {
      // Spawn inside the outgoing content's rects, density ∝ area.
      const areas = zones.length ? zones : [{ x: cw * 0.1, y: ch * 0.15, w: cw * 0.8, h: ch * 0.6 }];
      const total = Math.round(500 + 500 * intensity);
      const sumArea = areas.reduce((a, z) => a + z.w * z.h, 0) || 1;
      parts = areas.flatMap((z) => {
        const n = Math.max(8, Math.round((total * (z.w * z.h)) / sumArea));
        return Array.from({ length: n }, () => ({
          x: (z.x + Math.random() * z.w) * dpr,
          y: (z.y + Math.random() * z.h) * dpr,
          v: 0.5 + Math.random(),
          r: (0.7 + Math.random() * 1.6) * dpr,
          wob: Math.random() * Math.PI * 2,
        }));
      });
    } else {
      parts = Array.from({ length: Math.round(90 + 160 * intensity) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        v: 0.55 + Math.random(),
        r: (0.6 + Math.random() * 1.8) * dpr,
        wob: Math.random() * Math.PI * 2,
      }));
    }

    const DURATION = mode === 'melt' ? 1050 : 700;
    const MELT_PHASE = 0.28; // first stretch: sag; after: blow away
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = mode === 'melt' ? TINT_COLORS.ink : color;
      const speedBase = (w / 900) * (mode === 'melt' ? 30 : 26);
      const fade = mode === 'melt' ? (t < 0.15 ? t / 0.15 : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1) : t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.globalAlpha = (mode === 'melt' ? 0.75 : 0.5) * fade;
      for (const p of parts) {
        if (mode === 'melt') {
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
        } else {
          p.x += dir[0] * p.v * speedBase * (1 - t * 0.4);
          p.y += dir[1] * p.v * speedBase * (1 - t * 0.4);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r * (dir[0] ? 4 : 1), p.r * (dir[1] ? 4 : 1), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas class="tfx" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .tfx {
    position: absolute;
    inset: 0;
    z-index: 9;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
