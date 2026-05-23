<script lang="ts">
  import { onMount } from 'svelte';
  import type { ResolvedModel, ID, ZoomLevel } from '../lib/types';
  import { render, hitTest, dragHitTest, type RenderState, metricsFor, xToTime } from '../lib/render';

  interface Props {
    model: ResolvedModel;
    playhead: number;
    zoom: ZoomLevel;
    onHover: (
      hit: { kind: 'strand'; id: ID } | { kind: 'output'; id: ID } | { kind: 'spine' } | null,
      x: number,
      y: number,
    ) => void;
    onDragEdit: (strandId: ID, handle: 'start' | 'merge', newIso: string) => void;
  }

  let { model, playhead, zoom, onHover, onDragEdit }: Props = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let size = $state({ w: 800, h: 380 });
  let hoverId = $state<ID | 'spine' | null>(null);
  let hoverOutputId = $state<ID | null>(null);
  let dpr = $state(1);
  let mounted = $state(false);
  let animTime = $state(0);
  let rafHandle: number | null = null;

  // Drag state
  let dragInfo = $state<{ strandId: ID; handle: 'start' | 'merge' } | null>(null);
  let cursor = $state<'crosshair' | 'grab' | 'grabbing'>('crosshair');

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

  $effect(() => {
    if (!canvas) return;
    const w = size.w;
    const h = size.h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  });

  $effect(() => {
    void model; void playhead; void zoom; void hoverId; void hoverOutputId;
    void size; void dpr; void animTime; void dragInfo;
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
    // Draw drag handles for strands the user might want to move.
    drawDragHandles(ctx, state);
    // If currently dragging, overlay a date label near the cursor.
    if (dragInfo) drawDragPreview(ctx, state);
  }

  function drawDragHandles(ctx: CanvasRenderingContext2D, state: RenderState) {
    const m = metricsFor(state, model);
    ctx.save();
    for (const s of model.strands) {
      if (s.isReference) continue;
      // Start handle (always grabbable).
      const sx = (m.leftX + (s.startMs - m.viewStart) / (m.viewEnd - m.viewStart) * (m.rightX - m.leftX));
      if (sx >= m.leftX - 12 && sx <= m.rightX + 12) {
        const sy = m.centreY; // approximate — actual y at startMs is birthOffset; use approx for handle
        drawHandle(ctx, sx, m.centreY + s.birthOffset * m.yScale, s.colour, dragInfo?.strandId === s.id && dragInfo?.handle === 'start', false);
        void sy;
      }
      // Merge handle (only once strand has appeared in view).
      if (state.playhead >= s.mergeMs) {
        const mx = (m.leftX + (s.mergeMs - m.viewStart) / (m.viewEnd - m.viewStart) * (m.rightX - m.leftX));
        if (mx >= m.leftX - 12 && mx <= m.rightX + 12) {
          drawHandle(ctx, mx, m.centreY, s.colour, dragInfo?.strandId === s.id && dragInfo?.handle === 'merge', true);
        }
      }
    }
    ctx.restore();
  }

  function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string, active: boolean, isMerge: boolean) {
    const r = active ? 6 : 4;
    ctx.save();
    if (active) {
      ctx.fillStyle = colour + 'cc';
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Square handle for merge, round for start — gives a tactile differentiation.
    if (isMerge) {
      ctx.fillStyle = '#f1ead6';
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.8;
      const s = r * 2;
      ctx.fillRect(x - r, y - r, s, s);
      ctx.strokeRect(x - r, y - r, s, s);
    } else {
      ctx.fillStyle = '#f1ead6';
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDragPreview(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (!dragInfo) return;
    const s = model.strands.find((x) => x.id === dragInfo!.strandId);
    if (!s) return;
    const m = metricsFor(state, model);
    const t = dragInfo.handle === 'merge' ? s.mergeMs : s.startMs;
    const x = m.leftX + (t - m.viewStart) / (m.viewEnd - m.viewStart) * (m.rightX - m.leftX);
    const label = new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + (dragInfo.handle === 'merge' ? 'merge' : 'start');
    ctx.save();
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    const w = ctx.measureText(label).width + 14;
    const h = 20;
    const px = Math.max(8, Math.min(state.width - w - 8, x - w / 2));
    const py = 32;
    ctx.fillStyle = s.colour;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#f1ead6';
    ctx.fillText(label, px + 7, py + 14);
    ctx.restore();
  }

  function snapToDay(ms: number): string {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function clampDateMs(ms: number, otherMs: number, isMerge: boolean): number {
    // Keep merge > start by at least 30 days. Keep both within reasonable bounds.
    const minMs = Date.parse('2010-01-01');
    const maxMs = Date.parse('2090-01-01');
    const minGap = 1000 * 60 * 60 * 24 * 30;
    if (isMerge) return Math.max(otherMs + minGap, Math.min(maxMs, ms));
    return Math.max(minMs, Math.min(otherMs - minGap, ms));
  }

  function handlePointerDown(e: PointerEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const state: RenderState = { width: size.w, height: size.h, dpr, playhead, animTime, zoom, hoverId, hoverOutputId };
    const dragHit = dragHitTest(x, y, model, state);
    if (dragHit) {
      dragInfo = dragHit;
      cursor = 'grabbing';
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    // Otherwise treat as hover.
    handleHover(x, y, e.clientX, e.clientY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (dragInfo) {
      const state: RenderState = { width: size.w, height: size.h, dpr, playhead, animTime, zoom, hoverId, hoverOutputId };
      const m = metricsFor(state, model);
      const raw = xToTime(x, m);
      const s = model.strands.find((x) => x.id === dragInfo!.strandId);
      if (!s) return;
      const other = dragInfo.handle === 'merge' ? s.startMs : s.mergeMs;
      const clamped = clampDateMs(raw, other, dragInfo.handle === 'merge');
      onDragEdit(dragInfo.strandId, dragInfo.handle, snapToDay(clamped));
      return;
    }
    // Cursor hint when over a drag handle.
    const state: RenderState = { width: size.w, height: size.h, dpr, playhead, animTime, zoom, hoverId, hoverOutputId };
    const dragHit = dragHitTest(x, y, model, state);
    cursor = dragHit ? 'grab' : 'crosshair';
    handleHover(x, y, e.clientX, e.clientY);
  }

  function handlePointerUp(e: PointerEvent) {
    if (dragInfo) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      dragInfo = null;
      cursor = 'crosshair';
    }
  }

  function handleHover(x: number, y: number, clientX: number, clientY: number) {
    const state: RenderState = { width: size.w, height: size.h, dpr, playhead, animTime, zoom, hoverId, hoverOutputId };
    const hit = hitTest(x, y, model, state);
    const newStrand = hit && hit.kind !== 'output' ? (hit.kind === 'spine' ? 'spine' : hit.id) : null;
    const newOutput = hit && hit.kind === 'output' ? hit.id : null;
    if (newStrand !== hoverId || newOutput !== hoverOutputId) {
      hoverId = newStrand;
      hoverOutputId = newOutput;
    }
    onHover(hit, clientX, clientY);
  }

  function handleLeave() {
    if (dragInfo) return;
    if (hoverId !== null || hoverOutputId !== null) {
      hoverId = null;
      hoverOutputId = null;
      onHover(null, 0, 0);
    }
  }

  /** Exposed so the page can request a PNG dump. */
  export function exportPng(filename = 'data-convergence-scenario.png') {
    if (!canvas || typeof document === 'undefined') return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 0);
    }, 'image/png');
  }
</script>

<div class="wrap" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    style:cursor={cursor}
    onpointermove={handlePointerMove}
    onpointerdown={handlePointerDown}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
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
  }
</style>
