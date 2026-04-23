<script lang="ts">
  import { onMount } from 'svelte';
  import { HeartSimulation } from '$lib/heart-sim/simulation';

  interface Props {
    bpm?: number;
    particleCount?: number;
    class?: string;
    onstats?: (s: { fps: number; msSolve: number; msRender: number; phase: string; particleCount: number }) => void;
  }

  let {
    bpm = 70,
    particleCount = 6000,
    class: className = '',
    onstats,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let sim: HeartSimulation | null = null;
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let ro: ResizeObserver | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  function buildSim(count: number) {
    sim?.dispose();
    sim = null;
    error = null;
    try {
      sim = new HeartSimulation({ canvas, bpm, particleCount: count });
      sim.resize();
      sim.start();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // BPM is live (no rebuild needed).
  $effect(() => {
    if (sim) sim.setBpm(bpm);
  });

  // particleCount triggers a debounced rebuild (allocating new TypedArrays
  // is cheap; we just don't want to rebuild on every slider tick).
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const count = particleCount;
    if (!mounted) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => buildSim(count), 150);
  });

  onMount(() => {
    buildSim(particleCount);
    mounted = true;
    ro = new ResizeObserver(() => sim?.resize());
    ro.observe(canvas);

    if (onstats) {
      statsTimer = setInterval(() => {
        if (!sim) return;
        const s = sim.getState();
        onstats!({
          fps: s.fps,
          msSolve: s.msSolve,
          msRender: s.msRender,
          phase: s.phase,
          particleCount: s.particleCount,
        });
      }, 250);
    }

    return () => {
      ro?.disconnect();
      if (statsTimer) clearInterval(statsTimer);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      sim?.dispose();
      sim = null;
    };
  });
</script>

<div class="sim-root {className}">
  <canvas bind:this={canvas}></canvas>
  {#if error}
    <div class="error">{error}</div>
  {/if}
</div>

<style>
  .sim-root {
    position: relative;
    width: 100%;
    height: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: transparent;
  }
  .error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--accent, #c4570a);
    font-family: var(--font-mono, monospace);
    padding: 1rem;
    text-align: center;
  }
</style>
