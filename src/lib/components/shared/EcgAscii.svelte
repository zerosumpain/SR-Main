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
    steps = undefined,
  }: { rhr?: number; fullbleed?: boolean; steps?: number } = $props();

  // svelte-ignore state_referenced_locally
  let bpm = $state(rhr);
  // Live vitals woven into the heartbeat text. Seeded from /api/biome/state so
  // the characters spell out real numbers, not lorem.
  let recovery = $state<number | null>(null);
  let strain = $state<number | null>(null);
  let town = $state<string | null>(null);
  let temp = $state<number | null>(null);
  let condition = $state<string | null>(null);

  // The narrative whose letters draw the trace: a looping ticker of the current
  // vital signs. commitColumn() consumes it character-by-character in sweep
  // order, so reading the heartbeat left-to-right spells out these stats. Ends
  // with a separator so it wraps seamlessly back to the start.
  function narrativeText(): string {
    const segs: string[] = [`PULSE ${bpm} BPM`];
    if (typeof steps === 'number' && steps > 0) segs.push(`${steps.toLocaleString('en-GB')} STEPS`);
    if (recovery != null && recovery > 0) segs.push(`RECOVERY ${recovery}%`);
    if (strain != null && strain > 0) segs.push(`STRAIN ${strain.toFixed(1)}`);
    const place = [
      town ? town.toUpperCase() : null,
      temp != null ? `${temp}°C` : null,
      condition ? condition.toUpperCase() : null,
    ]
      .filter(Boolean)
      .join(' ');
    if (place) segs.push(place);
    return segs.join(' · ') + ' · ';
  }
  let narrative = $derived(narrativeText());

  // Same live-HR source as the line trace; also pulls the other vitals so the
  // text stays current. Falls back to the prop / last value on failure.
  async function refreshLiveHr() {
    try {
      const res = await fetch('/api/biome/state');
      if (!res.ok) return;
      const state = (await res.json()) as {
        pulse?: number;
        recovery?: number;
        strain?: number;
        town?: string;
        weather?: { temp?: number; condition?: string };
        sources?: { heartRate?: boolean };
      };
      if (state?.sources?.heartRate && typeof state.pulse === 'number' && state.pulse > 0) {
        bpm = Math.max(40, Math.min(220, Math.round(state.pulse)));
      }
      if (typeof state.recovery === 'number') recovery = Math.round(state.recovery);
      if (typeof state.strain === 'number') strain = state.strain;
      if (typeof state.town === 'string') town = state.town;
      if (typeof state.weather?.temp === 'number') temp = Math.round(state.weather.temp);
      if (typeof state.weather?.condition === 'string') condition = state.weather.condition;
    } catch {
      // ignore — keep last values
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

    // Touch / small screens get a lighter render: lower DPR, coarser grid,
    // fewer fps, and no per-glyph shadow blur. The full-bleed canvas at a
    // phone's 2–3× DPR with shadowed text per cell was the source of the jank.
    const lite =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        Math.min(window.innerWidth, window.innerHeight) < 640);

    // Cache code→char so the draw loop never allocates a string per cell/frame.
    const glyphCache: string[] = new Array(256);
    const glyphStr = (code: number) =>
      glyphCache[code] ?? (glyphCache[code] = String.fromCharCode(code));

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
    // first column of a new sweep (pen-up across the wrap); colT drives the fade.
    let colY = new Float32Array(1);
    let colT = new Float64Array(1);
    let colSet = new Uint8Array(1);
    let colGap = new Uint8Array(1);
    // The actual characters: one ASCII code per cell (COLS*ROWS, 0 = empty),
    // indexed col-major as charGrid[col * ROWS + row]. Each cell is picked ONCE
    // when the pen draws it and never changes again — the trail only fades.
    let charGrid = new Uint8Array(1);

    function fontStack(px: number) {
      // 700 weight so the characters read boldly over the cream hero.
      return `700 ${px}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
    }

    function layout() {
      // Cap DPR lower on touch — a full-bleed canvas at 3× is a huge backing
      // store to clear and composite every frame for a faint background trace.
      const dpr = Math.min(lite ? 1.5 : 2, window.devicePixelRatio || 1);
      cssW = Math.max(1, canvasEl.clientWidth);
      cssH = Math.max(1, canvasEl.clientHeight);
      canvasEl.width = Math.round(cssW * dpr);
      canvasEl.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Desktop: small, dense cells — a fine field of characters. Touch: bigger,
      // fewer cells (far lighter to draw, and the vitals read better on a small
      // screen). Fewer cells ⇒ fewer fillText calls per frame.
      fontPx = lite
        ? Math.max(12, Math.min(16, Math.round(cssW / 30)))
        : Math.max(9, Math.min(13, Math.round(cssW / 135)));
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
      charGrid = new Uint8Array(COLS * ROWS);
      lastCol = -1;
      if (cursorCol >= COLS) cursorCol = 0;
    }

    const xMid = (col: number) => col * cellW + cellW / 2;
    const yMid = (row: number) => row * lineH + lineH / 2;
    const clampRow = (r: number) => Math.max(0, Math.min(ROWS - 1, r));
    const ampRows = () => ROWS * 0.34 * ampGain(bpm);

    // Running read-head into the narrative. Each waveform cell consumes the
    // next character, so the trace literally spells out the vitals as it sweeps;
    // it loops the narrative forever. A space is stored as an empty cell, which
    // reads as a word gap along the flat baseline.
    let narrativeIdx = 0;
    function nextGlyph(): number {
      const text = narrative;
      const len = text.length || 1;
      const code = text.charCodeAt(narrativeIdx % len);
      narrativeIdx++;
      return code === 32 ? 0 : code; // 32 = space → blank cell
    }

    // Draw a column ONCE, when the pen first crosses into it: clear any old
    // glyphs there, then fill the waveform cells (the vertical run connecting
    // the previous sample to this one — that's what gives the spike its height)
    // with the next letters of the narrative, top-to-bottom. Stored in charGrid,
    // so a cell never changes after it's drawn; the trail only fades.
    function commitColumn(c: number, yRow: number, wrapped: boolean, t: number) {
      const base = c * ROWS;
      for (let r = 0; r < ROWS; r++) charGrid[base + r] = 0;
      const pc = (c - 1 + COLS) % COLS;
      const linked = !wrapped && !!colSet[pc] && (t - colT[pc]) / LIFETIME < 1;
      const rCur = clampRow(Math.round(yRow));
      const rPrev = linked ? clampRow(Math.round(colY[pc])) : rCur;
      const lo = Math.min(rCur, rPrev);
      const hi = Math.max(rCur, rPrev);
      for (let r = lo; r <= hi; r++) {
        charGrid[base + r] = nextGlyph();
      }
      colY[c] = yRow;
      colT[c] = t;
      colSet[c] = 1;
      colGap[c] = wrapped ? 1 : 0;
    }

    // --- Clocks & beat state -------------------------------------------------
    let cardiac = 0;
    let beatOnset = 0;
    let beatRR = 60 / clampBpm(bpm);
    let beatAmp = 1;
    let cursorCol = 0;
    let clock = 0;
    let headCol = 0;
    let lastCol = -1; // last column committed — each column is committed only once

    let last = performance.now();
    let lastDraw = 0;
    let raf = 0;
    const DRAW_MS = lite ? 50 : 33; // ~20fps on touch, ~30fps on desktop

    function advance(dt: number) {
      const colsPerSec = COLS / SWEEP_SEC;
      const a = ampRows();
      const subSteps = Math.max(1, Math.ceil(dt / 0.004));
      const sub = dt / subSteps;
      for (let s = 0; s < subSteps; s++) {
        cardiac += sub;
        while (cardiac - beatOnset >= beatRR) {
          beatOnset += beatRR;
          beatRR = nextRR(bpm, beatOnset);
          beatAmp = nextAmp();
        }
        cursorCol += colsPerSec * sub;
        let wrapped = false;
        if (cursorCol >= COLS) {
          cursorCol -= COLS;
          wrapped = true;
        }
        const c = Math.min(COLS - 1, Math.floor(cursorCol));
        // Commit a column only the first time the pen enters it, so its
        // characters are fixed once drawn — no re-randomising while the pen
        // lingers, no cycling on later beats.
        if (c !== lastCol || wrapped) {
          const tau = cardiac - beatOnset;
          const sig = complex(tau) * beatAmp + baselineDrift(cardiac);
          const yRow = clampRow(baselineRow - sig * a);
          commitColumn(c, yRow, wrapped, clock - (subSteps - 1 - s) * sub);
          lastCol = c;
          headCol = c;
        }
      }
    }

    function draw() {
      // Context text state (font/align/baseline) is set in layout() and only
      // changes on resize, so it isn't re-set here every frame.
      ctx.clearRect(0, 0, cssW, cssH);

      // Faint scan cursor — the live leading edge of the sweep.
      ctx.globalAlpha = fullbleed ? 0.28 : 0.36;
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(xMid(headCol)) - 1, 0, 2, cssH);

      // The fading phosphor trail. Each column's stored characters are redrawn
      // at the opacity its age maps to; the leading column is hot + brighter.
      // No per-glyph shadowBlur on the trail — blurred text per cell every frame
      // was the mobile bottleneck. Only the single head column gets a light glow,
      // and not on touch at all.
      const headGlow = lite ? 0 : 8;
      ctx.shadowColor = glow;
      for (let c = 0; c < COLS; c++) {
        if (!colSet[c]) continue;
        const age = (clock - colT[c]) / LIFETIME;
        if (age < 0 || age >= 1) continue;
        const band = fadeBand(age);
        if (band <= 0) continue;
        const isHead = c === headCol;
        ctx.globalAlpha = isHead ? 1 : band / FADE_BANDS;
        ctx.fillStyle = isHead ? hot : accent;
        ctx.shadowBlur = isHead ? headGlow : 0;
        const base = c * ROWS;
        for (let r = 0; r < ROWS; r++) {
          const code = charGrid[base + r];
          if (code) ctx.fillText(glyphStr(code), xMid(c), yMid(r));
        }
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
      narrativeIdx = 0; // deterministic text for the static frame
      for (let c = 0; c < COLS; c++) {
        const t = c / colsPerSec;
        const tau = t - Math.floor(t / rr) * rr;
        const sig = complex(tau) + baselineDrift(t);
        commitColumn(c, clampRow(baselineRow - sig * a), c === 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      for (let c = 0; c < COLS; c++) {
        const base = c * ROWS;
        for (let r = 0; r < ROWS; r++) {
          const code = charGrid[base + r];
          if (code) ctx.fillText(String.fromCharCode(code), xMid(c), yMid(r));
        }
      }
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

    // Only animate while the trace is actually on-screen and the tab is visible.
    // On mobile the hero scrolls out of view almost immediately, so gating the
    // rAF on visibility is the single biggest battery/CPU win — and it keeps
    // scrolling smooth because we stop compositing a full-bleed canvas behind
    // the fold. The clock freezes while paused, so it resumes seamlessly.
    let running = false;
    let inView = true;
    let pageVisible = typeof document === 'undefined' || !document.hidden;
    const canRun = () => inView && pageVisible;

    function tick(now: number) {
      if (!canRun()) {
        running = false;
        raf = 0;
        return;
      }
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
    function start() {
      if (running || !canRun()) return;
      running = true;
      last = performance.now(); // reset so the paused gap isn't one huge dt
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        if (inView) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(canvasEl);

    function onVisibility() {
      pageVisible = !document.hidden;
      if (pageVisible) start();
      else stop();
    }
    document.addEventListener('visibilitychange', onVisibility);

    start();
    interval = setInterval(refreshLiveHr, 60_000);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
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
    aria-label="Live heartbeat at {bpm} bpm, drawn in ASCII text spelling out the current vital signs"
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
