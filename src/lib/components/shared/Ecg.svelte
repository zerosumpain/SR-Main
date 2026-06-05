<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion, clamp } from '$lib/components/health/v2/utils';

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

  // Fixed "paper speed": seconds for the scan cursor to cross the full width.
  // Real monitors sweep at a constant rate, so beats land where the heart puts
  // them rather than being evenly spaced — that irregular spacing is half of
  // what makes a trace read as a live signal instead of a looping graphic.
  const SWEEP_SEC = 7;
  // Phosphor decay time-constant (seconds). The trail behind the cursor decays
  // as exp(-age/TAU), fading to invisibility over roughly 3·TAU — so a larger
  // TAU is a longer comet tail.
  const TAU = 0.92;
  // Respiration frequency (Hz) ≈ 13 breaths/min. Drives both the baseline
  // wander and the sinus-arrhythmia modulation of heart rate.
  const RESP_HZ = 0.22;

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

  const clampBpm = (v: number) => Math.max(36, Math.min(200, v));

  // PQRST morphology as a sum of Gaussians keyed on seconds-since-beat-onset.
  // Placing the lobes in real time (not as a fraction of the R–R interval)
  // keeps the complex a constant shape while the gap between beats stretches
  // and shrinks with the heart rate — which is how an ECG actually behaves.
  const gauss = (t: number, mu: number, sigma: number) =>
    Math.exp(-((t - mu) * (t - mu)) / (2 * sigma * sigma));
  function complex(tau: number): number {
    return (
      0.10 * gauss(tau, 0.09, 0.021) + // P
      -0.07 * gauss(tau, 0.205, 0.0085) + // Q
      0.95 * gauss(tau, 0.225, 0.0095) + // R
      -0.2 * gauss(tau, 0.25, 0.011) + // S
      0.28 * gauss(tau, 0.36, 0.046) // T
    );
  }
  // Slow, breathing-driven drift of the isoelectric line plus a tiny tremor —
  // the gentle undulation you see on a real lead because the body is moving.
  function baselineDrift(t: number): number {
    return (
      0.05 * Math.sin(2 * Math.PI * RESP_HZ * t + 0.6) +
      0.018 * Math.sin(2 * Math.PI * 0.071 * t) +
      0.006 * Math.sin(2 * Math.PI * 7.3 * t) +
      0.004 * Math.sin(2 * Math.PI * 11.9 * t + 1.3)
    );
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
    const ampPx = () => H * 0.34 * (0.42 + clamp((bpm - 40) / 120, 0, 1) * 0.9);

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
    let prevX = 0;
    let prevY = baseline;
    let last = performance.now();
    let raf = 0;

    // Next beat's interval: mean from current HR, modulated by respiratory
    // sinus arrhythmia (HR rises on inhale, falls on exhale) plus a little
    // uncorrelated jitter — i.e. genuine beat-to-beat variability.
    function nextRR(t: number): number {
      const mean = 60 / clampBpm(bpm);
      const rsa = 0.05 * Math.sin(2 * Math.PI * RESP_HZ * t);
      const jitter = (Math.random() - 0.5) * 0.05;
      return clamp(mean * (1 + rsa + jitter), 0.34, 1.7);
    }
    const nextAmp = () => 1 + (Math.random() - 0.5) * 0.12;

    function tick(now: number) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1; // guard against huge jumps after a tab refocus

      // Phosphor decay: peel a time-proportional slice of alpha off every
      // pixel so the trail fades smoothly and the sweep wrap is seamless.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / TAU)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      const a = ampPx();
      const pxPerSec = W / SWEEP_SEC;

      ctx.strokeStyle = accent;
      ctx.lineWidth = traceW;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = glow;
      ctx.shadowBlur = 7;

      const steps = Math.max(1, Math.ceil(dt / 0.004)); // ~4ms sub-samples
      const sub = dt / steps;
      ctx.beginPath();
      let penDown = false;
      for (let s = 0; s < steps; s++) {
        cardiac += sub;
        while (cardiac - beatOnset >= beatRR) {
          beatOnset += beatRR;
          beatRR = nextRR(beatOnset);
          beatAmp = nextAmp();
        }
        const tau = cardiac - beatOnset;
        const y = baseline - (complex(tau) * beatAmp + baselineDrift(cardiac)) * a;

        cursorX += pxPerSec * sub;
        if (cursorX >= W) {
          // Wrap: lift the pen so no line is drawn back across the screen.
          if (penDown) {
            ctx.stroke();
            penDown = false;
          }
          cursorX -= W;
          prevX = cursorX;
          prevY = y;
          ctx.beginPath();
          continue;
        }
        if (!penDown) {
          ctx.moveTo(prevX, prevY);
          penDown = true;
        }
        ctx.lineTo(cursorX, y);
        prevX = cursorX;
        prevY = y;
      }
      if (penDown) ctx.stroke();

      // Hot leading point — the live pen tip.
      ctx.shadowBlur = 14;
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(prevX, prevY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (cursorEl) cursorEl.style.left = (prevX / W) * 100 + '%';

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
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
</style>
