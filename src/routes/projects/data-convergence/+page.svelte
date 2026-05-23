<script lang="ts">
  import { onMount } from 'svelte';
  import Visualization from './components/Visualization.svelte';
  import ConfigTable from './components/ConfigTable.svelte';
  import Controls from './components/Controls.svelte';
  import Legend from './components/Legend.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import { resolveModel } from './lib/strands';
  import { DEFAULT_CONFIG } from './lib/defaults';
  import {
    loadConfig,
    saveConfig,
    clearConfig,
    validateConfig,
    serialiseConfig,
    downloadJSON,
  } from './lib/storage';
  import type { StrandConfig, ID } from './lib/types';

  // --- Config (the source of truth) ---
  let config = $state<StrandConfig[]>(DEFAULT_CONFIG);
  let model = $derived(resolveModel(config));

  // --- Playback state ---
  // Seed playhead at the *end* of the default timeline so the first paint shows
  // the fully wound rope — the conceptual punchline. Pressing play rewinds and
  // re-animates the convergence. The clamp $effect below keeps playhead in
  // range when the config changes underneath.
  const INITIAL_PLAYHEAD = Math.max(
    ...DEFAULT_CONFIG.map((s) => Date.parse(s.mergeDate)).filter((n) => Number.isFinite(n)),
  );
  let playhead = $state(INITIAL_PLAYHEAD);
  let playing = $state(false);
  let speed = $state(1);

  // --- UI state ---
  let hoverId = $state<ID | 'spine' | null>(null);
  let tipX = $state(0);
  let tipY = $state(0);
  let panelOpen = $state(false);
  let importError = $state<string | null>(null);
  let portrait = $state(false);
  let mounted = $state(false);

  // Load persisted config on mount.
  onMount(() => {
    const saved = loadConfig();
    if (saved && saved.length > 0) {
      config = saved;
      // Land playhead at this saved config's tEnd — same "show the finished
      // rope" intent as INITIAL_PLAYHEAD, but recomputed for the loaded data.
      const m = resolveModel(saved);
      playhead = m.tEnd;
    }
    mounted = true;

    // Dev/debug helper — `#t=0.5` seeks to halfway. Used by automated screenshots.
    const hash = window.location.hash;
    const hashMatch = hash.match(/t=([0-9.]+)/);
    if (hashMatch) {
      const ratio = Math.max(0, Math.min(1, parseFloat(hashMatch[1])));
      const m = resolveModel(config);
      playhead = m.tStart + ratio * (m.tEnd - m.tStart);
    }
    if (hash.includes('panel')) panelOpen = true;

    // Watch orientation for the rotate hint.
    const mq = window.matchMedia('(orientation: portrait)');
    portrait = mq.matches;
    const onChange = () => (portrait = mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // Persist whenever config changes (after mount).
  $effect(() => {
    if (!mounted) return;
    saveConfig(config);
  });

  // Keep playhead in range when model bounds shift.
  $effect(() => {
    const tStart = model.tStart;
    const tEnd = model.tEnd;
    if (playhead < tStart) playhead = tStart;
    if (playhead > tEnd) playhead = tEnd;
  });

  // --- Playback loop ---
  // Real-time millis per second of playback at speed=1: span the visible range
  // over ~30 seconds, modulated by `speed`.
  let lastTs: number | null = null;
  let rafHandle: number | null = null;

  function togglePlay(next: boolean) {
    // If asked to play but we're already at the end, rewind first.
    if (next && playhead >= model.tEnd - 1) {
      playhead = model.tStart;
    }
    playing = next;
  }

  $effect(() => {
    if (playing && rafHandle === null) {
      lastTs = null;
      rafHandle = requestAnimationFrame(loop);
    }
    if (!playing && rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  });

  function loop(ts: number) {
    if (!playing) {
      rafHandle = null;
      return;
    }
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    const span = Math.max(1, model.tEnd - model.tStart);
    const baseSeconds = 28;
    const delta = (span / baseSeconds) * speed * dt;
    playhead = Math.min(model.tEnd, playhead + delta);
    if (playhead >= model.tEnd) {
      playing = false;
      rafHandle = null;
      return;
    }
    rafHandle = requestAnimationFrame(loop);
  }

  function handleHover(id: ID | 'spine' | null, x: number, y: number) {
    hoverId = id;
    tipX = x;
    tipY = y;
  }

  function handleLegendHover(id: ID | null) {
    hoverId = id;
  }

  // --- Import / Export ---
  async function importJsonText(text: string) {
    importError = null;
    try {
      const parsed = JSON.parse(text);
      const validated = validateConfig(parsed);
      if (!validated) throw new Error('Not a strand-config array.');
      if (validated.length === 0) throw new Error('Empty config — nothing to import.');
      config = validated;
    } catch (err) {
      importError = err instanceof Error ? err.message : 'Failed to parse JSON.';
    }
  }
  async function pickJsonFile() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const text = await f.text();
      importJsonText(text);
    };
    input.click();
  }
  function exportJson() {
    const text = serialiseConfig(config);
    downloadJSON('data-convergence-config.json', text);
  }
  function copyJson() {
    const text = serialiseConfig(config);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }
  function resetToDefaults() {
    clearConfig();
    config = DEFAULT_CONFIG;
  }
</script>

<svelte:head>
  <title>The Spine — Data Convergence Timeline</title>
  <meta name="description" content="An interactive visualisation of how scattered data sources gradually wind together into a single source of truth." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
  />
</svelte:head>

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>

  <header class="head">
    <div class="head-l">
      <span class="tagline">FIELD STUDY №1</span>
      <h1>The Spine</h1>
      <p class="sub">
        Scattered data sources are tributaries. Watch them wind together — strand into
        strand, confluence into confluence — until everything becomes one rope.
      </p>
    </div>
    <div class="head-r">
      <div class="io">
        <button class="link" type="button" onclick={exportJson}>Export JSON</button>
        <button class="link" type="button" onclick={copyJson}>Copy</button>
        <button class="link" type="button" onclick={pickJsonFile}>Import</button>
        <button class="link" type="button" onclick={resetToDefaults}>Reset</button>
      </div>
      <button
        class="panel-toggle"
        type="button"
        onclick={() => (panelOpen = !panelOpen)}
        aria-expanded={panelOpen}
      >
        {panelOpen ? 'Close ✕' : 'Edit sources →'}
      </button>
    </div>
  </header>

  {#if importError}
    <div class="import-error" role="alert">Couldn't import: {importError}</div>
  {/if}

  <section class="viz-shell">
    <Visualization {model} {playhead} onHover={handleHover} />
    {#if portrait}
      <div class="rotate-hint" aria-hidden="true">
        <span class="icon">↻</span>
        <span>Rotate for the best view</span>
      </div>
    {/if}
  </section>

  <Controls
    {model}
    {playhead}
    {playing}
    {speed}
    onChange={(next) => {
      if (next.playhead !== undefined) playhead = next.playhead;
      if (next.playing !== undefined) togglePlay(next.playing);
      if (next.speed !== undefined) speed = next.speed;
    }}
  />

  <section class="legend-shell">
    <Legend {model} {hoverId} onHover={handleLegendHover} />
  </section>

  <Tooltip {model} {hoverId} x={tipX} y={tipY} />

  <aside class="panel" class:open={panelOpen} aria-hidden={!panelOpen}>
    <div class="panel-inner">
      <ConfigTable {config} {model} onChange={(next) => (config = next)} />
    </div>
  </aside>

  {#if panelOpen}
    <div class="panel-backdrop" onclick={() => (panelOpen = false)} aria-hidden="true"></div>
  {/if}

  <footer class="foot">
    <span>
      Designed and built for John. A standalone exhibit at
      <code>/projects/data-convergence</code>.
    </span>
  </footer>
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
  }
  /* Scope the look of this page only — no global side effects. */
  .page {
    --paper: #f1ead6;
    --paper-deep: #e7decc;
    --ink: #1c1611;
    --ink-soft: rgba(28, 22, 17, 0.62);
    --rust: #b95431;
    --moss: #6a8f4f;
    --indigo: #4a6b8a;

    position: fixed;
    inset: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;
    overflow: hidden;
    /* Provide a faint vignette to anchor the composition. */
    background:
      radial-gradient(ellipse 90% 60% at 50% 45%, rgba(255, 255, 255, 0.35), transparent 70%),
      var(--paper);
  }

  .paper-grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.55;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.08 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  /* Header */
  .head {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: 22px 28px 12px;
    gap: 24px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.08);
  }
  .head-l { max-width: 60ch; min-width: 0; }
  .tagline {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.22em;
    color: var(--ink-soft);
    text-transform: uppercase;
  }
  h1 {
    font-family: 'Fraunces', 'Times New Roman', serif;
    font-weight: 500;
    font-size: clamp(28px, 5vw, 52px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 4px 0 6px;
    font-feature-settings: 'ss01' on;
  }
  .sub {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--ink-soft);
    max-width: 56ch;
  }
  .head-r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .io {
    display: flex;
    gap: 4px;
  }
  .link {
    background: transparent;
    border: none;
    border-bottom: 1px dashed rgba(28, 22, 17, 0.4);
    padding: 2px 6px;
    color: var(--ink);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .link:hover { background: rgba(28, 22, 17, 0.05); }
  .panel-toggle {
    background: var(--ink);
    color: var(--paper);
    border: none;
    padding: 8px 14px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    cursor: pointer;
    text-transform: uppercase;
  }
  .panel-toggle:hover { background: #2c241c; }

  .import-error {
    position: relative;
    z-index: 1;
    background: rgba(177, 60, 48, 0.1);
    color: #8a2d22;
    border-left: 3px solid #b13c30;
    font-size: 12.5px;
    padding: 8px 14px;
  }

  /* Visualisation */
  .viz-shell {
    position: relative;
    z-index: 1;
    overflow: hidden;
    /* Force grid track to allow shrinking when chrome is tall. */
    min-height: 200px;
  }
  .rotate-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(28, 22, 17, 0.86);
    color: var(--paper);
    padding: 10px 14px;
    border-radius: 6px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    opacity: 0.92;
  }
  .rotate-hint .icon {
    font-size: 16px;
    display: inline-block;
    animation: spin 4s linear infinite;
  }
  @keyframes spin {
    0% { transform: rotate(0); }
    100% { transform: rotate(360deg); }
  }

  /* Legend */
  .legend-shell {
    position: relative;
    z-index: 1;
    padding: 8px 18px 12px;
    border-top: 1px solid rgba(28, 22, 17, 0.08);
    background: var(--paper);
  }

  /* Side panel */
  .panel {
    position: fixed;
    top: 0; bottom: 0; right: 0;
    width: min(720px, 96vw);
    background: var(--paper-deep);
    border-left: 1px solid rgba(28, 22, 17, 0.1);
    box-shadow: -24px 0 48px rgba(0, 0, 0, 0.12);
    transform: translateX(100%);
    transition: transform 0.32s cubic-bezier(0.2, 0.9, 0.2, 1);
    z-index: 50;
    overflow: auto;
  }
  .panel.open { transform: translateX(0); }
  .panel-inner { padding: 22px 24px 80px; }
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(28, 22, 17, 0.35);
    backdrop-filter: blur(2px);
    z-index: 49;
  }

  .foot {
    position: relative;
    z-index: 1;
    padding: 10px 18px 14px;
    color: rgba(28, 22, 17, 0.5);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    border-top: 1px solid rgba(28, 22, 17, 0.06);
  }
  .foot code {
    color: var(--ink-soft);
    background: rgba(28, 22, 17, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
  }

  @media (max-width: 720px) {
    .head { padding: 14px 16px 8px; flex-direction: column; align-items: flex-start; }
    .head-r { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; }
    h1 { font-size: clamp(24px, 7vw, 36px); }
    .sub { font-size: 12.5px; }
    .legend-shell { padding: 8px 12px; overflow-x: auto; }
    .foot { padding: 8px 14px; }
  }

  /* Short-viewport (landscape phone) layout: hide blurb, compact header,
     drop the verbose legend onto a horizontally-scrollable line, and skip
     the footer so the canvas can actually breathe. */
  @media (max-height: 520px) {
    .head { padding: 8px 14px 4px; flex-direction: row; align-items: center; gap: 12px; }
    .head-l { display: flex; align-items: baseline; gap: 10px; }
    h1 { font-size: 18px; margin: 0; }
    .tagline { display: none; }
    .sub { display: none; }
    .head-r { flex-direction: row; align-items: center; gap: 6px; }
    .io { display: none; }
    .panel-toggle { padding: 6px 10px; font-size: 10px; }
    .legend-shell { padding: 4px 12px; overflow-x: auto; white-space: nowrap; }
    .foot { display: none; }
    .rotate-hint { display: none; }
  }

</style>
