<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ResolvedModel, ID } from '../lib/types';
  import { render, hitTest, type RenderState } from '../lib/render';

  interface Props {
    model: ResolvedModel;
    playhead: number;
    onHover: (id: ID | 'spine' | null, x: number, y: number) => void;
  }

  let { model, playhead, onHover }: Props = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let size = $state({ w: 800, h: 380 });
  let hoverId = $state<ID | 'spine' | null>(null);
  let dpr = $state(1);

  let rafHandle: number | null = null;

  // Resize observer keeps the canvas pixel-perfect on layout changes.
  onMount(() => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        size = { w: Math.max(320, Math.floor(r.width)), h: Math.max(220, Math.floor(r.height)) };
      }
    });
    ro.observe(wrap);

    // Initial size.
    const r = wrap.getBoundingClientRect();
    size = { w: Math.max(320, Math.floor(r.width)), h: Math.max(220, Math.floor(r.height)) };

    // Frame loop — request on relevant changes via $effect below.
    return () => {
      ro.disconnect();
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  });

  // Configure canvas backing pixels whenever size/DPR change.
  $effect(() => {
    if (!canvas) return;
    const w = size.w;
    const h = size.h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    scheduleDraw();
  });

  // Redraw when these change.
  $effect(() => {
    // Touch reactive deps:
    void model;
    void playhead;
    void hoverId;
    void size;
    void dpr;
    scheduleDraw();
  });

  function scheduleDraw() {
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      draw();
    });
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state: RenderState = {
      width: size.w,
      height: size.h,
      dpr,
      playhead,
      hoverId,
      showWaveSamples: false,
    };
    render(ctx, model, state);
  }

  function handlePointer(e: PointerEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const state: RenderState = {
      width: size.w,
      height: size.h,
      dpr,
      playhead,
      hoverId,
      showWaveSamples: false,
    };
    const id = hitTest(x, y, model, state);
    if (id !== hoverId) {
      hoverId = id;
      onHover(id, e.clientX, e.clientY);
    } else if (id !== null) {
      // Update tooltip position even if id didn't change.
      onHover(id, e.clientX, e.clientY);
    }
  }

  function handleLeave() {
    if (hoverId !== null) {
      hoverId = null;
      onHover(null, 0, 0);
    }
  }

  function handleTap(e: PointerEvent) {
    // On touch, the move event might not fire before tap-end; force a hit-test
    // at the tap position.
    handlePointer(e);
  }
</script>

<div class="wrap" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    onpointermove={handlePointer}
    onpointerdown={handleTap}
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
