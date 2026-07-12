<script lang="ts">
  // Transition overlay — a short-lived canvas driving one wipe renderer from
  // $lib/presentation/wipes.ts: the generic directional sweep (background
  // effects with role transition) or a named wipe (melt, shatter, inkbleed,
  // slats, dissolve). Calls onDone so the player unmounts it. Skipped
  // entirely under prefers-reduced-motion.
  import { onMount } from 'svelte';
  import { TINT_COLORS, type EffectTint, type Zone } from '$lib/presentation/effects';
  import { createWipe, exitDir } from '$lib/presentation/wipes';
  import type { Travel } from '$lib/presentation/navigation';

  let {
    mode = 'sweep',
    travel,
    tint = 'accent',
    intensity = 0.5,
    zones = [],
    onDone,
  }: {
    mode?: string;
    travel: Travel;
    tint?: EffectTint;
    intensity?: number;
    /** Outgoing block rects in stage-relative px (melt/shatter spawn areas). */
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

    const wipe = createWipe(mode, {
      w,
      h,
      cw,
      ch,
      dpr,
      travel,
      dir: exitDir(travel),
      intensity,
      color: TINT_COLORS[tint] ?? TINT_COLORS.accent,
      zones,
    });

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // rAF timestamps can precede the performance.now() taken at mount —
      // clamp both ends or the first frame renders with a negative t.
      const t = Math.min(1, Math.max(0, (now - start) / wipe.duration));
      ctx.clearRect(0, 0, w, h);
      wipe.render(ctx, t, now);
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
