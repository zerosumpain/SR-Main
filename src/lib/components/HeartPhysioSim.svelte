<script lang="ts">
  import { onMount } from 'svelte';
  import { PhysioHeartSimulation } from '$lib/heart-sim/physio-simulation';

  interface Props {
    bpm?: number;
    particleCount?: number;
    class?: string;
    onstats?: (s: { fps: number; msSolve: number; msRender: number; phase: string; cyclePhi: number; particleCount: number }) => void;
  }

  let { bpm = 70, particleCount = 5000, class: className = '', onstats }: Props = $props();

  let canvas: HTMLCanvasElement;
  let sim: PhysioHeartSimulation | null = null;
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let ro: ResizeObserver | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  function build(count: number) {
    sim?.dispose();
    sim = null;
    error = null;
    try {
      sim = new PhysioHeartSimulation({ canvas, bpm, particleCount: count });
      sim.resize();
      sim.start();
    } catch (e) { error = (e as Error).message; }
  }

  $effect(() => { if (sim) sim.setBpm(bpm); });

  let rebuild: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const c = particleCount;
    if (!mounted) return;
    if (rebuild) clearTimeout(rebuild);
    rebuild = setTimeout(() => build(c), 150);
  });

  onMount(() => {
    build(particleCount);
    mounted = true;
    ro = new ResizeObserver(() => sim?.resize());
    ro.observe(canvas);
    if (onstats) {
      statsTimer = setInterval(() => {
        if (!sim) return;
        const s = sim.getState();
        onstats!({
          fps: s.fps, msSolve: s.msSolve, msRender: s.msRender,
          phase: s.phase, cyclePhi: s.cyclePhi, particleCount: s.particleCount,
        });
      }, 250);
    }
    return () => {
      ro?.disconnect();
      if (statsTimer) clearInterval(statsTimer);
      if (rebuild) clearTimeout(rebuild);
      sim?.dispose();
      sim = null;
    };
  });
</script>

<div class="sim-root {className}">
  <canvas bind:this={canvas}></canvas>
  {#if error}<div class="error">{error}</div>{/if}
</div>

<style>
  .sim-root { position: relative; width: 100%; height: 100%; }
  canvas { display: block; width: 100%; height: 100%; background: transparent; }
  .error { position: absolute; inset: 0; display: grid; place-items: center;
           color: var(--accent, #c4570a); font-family: var(--font-mono, monospace);
           padding: 1rem; text-align: center; }
</style>
