<script lang="ts">
  // Transition particle sweep — plays once over the stage as the camera moves
  // into a slide that carries a transition-role effect block. A short-lived
  // canvas particle burst travelling with the camera; calls onDone so the
  // player can unmount it. Skipped entirely under prefers-reduced-motion.
  import { onMount } from 'svelte';
  import { TINT_COLORS, type EffectTint } from '$lib/presentation/effects';
  import type { Travel } from '$lib/presentation/navigation';

  let {
    travel,
    tint = 'accent',
    intensity = 0.5,
    onDone,
  }: {
    travel: Travel;
    tint?: EffectTint;
    intensity?: number;
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
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    const color = TINT_COLORS[tint] ?? TINT_COLORS.accent;
    const dir = { right: [-1, 0], left: [1, 0], down: [0, -1], up: [0, 1] }[travel] as [number, number];

    const count = Math.round(90 + 160 * intensity);
    const parts = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      v: (0.55 + Math.random()) * (w / 900),
      r: (0.6 + Math.random() * 1.8) * dpr,
    }));

    const DURATION = 700;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const fade = t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5 * fade;
      const speed = 26 * (1 - t * 0.4);
      for (const p of parts) {
        p.x += dir[0] * p.v * speed;
        p.y += dir[1] * p.v * speed;
        ctx.beginPath();
        // streak the particles along the travel axis
        ctx.ellipse(p.x, p.y, p.r * (dir[0] ? 4 : 1), p.r * (dir[1] ? 4 : 1), 0, 0, Math.PI * 2);
        ctx.fill();
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
