<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from './utils';

  let { rhr = 64, fullbleed = true }: { rhr?: number; fullbleed?: boolean } = $props();

  let canvas: HTMLCanvasElement | null = $state(null);

  onMount(() => {
    if (!canvas) return;
    const cv = canvas;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let W = 0;
    let H = 0;
    let raf: number | undefined;

    const N = 90;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0006,
      vy: (Math.random() - 0.5) * 0.0006,
      s: 1 + Math.random() * 2.5,
      h: Math.random(),
    }));

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.scale(dpr, dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const reduced = prefersReducedMotion();
    let t0 = performance.now();

    function loop(now: number) {
      const t = (now - t0) / 1000;
      ctx!.clearRect(0, 0, W, H);
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * (rhr / 60) * Math.PI);
      for (const p of parts) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > 1) p.vx *= -1;
          if (p.y < 0 || p.y > 1) p.vy *= -1;
        }
        const alpha = 0.18 + 0.45 * pulse * (0.5 + p.h * 0.5);
        ctx!.beginPath();
        ctx!.arc(p.x * W, p.y * H, p.s * (1 + pulse * 0.4), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(196,87,10,${alpha.toFixed(3)})`;
        ctx!.fill();
      }
      if (!reduced) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== undefined) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<canvas
  class="h-bio-canvas"
  class:fullbleed
  bind:this={canvas}
  aria-label="Particle biome breathing at {rhr} bpm"
></canvas>

<style>
  .h-bio-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .h-bio-canvas.fullbleed {
    opacity: 0.7;
  }
</style>
