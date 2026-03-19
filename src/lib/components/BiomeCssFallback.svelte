<script lang="ts">
  import { onMount } from 'svelte';
  import type { BiomeState, DayPhase } from '$lib/biome/state';
  import { cardiacPulse, windToVector } from '$lib/biome/state';

  let { state }: { state: BiomeState } = $props();

  let canvas: HTMLCanvasElement;
  const PARTICLE_COUNT = 120;

  const DAY_PHASE_HUE: Record<DayPhase, number> = {
    night: 252, dawn: 29, day: 209, dusk: 299,
  };

  // Particle data
  const px = new Float32Array(PARTICLE_COUNT);
  const py = new Float32Array(PARTICLE_COUNT);
  const vx = new Float32Array(PARTICLE_COUNT);
  const vy = new Float32Array(PARTICLE_COUNT);

  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);

    function resize() {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx!.scale(dpr, dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    // Init particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      px[i] = Math.random() * window.innerWidth;
      py[i] = Math.random() * window.innerHeight;
      vx[i] = (Math.random() - 0.5) * 0.5;
      vy[i] = (Math.random() - 0.5) * 0.5;
    }

    let raf: number;
    let elapsed = 0;

    function draw() {
      elapsed += 0.016;
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Background gradient
      const hue = DAY_PHASE_HUE[state.dayPhase];
      const sat = Math.round(state.recovery * 0.6);
      const grad = ctx!.createRadialGradient(w / 2, h, 0, w / 2, h, Math.max(w, h));
      grad.addColorStop(0, `hsl(${hue}, ${sat}%, 12%)`);
      grad.addColorStop(1, `hsl(${hue}, ${sat}%, 4%)`);
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, w, h);

      // Particles
      ctx!.globalCompositeOperation = 'lighter';
      const [windX, windY] = windToVector(state.weather.windDirection, state.weather.windSpeed);
      const beat = cardiacPulse(elapsed, state.pulse, 50);
      const recoveryT = state.recovery / 150;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        px[i] += vx[i] + windX * 0.02;
        py[i] += vy[i] + windY * 0.02;

        if (px[i] > w) px[i] = 0;
        if (px[i] < 0) px[i] = w;
        if (py[i] > h) py[i] = 0;
        if (py[i] < 0) py[i] = h;

        const size = 2 + beat * 3;
        const r = Math.round(64 + recoveryT * 0 + beat * 200);
        const g = Math.round(64 + recoveryT * 140);
        const b = Math.round(64 + recoveryT * 180);
        const alpha = 0.1 + beat * 0.4;

        ctx!.beginPath();
        ctx!.arc(px[i], py[i], size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx!.fill();
      }

      ctx!.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<canvas bind:this={canvas} class="fixed inset-0 z-0 w-full h-full" style="pointer-events: none;"></canvas>
