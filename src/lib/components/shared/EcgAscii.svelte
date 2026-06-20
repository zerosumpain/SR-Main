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
  }: { rhr?: number; fullbleed?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let bpm = $state(rhr);

  // Same live-HR source as the line trace; fall back to the prop on failure.
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
  const lighten = (rgb: [number, number, number], amt: number): [number, number, number] => [
    Math.min(255, rgb[0] + amt),
    Math.min(255, rgb[1] + amt),
    Math.min(255, rgb[2] + amt),
  ];

  let canvasEl: HTMLCanvasElement;

  onMount(() => {
    refreshLiveHr();

    const ctx0 = canvasEl.getContext('2d');
    if (!ctx0) return;
    const ctx = ctx0;

    const accentRgb = toRgb(readAccent());
    const accent = rgba(accentRgb, 1);
    const glow = rgba(accentRgb, 0.55);
    const hot = rgba(lighten(accentRgb, 80), 1);

    // --- Character-grid layout (recomputed on resize) ------------------------
    // The canvas is sized to its real pixels (DPR-aware) and characters are laid
    // out on a true monospace grid, so glyphs stay square instead of being
    // stretched the way the line buffer is.
    let cssW = 1,
      cssH = 1;
    let COLS = 1,
      ROWS = 1;
    let cellW = 8,
      lineH = 14,
      fontPx = 13;
    let baselineRow = 0;
    // Per-column trace state. colSet marks a column as drawn; colGap marks the
    // first column of a new sweep (pen-up across the wrap).
    let colY = new Float32Array(1);
    let colT = new Float64Array(1);
    let colSet = new Uint8Array(1);
    let colGap = new Uint8Array(1);
    // Density tier (0..3) per column — how far the signal is deflected from the
    // baseline at that point. Picks how bold a character set the column draws.
    let colTier = new Uint8Array(1);

    function fontStack(px: number) {
      // 700 weight so the characters read boldly over the cream hero.
      return `700 ${px}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
    }

    function layout() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = Math.max(1, canvasEl.clientWidth);
      cssH = Math.max(1, canvasEl.clientHeight);
      canvasEl.width = Math.round(cssW * dpr);
      canvasEl.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Larger cells than the line buffer — the trace is made of readable
      // characters now, so bias toward legibility/boldness over fine detail.
      fontPx = Math.max(13, Math.min(19, Math.round(cssW / 82)));
      ctx.font = fontStack(fontPx);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      cellW = ctx.measureText('M').width || fontPx * 0.6;
      lineH = fontPx * 1.05;

      COLS = Math.max(8, Math.floor(cssW / cellW));
      ROWS = Math.max(6, Math.floor(cssH / lineH));
      baselineRow = Math.round(ROWS * 0.56);

      colY = new Float32Array(COLS);
      colT = new Float64Array(COLS);
      colSet = new Uint8Array(COLS);
      colGap = new Uint8Array(COLS);
      colTier = new Uint8Array(COLS);
      if (cursorCol >= COLS) cursorCol = 0;
    }

    const xMid = (col: number) => col * cellW + cellW / 2;
    const yMid = (row: number) => row * lineH + lineH / 2;
    const clampRow = (r: number) => Math.max(0, Math.min(ROWS - 1, r));
    const ampRows = () => ROWS * 0.34 * ampGain(bpm);

    // Density tiers of ASCII characters, faint → bold. The waveform decides
    // WHICH cells light up (so the heartbeat shape is unchanged); these decide
    // the character drawn there — denser symbols where the signal is deflected
    // hardest (the QRS spike), faint specks along the baseline.
    const GLYPHS = [
      ".':,;\"",        // tier 0 — faint baseline specks
      '-+=*~<>i!',      // tier 1 — P / minor deflections
      'ksvjzxct?7',     // tier 2 — T wave / shoulders
      '#@%&$8BMW0NX',   // tier 3 — the bold QRS spike
    ];
    function tierOf(absSig: number): number {
      if (absSig >= 0.5) return 3;
      if (absSig >= 0.22) return 2;
      if (absSig >= 0.09) return 1;
      return 0;
    }
    // Deterministic per (column,row,beat) pick — stable within a heartbeat, then
    // re-shuffled when `beat` ticks, so the whole field of characters cycles on
    // the pulse rather than flickering every frame.
    function glyphFor(col: number, row: number, tier: number, beat: number): string {
      const set = GLYPHS[tier];
      let h = (col * 73856093) ^ (row * 19349663) ^ ((beat + 1) * 83492791);
      h = (h ^ (h >>> 13)) >>> 0;
      return set[h % set.length];
    }

    // Fill the column's waveform cells with random characters from its tier.
    // The vertical run between the previous and current sample keeps the spike
    // connected — now a bold column of cycling glyphs instead of '|' bars.
    function drawColumn(c: number, alpha: number, color: string, beat: number) {
      const yCur = colY[c];
      const pc = (c - 1 + COLS) % COLS;
      const linked = !colGap[c] && colSet[pc] && (clock - colT[pc]) / LIFETIME < 1;
      const yPrev = linked ? colY[pc] : yCur;
      const lo = clampRow(Math.round(Math.min(yCur, yPrev)));
      const hi = clampRow(Math.round(Math.max(yCur, yPrev)));
      const tier = colTier[c];

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      for (let r = lo; r <= hi; r++) {
        ctx.fillText(glyphFor(c, r, tier, beat), xMid(c), yMid(r));
      }
    }

    // --- Clocks & beat state -------------------------------------------------
    let cardiac = 0;
    let beatOnset = 0;
    let beatRR = 60 / clampBpm(bpm);
    let beatAmp = 1;
    let cursorCol = 0;
    let clock = 0;
    let headCol = 0;
    let beatIndex = 0; // increments every heartbeat — the character cycle seed

    let last = performance.now();
    let lastDraw = 0;
    let raf = 0;
    const DRAW_MS = 33; // ~30fps redraw; physics still steps every frame

    function advance(dt: number) {
      const colsPerSec = COLS / SWEEP_SEC;
      const a = ampRows();
      const steps = Math.max(1, Math.ceil(dt / 0.004));
      const sub = dt / steps;
      for (let s = 0; s < steps; s++) {
        cardiac += sub;
        while (cardiac - beatOnset >= beatRR) {
          beatOnset += beatRR;
          beatRR = nextRR(bpm, beatOnset);
          beatAmp = nextAmp();
          beatIndex++; // a new beat — cycle the character field
        }
        const tau = cardiac - beatOnset;
        const sig = complex(tau) * beatAmp + baselineDrift(cardiac);
        const yRow = clampRow(baselineRow - sig * a);
        cursorCol += colsPerSec * sub;
        let wrapped = false;
        if (cursorCol >= COLS) {
          cursorCol -= COLS;
          wrapped = true;
        }
        const c = Math.min(COLS - 1, Math.floor(cursorCol));
        colY[c] = yRow;
        colT[c] = clock - (steps - 1 - s) * sub;
        colSet[c] = 1;
        colGap[c] = wrapped ? 1 : 0;
        colTier[c] = tierOf(Math.abs(sig));
        headCol = c;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = fontStack(fontPx);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Faint scan cursor — the live leading edge of the sweep.
      ctx.globalAlpha = fullbleed ? 0.28 : 0.36;
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(xMid(headCol)) - 1, 0, 2, cssH);

      // The fading phosphor trail, column by column.
      ctx.shadowColor = glow;
      ctx.shadowBlur = 5;
      for (let c = 0; c < COLS; c++) {
        if (!colSet[c] || c === headCol) continue;
        const age = (clock - colT[c]) / LIFETIME;
        if (age < 0 || age >= 1) continue;
        const band = fadeBand(age);
        if (band <= 0) continue;
        drawColumn(c, band / FADE_BANDS, accent, beatIndex);
      }

      // Hot leading character — the live pen tip.
      if (colSet[headCol]) {
        ctx.shadowBlur = 12;
        drawColumn(headCol, 1, hot, beatIndex);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    function drawStatic() {
      // Reduced-motion: one deterministic screen of beats at full opacity.
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = fontStack(fontPx);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const colsPerSec = COLS / SWEEP_SEC;
      const rr = 60 / clampBpm(bpm);
      const a = ampRows();
      for (let c = 0; c < COLS; c++) {
        const t = c / colsPerSec;
        const tau = t - Math.floor(t / rr) * rr;
        const sig = complex(tau) + baselineDrift(t);
        colY[c] = clampRow(baselineRow - sig * a);
        colT[c] = 0;
        colSet[c] = 1;
        colGap[c] = c === 0 ? 1 : 0;
        colTier[c] = tierOf(Math.abs(sig));
      }
      for (let c = 0; c < COLS; c++) drawColumn(c, 1, accent, 0);
      ctx.globalAlpha = 1;
    }

    layout();

    let ro: ResizeObserver | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    if (prefersReducedMotion()) {
      drawStatic();
      ro = new ResizeObserver(() => {
        layout();
        drawStatic();
      });
      ro.observe(canvasEl);
      interval = setInterval(refreshLiveHr, 60_000);
      return () => {
        ro?.disconnect();
        if (interval) clearInterval(interval);
      };
    }

    ro = new ResizeObserver(() => layout());
    ro.observe(canvasEl);

    function tick(now: number) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1; // guard against huge jumps after a tab refocus
      clock += dt;
      advance(dt);
      if (now - lastDraw >= DRAW_MS) {
        lastDraw = now;
        draw();
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    interval = setInterval(refreshLiveHr, 60_000);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (interval) clearInterval(interval);
    };
  });
</script>

<div class="h-ecg-ascii" class:fullbleed>
  <canvas
    class="h-ecg-ascii-canvas"
    bind:this={canvasEl}
    role="img"
    aria-label="Live ECG trace rendered in ASCII at {bpm} bpm"
  ></canvas>
</div>

<style>
  .h-ecg-ascii {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .h-ecg-ascii-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .h-ecg-ascii.fullbleed .h-ecg-ascii-canvas {
    opacity: 0.9;
  }
</style>
