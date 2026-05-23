<script lang="ts">
  import { onMount } from 'svelte';
  import type { ResolvedModel, ID, ZoomLevel } from '../lib/types';
  import { render, hitTest, type RenderState } from '../lib/render';

  interface Props {
    model: ResolvedModel;
    playhead: number;
    zoom: ZoomLevel;
    onHover: (
      hit: { kind: 'strand'; id: ID } | { kind: 'output'; id: ID } | { kind: 'spine' } | null,
      x: number,
      y: number,
    ) => void;
  }

  let { model, playhead, zoom, onHover }: Props = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let size = $state({ w: 800, h: 380 });
  let hoverId = $state<ID | 'spine' | null>(null);
  let hoverOutputId = $state<ID | null>(null);
  let dpr = $state(1);
  let mounted = $state(false);
  let animTime = $state(0);
  let rafHandle: number | null = null;

  onMount(() => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        size = { w: Math.max(320, Math.floor(r.width)), h: Math.max(220, Math.floor(r.height)) };
      }
    });
    ro.observe(wrap);
    const r = wrap.getBoundingClientRect();
    size = { w: Math.max(320, Math.floor(r.width)), h: Math.max(220, Math.floor(r.height)) };
    mounted = true;

    // Continuous animation loop — the spine bar is alive even when paused.
    let start = performance.now();
    function tick(ts: number) {
      animTime = ts - start;
      rafHandle = requestAnimationFrame(tick);
    }
    rafHandle = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  });

  // Configure canvas backing pixels.
  $effect(() => {
    if (!canvas) return;
    const w = size.w;
    const h = size.h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  });

  // Redraw on every reactive change OR on animTime (so spine bar moves continuously).
  $effect(() => {
    void model; void playhead; void zoom; void hoverId; void hoverOutputId; void size; void dpr; void animTime;
    if (!mounted) return;
    draw();
  });

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state: RenderState = {
      width: size.w, height: size.h, dpr,
      playhead, animTime, zoom,
      hoverId, hoverOutputId,
    };
    render(ctx, model, state);
  }

  function handlePointer(e: PointerEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const state: RenderState = {
      width: size.w, height: size.h, dpr,
      playhead, animTime, zoom,
      hoverId, hoverOutputId,
    };
    const hit = hitTest(x, y, model, state);
    const newStrand = hit && hit.kind !== 'output' ? (hit.kind === 'spine' ? 'spine' : hit.id) : null;
    const newOutput = hit && hit.kind === 'output' ? hit.id : null;
    if (newStrand !== hoverId || newOutput !== hoverOutputId) {
      hoverId = newStrand;
      hoverOutputId = newOutput;
    }
    onHover(hit, e.clientX, e.clientY);
  }

  function handleLeave() {
    if (hoverId !== null || hoverOutputId !== null) {
      hoverId = null;
      hoverOutputId = null;
      onHover(null, 0, 0);
    }
  }
</script>

<div class="wrap" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    onpointermove={handlePointer}
    onpointerdown={handlePointer}
    onpointerleave={handleLeave}
  ></canvas>
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 240px;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: pan-y;
    cursor: crosshair;
  }
</style>
