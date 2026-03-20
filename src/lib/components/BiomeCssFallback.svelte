<script lang="ts">
  import { onMount } from 'svelte';
  import type { BiomeState, DayPhase } from '$lib/biome/state';
  import { cardiacPulse, windToVector } from '$lib/biome/state';

  let { biomeState }: { biomeState: BiomeState } = $props();

  let canvas: HTMLCanvasElement;
  const PARTICLE_COUNT = 120;

  const DAY_PHASE_HUE: Record<DayPhase, number> = {
    night: 30, dawn: 35, day: 38, dusk: 25,
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
      const hue = DAY_PHASE_HUE[biomeState.dayPhase];
      const sat = Math.round(4 + biomeState.recovery * 0.12);
      const grad = ctx!.createRadialGradient(w / 2, h, 0, w / 2, h, Math.max(w, h));
      grad.addColorStop(0, `hsl(${hue}, ${sat}%, 88%)`);
      grad.addColorStop(1, `hsl(${hue}, ${sat}%, 82%)`);
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, w, h);

      // Particles — multiply blending for warm dark-on-light
      ctx!.globalCompositeOperation = 'multiply';
      const [windX, windY] = windToVector(biomeState.weather.windDirection, biomeState.weather.windSpeed);
      const beat = cardiacPulse(elapsed, biomeState.pulse, 50);
      const recoveryT = biomeState.recovery / 150;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        px[i] += vx[i] + windX * 0.02;
        py[i] += vy[i] + windY * 0.02;

        if (px[i] > w) px[i] = 0;
        if (px[i] < 0) px[i] = w;
        if (py[i] > h) py[i] = 0;
        if (py[i] < 0) py[i] = h;

        const size = 2 + beat * 3;
        const r = Math.round(180 - recoveryT * 40 - beat * 60);
        const g = Math.round(160 - recoveryT * 30 - beat * 50);
        const b = Math.round(130 - recoveryT * 20 - beat * 40);
        const alpha = 0.15 + beat * 0.3;

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
