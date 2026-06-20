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
  let cursorEl: HTMLDivElement;

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
    // Per-column trace state. colSet marks a column as drawn; colT drives the
    // linking of adjacent samples; colPx is the glyph size for that column.
    let colY = new Float32Array(1);
    let colT = new Float64Array(1);
    let colSet = new Uint8Array(1);
    // Per-column glyph size in px — bigger where the signal deflects hardest, so
    // the QRS peaks render in larger characters than the flat baseline.
    let colPx = new Uint8Array(1);
    // The actual characters: one ASCII code per cell (COLS*ROWS, 0 = empty),
    // indexed col-major as charGrid[col * ROWS + row]. Each cell is picked ONCE
    // when the pen draws it and never changes again — the trail only fades.
    let charGrid = new Uint8Array(1);

    // Columns committed since the last draw — the incremental renderer paints
    // only these each frame, then fades the rest of the canvas (see draw()).
    const pendingCols: number[] = [];
    // Cache font strings by pixel size so per-column sizing never re-parses.
    const fontByPx = new Map<number, string>();
    const pxFont = (px: number) => {
      let f = fontByPx.get(px);
      if (!f) {
        f = fontStack(px);
        fontByPx.set(px, f);
      }
      return f;
    };
    // Per-frame phosphor decay (destination-out wipe). Recomputed in layout().
    let fadeWipe = 'rgba(0,0,0,0.1)';

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
      colPx = new Uint8Array(COLS);
      charGrid = new Uint8Array(COLS * ROWS);
      pendingCols.length = 0;
      lastCol = -1;
      if (cursorCol >= COLS) cursorCol = 0;

      // Calibrate the per-frame alpha knock-down so a glyph fades to ~4% over
      // one LIFETIME at the current redraw cadence (exponential phosphor decay).
      const decayFrames = (LIFETIME * 1000) / DRAW_MS;
      fadeWipe = `rgba(0,0,0,${(1 - Math.pow(0.04, 1 / decayFrames)).toFixed(3)})`;
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
    function commitColumn(c: number, yRow: number, sig: number, wrapped: boolean, t: number) {
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
      // Glyph size shrinks with the deflection magnitude: the flat baseline stays
      // at the base size, and the harder the signal deflects the SMALLER the
      // characters get — so the QRS peaks resolve into fine, distinct glyphs
      // instead of a big overlapping blob. That finer grain is the peak fidelity.
      // Floored so the peak text stays legible.
      const defl = Math.min(1, Math.abs(sig)); // 0 on the flat baseline … 1 at the R peak
      colPx[c] = Math.max(lite ? 9 : 7, Math.round(fontPx * (1 - defl * 0.45)));
      colY[c] = yRow;
      colT[c] = t;
      colSet[c] = 1;
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
          commitColumn(c, yRow, sig, wrapped, clock - (subSteps - 1 - s) * sub);
          lastCol = c;
          headCol = c;
          pendingCols.push(c);
        }
      }
    }

    function draw() {
      // Phosphor decay: knock down the alpha of everything already on the canvas
      // toward transparent — one fillRect, O(1) — instead of clearing and
      // redrawing the whole trail every frame. THIS is the performance fix: the
      // per-frame cost is now ~O(new columns), not O(every lit cell).
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = fadeWipe;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalCompositeOperation = 'source-over';

      // Paint only the columns committed since the last frame. Each is sized by
      // its deflection (colPx), so peaks resolve into fine small characters; the
      // newest column is the hot leading edge, the rest fade behind it.
      if (pendingCols.length) {
        ctx.shadowColor = glow;
        const headGlow = lite ? 0 : 8;
        for (let i = 0; i < pendingCols.length; i++) {
          const c = pendingCols[i];
          const isHead = c === headCol;
          ctx.font = pxFont(colPx[c]);
          ctx.fillStyle = isHead ? hot : accent;
          ctx.shadowBlur = isHead ? headGlow : 0;
          const base = c * ROWS;
          for (let r = 0; r < ROWS; r++) {
            const code = charGrid[base + r];
            if (code) ctx.fillText(glyphStr(code), xMid(c), yMid(r));
          }
        }
        ctx.shadowBlur = 0;
        pendingCols.length = 0;
      }

      // Scan cursor — a cheap moved overlay rather than a per-frame full-height
      // fill, so it doesn't streak under the destination-out fade.
      if (cursorEl) cursorEl.style.transform = `translateX(${Math.round(xMid(headCol))}px)`;
    }

    function drawStatic() {
      // Reduced-motion: one deterministic screen of beats at full opacity.
      ctx.clearRect(0, 0, cssW, cssH);
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
        commitColumn(c, clampRow(baselineRow - sig * a), sig, c === 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      for (let c = 0; c < COLS; c++) {
        const base = c * ROWS;
        ctx.font = pxFont(colPx[c]);
        for (let r = 0; r < ROWS; r++) {
          const code = charGrid[base + r];
          if (code) ctx.fillText(glyphStr(code), xMid(c), yMid(r));
        }
      }
    }

    layout();

    let ro: ResizeObserver | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    if (prefersReducedMotion()) {
      if (cursorEl) cursorEl.style.display = 'none'; // no live sweep ⇒ no cursor
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
  <div class="h-ecg-ascii-cursor" bind:this={cursorEl} aria-hidden="true"></div>
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
  /* Live sweep cursor — moved via transform from the draw loop (cheap, GPU
     composited) instead of being re-filled into the canvas every frame. */
  .h-ecg-ascii-cursor {
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: var(--accent, #c4570a);
    opacity: 0.22;
    pointer-events: none;
    will-change: transform;
  }
</style>
