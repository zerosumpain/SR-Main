<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from '$lib/components/health/v2/utils';
  import {
    SWEEP_SEC,
    LIFETIME,
    complex,
    baselineDrift,
    clampBpm,
    ampGain,
    nextRR,
    nextAmp,
    fadeBand,
    FADE_BANDS,
  } from './ecg-signal';

  let {
    rhr = 64,
    fullbleed = true,
    showGrid = true,
  }: { rhr?: number; fullbleed?: boolean; showGrid?: boolean } = $props();

  // Logical render buffer. CSS stretches it to fill the parent, exactly like
  // the old SVG's preserveAspectRatio="none" — so all the drawing maths can
  // stay in this fixed space regardless of how tall the hero is.
  const W = 1200;
  const H = 320;
  const baseline = H * 0.56;

  // Paper speed, phosphor lifetime, PQRST morphology and beat-to-beat
  // variability all live in the shared signal model (./ecg-signal) so the ASCII
  // pen renders an identical trace.

  // svelte-ignore state_referenced_locally
  let bpm = $state(rhr);

  // Static grid (drawn as its own SVG layer so the phosphor fade can't erase
  // it). Only rendered when showGrid is set.
  const grid: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
  for (let x = 0; x <= W; x += 24)
    grid.push({ key: 'gx' + x, x1: x, y1: 0, x2: x, y2: H, major: x % 120 === 0 });
  for (let y = 0; y <= H; y += 24)
    grid.push({ key: 'gy' + y, x1: 0, y1: y, x2: W, y2: y, major: y % 120 === 0 });

  // Pull the same live-HR source the homepage biome uses; fall back to the
  // prop value if the call fails or returns no pulse.
  async function refreshLiveHr() {
    try {
      const res = await fetch('/api/biome/state');
      if (!res.ok) return;
      const state = (await res.json()) as { pulse?: number; sources?: { heartRate?: boolean } };
      if (state?.sources?.heartRate && typeof state.pulse === 'number' && state.pulse > 0) {
        bpm = Math.max(40, Math.min(220, Math.round(state.pulse)));
      }
    } catch {
      // ignore — keep last bpm
    }
  }

  function readAccent(): string {
    if (typeof window === 'undefined') return '#c4570a';
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '#c4570a';
  }
  function toRgb(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (rgb: [number, number, number], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const lighten = (rgb: [number, number, number], amt: number): [number, number, number] =>
    [Math.min(255, rgb[0] + amt), Math.min(255, rgb[1] + amt), Math.min(255, rgb[2] + amt)];

  let canvasEl: HTMLCanvasElement;
  let cursorEl: HTMLDivElement | undefined;

  onMount(() => {
    refreshLiveHr();

    const ctx0 = canvasEl.getContext('2d');
    if (!ctx0) return;
    // Non-null alias: TS doesn't carry the `!ctx0` narrowing into the rAF
    // closure, but a const of the already-narrowed type keeps it non-null.
    const ctx = ctx0;
    canvasEl.width = W;
    canvasEl.height = H;

    const accentRgb = toRgb(readAccent());
    const accent = rgba(accentRgb, 1);
    const glow = rgba(accentRgb, 0.6);
    const hot = rgba(lighten(accentRgb, 70), 1);

    const traceW = fullbleed ? 2.4 : 2;
    const dotR = fullbleed ? 3.2 : 2.6;

    // Amplitude gain tracks heart rate: a resting heart shows a modest R
    // spike, a working one a taller, emphatic one (0.42x at rest → ~1.3x flat
    // out across 40–160 bpm). Returns pixels of full-scale deflection.
    const ampPx = () => H * 0.34 * ampGain(bpm);

    let interval: ReturnType<typeof setInterval> | undefined;

    if (prefersReducedMotion()) {
      // Static strip: one screen of beats at full opacity, deterministic.
      if (cursorEl) cursorEl.style.display = 'none';
      const pxPerSec = W / SWEEP_SEC;
      const rr = 60 / clampBpm(bpm);
      const a = ampPx();
      ctx.strokeStyle = accent;
      ctx.lineWidth = traceW;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const t = x / pxPerSec;
        const tau = t - Math.floor(t / rr) * rr;
        const y = baseline - (complex(tau) + baselineDrift(t)) * a;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      interval = setInterval(refreshLiveHr, 60_000);
      return () => interval && clearInterval(interval);
    }

    // Animated phosphor sweep -------------------------------------------------
    let cardiac = 0; // monotonic cardiac clock (seconds)
    let beatOnset = 0; // onset of the beat currently under the pen
    let beatRR = 60 / clampBpm(bpm); // its R–R interval
    let beatAmp = 1; // its per-beat amplitude scale
    let cursorX = 0;
    let clock = 0; // monotonic wall clock (seconds) — drives point ageing
    // Time-stamped trail. Redrawn from scratch each frame and pruned to
    // LIFETIME, so the fade reaches exactly zero — nothing lingers. `gap`
    // marks the first point of a new sweep (pen-up across the wrap).
    const trail: Array<{ x: number; y: number; t: number; gap: boolean }> = [];
    let last = performance.now();
    let raf = 0;

    // Age → opacity band, via the shared quadratic fade.
    const bandOf = (t: number) => fadeBand((clock - t) / LIFETIME);

    function tick(now: number) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1; // guard against huge jumps after a tab refocus
      clock += dt;

      const a = ampPx();
      const pxPerSec = W / SWEEP_SEC;

      // Advance the signal and append time-stamped points to the trail.
      const steps = Math.max(1, Math.ceil(dt / 0.004)); // ~4ms sub-samples
      const sub = dt / steps;
      for (let s = 0; s < steps; s++) {
        cardiac += sub;
        while (cardiac - beatOnset >= beatRR) {
          beatOnset += beatRR;
          beatRR = nextRR(bpm, beatOnset);
          beatAmp = nextAmp();
        }
        const tau = cardiac - beatOnset;
        const y = baseline - (complex(tau) * beatAmp + baselineDrift(cardiac)) * a;
        cursorX += pxPerSec * sub;
        let gap = false;
        if (cursorX >= W) {
          cursorX -= W;
          gap = true; // pen-up across the sweep wrap
        }
        trail.push({ x: cursorX, y, t: clock - (steps - 1 - s) * sub, gap });
      }

      // Drop points that have aged past their lifetime — these are simply gone.
      const cutoff = clock - LIFETIME;
      let drop = 0;
      while (drop < trail.length && trail[drop].t < cutoff) drop++;
      if (drop > 0) trail.splice(0, drop);

      // Redraw the whole trail, fading each point by its age. Consecutive
      // same-opacity segments are batched into one stroke so the gradient
      // (and its glow) stays cheap.
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = accent;
      ctx.lineWidth = traceW;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = glow;
      ctx.shadowBlur = fullbleed ? 6 : 5;

      let k = 1;
      while (k < trail.length) {
        if (trail[k].gap) {
          k++; // don't connect across a wrap
          continue;
        }
        const band = bandOf(trail[k].t);
        if (band <= 0) {
          k++;
          continue;
        }
        ctx.globalAlpha = band / FADE_BANDS;
        ctx.beginPath();
        ctx.moveTo(trail[k - 1].x, trail[k - 1].y);
        ctx.lineTo(trail[k].x, trail[k].y);
        let j = k + 1;
        while (j < trail.length && !trail[j].gap && bandOf(trail[j].t) === band) {
          ctx.lineTo(trail[j].x, trail[j].y);
          j++;
        }
        ctx.stroke();
        k = j;
      }
      ctx.globalAlpha = 1;

      // Hot leading point — the live pen tip.
      const head = trail[trail.length - 1];
      if (head) {
        ctx.shadowBlur = 14;
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(head.x, head.y, dotR, 0, Math.PI * 2);
        ctx.fill();
        if (cursorEl) cursorEl.style.left = (head.x / W) * 100 + '%';
      }
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    interval = setInterval(refreshLiveHr, 60_000);

    return () => {
      cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
    };
  });
</script>

<div class="h-ecg" class:fullbleed>
  {#if showGrid}
    <svg class="h-ecg-grid" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
      {#each grid as g (g.key)}
        <line class:major={g.major} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
      {/each}
    </svg>
  {/if}
  <canvas
    class="h-ecg-canvas"
    bind:this={canvasEl}
    role="img"
    aria-label="Live ECG trace at {bpm} bpm"
  ></canvas>
  <div class="h-ecg-scan" bind:this={cursorEl} aria-hidden="true"></div>
</div>
{#if !fullbleed}
  <div class="h-ecg-bpm-readout">
    <p class="h-ecg-bpm-num">{bpm}</p>
    <p class="h-ecg-bpm-lbl">BPM · LIVE</p>
  </div>
{/if}

<style>
  .h-ecg {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .h-ecg-grid,
  .h-ecg-canvas,
  .h-ecg-scan {
    position: absolute;
    inset: 0;
  }
  .h-ecg-grid,
  .h-ecg-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .h-ecg.fullbleed .h-ecg-canvas {
    opacity: 0.55;
  }
  .h-ecg-grid line {
    stroke: rgba(26, 16, 8, 0.06);
    stroke-width: 1;
  }
  .h-ecg-grid line.major {
    stroke: rgba(26, 16, 8, 0.1);
  }
  /* The scan cursor — the live leading edge of the sweep. */
  .h-ecg-scan {
    left: 0;
    width: 2px;
    height: 100%;
    background: linear-gradient(
      to bottom,
      transparent,
      var(--accent) 20%,
      var(--accent) 80%,
      transparent
    );
    box-shadow: 0 0 12px 2px rgba(196, 87, 10, 0.45);
    opacity: 0.38;
    transform: translateX(-1px);
    pointer-events: none;
    will-change: left;
  }
  .h-ecg.fullbleed .h-ecg-scan {
    opacity: 0.3;
  }
  .h-ecg-bpm-readout {
    position: absolute;
    top: 24px;
    right: 32px;
    text-align: right;
    pointer-events: none;
  }
  .h-ecg-bpm-num {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 44px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--accent);
    opacity: 0.85;
  }
  .h-ecg-bpm-lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
</style>
