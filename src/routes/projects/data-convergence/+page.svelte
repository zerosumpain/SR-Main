<script lang="ts">
  import { onMount } from 'svelte';
  import Visualization from './components/Visualization.svelte';
  import ConfigTable from './components/ConfigTable.svelte';
  import Controls from './components/Controls.svelte';
  import Legend from './components/Legend.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import { resolveModel } from './lib/strands';
  import { DEFAULT_CONFIG, DEFAULT_OUTPUTS } from './lib/defaults';
  import {
    loadConfig,
    saveConfig,
    clearConfig,
    validateBundle,
    serialiseConfig,
    downloadJSON,
  } from './lib/storage';
  import type { StrandConfig, OutputConfig, ID, ZoomLevel } from './lib/types';

  // --- Config ---
  let strands = $state<StrandConfig[]>(DEFAULT_CONFIG);
  let outputs = $state<OutputConfig[]>(DEFAULT_OUTPUTS);
  let model = $derived(resolveModel(strands, outputs));

  // --- Playback / view state ---
  // Sensible defaults that work without waiting for the data — these get
  // updated on mount once we know the resolved tStart / tEnd.
  const FALLBACK_MS = Date.parse('2026-09-01');
  let playhead = $state(FALLBACK_MS);
  let playing = $state(false);
  let speed = $state(1);
  let zoom = $state<ZoomLevel>('1y');

  // --- UI state ---
  let hoverId = $state<ID | 'spine' | null>(null);
  let hoverOutputId = $state<ID | null>(null);
  let tipX = $state(0);
  let tipY = $state(0);
  let panelOpen = $state(false);
  let importError = $state<string | null>(null);
  let portrait = $state(false);
  let mounted = $state(false);

  onMount(() => {
    const saved = loadConfig();
    if (saved && saved.strands.length > 0) {
      strands = saved.strands;
      outputs = saved.outputs;
    }
    // Start the playhead at a meaningful point — for the default DfE scene,
    // mid-secondary-school (2024) is a good demo moment with multiple strands active.
    const m = resolveModel(strands, outputs);
    const middle = m.tStart + (m.tEnd - m.tStart) * 0.45;
    playhead = middle;
    mounted = true;

    const mq = window.matchMedia('(orientation: portrait)');
    portrait = mq.matches;
    const onChange = () => (portrait = mq.matches);
    mq.addEventListener('change', onChange);

    // Debug hash parsing.
    const hash = window.location.hash;
    const hashMatch = hash.match(/t=([0-9.]+)/);
    if (hashMatch) {
      const ratio = Math.max(0, Math.min(1, parseFloat(hashMatch[1])));
      playhead = m.tStart + ratio * (m.tEnd - m.tStart);
    }
    const zoomMatch = hash.match(/zoom=(6m|1y|10y|adult)/);
    if (zoomMatch) zoom = zoomMatch[1] as ZoomLevel;
    if (hash.includes('panel')) panelOpen = true;

    return () => mq.removeEventListener('change', onChange);
  });

  // Persist on changes.
  $effect(() => {
    if (!mounted) return;
    saveConfig({ strands, outputs });
  });

  // Clamp playhead.
  $effect(() => {
    const tStart = model.tStart;
    const tEnd = model.tEnd;
    if (playhead < tStart) playhead = tStart;
    if (playhead > tEnd) playhead = tEnd;
  });

  // Playback loop.
  let lastTs: number | null = null;
  let rafHandle: number | null = null;

  function togglePlay(next: boolean) {
    if (next && playhead >= model.tEnd - 1) playhead = model.tStart;
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
    if (!playing) { rafHandle = null; return; }
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    const span = Math.max(1, model.tEnd - model.tStart);
    const baseSeconds = 32;
    const delta = (span / baseSeconds) * speed * dt;
    playhead = Math.min(model.tEnd, playhead + delta);
    if (playhead >= model.tEnd) {
      playing = false;
      rafHandle = null;
      return;
    }
    rafHandle = requestAnimationFrame(loop);
  }

  function handleHover(
    hit: { kind: 'strand'; id: ID } | { kind: 'output'; id: ID } | { kind: 'spine' } | null,
    x: number, y: number,
  ) {
    hoverId = hit && hit.kind !== 'output' ? (hit.kind === 'spine' ? 'spine' : hit.id) : null;
    hoverOutputId = hit && hit.kind === 'output' ? hit.id : null;
    tipX = x; tipY = y;
  }

  function setHoverStrand(id: ID | null) {
    hoverId = id;
    hoverOutputId = null;
  }
  function setHoverOutput(id: ID | null) {
    hoverOutputId = id;
    hoverId = null;
  }

  // Import / Export.
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
  function importJsonText(text: string) {
    importError = null;
    try {
      const parsed = JSON.parse(text);
      const validated = validateBundle(parsed);
      if (!validated) throw new Error('Not a valid config bundle.');
      strands = validated.strands;
      outputs = validated.outputs;
    } catch (err) {
      importError = err instanceof Error ? err.message : 'Failed to parse JSON.';
    }
  }
  function exportJson() {
    downloadJSON('data-convergence-config.json', serialiseConfig({ strands, outputs }));
  }
  function copyJson() {
    const text = serialiseConfig({ strands, outputs });
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }
  function resetToDefaults() {
    clearConfig();
    strands = DEFAULT_CONFIG;
    outputs = DEFAULT_OUTPUTS;
  }
</script>

<svelte:head>
  <title>The Spine — Data Convergence Timeline</title>
  <meta name="description" content="Interactive visualisation showing how multiple data streams converge into a single source of truth — with consuming outputs and reference data shown." />
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
      <span class="tagline">FIELD STUDY №1 · V2</span>
      <h1>The Spine</h1>
      <p class="sub">
        Department for Education data — pupil records, assessments, FE and HE learner records,
        adult skills, social care — converging into one source of truth that powers downstream
        analyses and funding decisions.
      </p>
    </div>
    <div class="head-r">
      <div class="io">
        <button class="link" type="button" onclick={exportJson}>Export</button>
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
    <Visualization {model} {playhead} {zoom} onHover={handleHover} />
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
    {zoom}
    onChange={(next) => {
      if (next.playhead !== undefined) playhead = next.playhead;
      if (next.playing !== undefined) togglePlay(next.playing);
      if (next.speed !== undefined) speed = next.speed;
      if (next.zoom !== undefined) zoom = next.zoom;
    }}
  />

  <section class="legend-shell">
    <Legend
      {model}
      {hoverId}
      {hoverOutputId}
      onHoverStrand={setHoverStrand}
      onHoverOutput={setHoverOutput}
    />
  </section>

  <Tooltip {model} {hoverId} {hoverOutputId} x={tipX} y={tipY} />

  <aside class="panel" class:open={panelOpen} aria-hidden={!panelOpen}>
    <div class="panel-inner">
      <ConfigTable
        {strands}
        {outputs}
        {model}
        onChange={(next) => {
          if (next.strands) strands = next.strands;
          if (next.outputs) outputs = next.outputs;
        }}
      />
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
  .page {
    --paper: #f1ead6;
    --paper-deep: #e7decc;
    --ink: #1c1611;
    --ink-soft: rgba(28, 22, 17, 0.62);

    position: fixed;
    inset: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background:
      radial-gradient(ellipse 90% 60% at 50% 45%, rgba(255, 255, 255, 0.35), transparent 70%),
      var(--paper);
  }
  .viz-shell { flex: 1 1 auto; }

  .paper-grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.55;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.08 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  .head {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: 18px 28px 10px;
    gap: 24px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.08);
  }
  .head-l { max-width: 70ch; min-width: 0; }
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
    font-size: clamp(24px, 4.2vw, 42px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 4px 0 4px;
    font-feature-settings: 'ss01' on;
  }
  .sub {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-soft);
    max-width: 64ch;
  }
  .head-r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }
  .io { display: flex; gap: 4px; }
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

  .viz-shell {
    position: relative;
    z-index: 1;
    overflow: hidden;
    min-height: 220px;
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

  .legend-shell {
    position: relative;
    z-index: 1;
    padding: 10px 18px 12px;
    border-top: 1px solid rgba(28, 22, 17, 0.08);
    background: var(--paper);
  }

  .panel {
    position: fixed;
    top: 0; bottom: 0; right: 0;
    width: min(880px, 96vw);
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
    padding: 8px 18px 10px;
    color: rgba(28, 22, 17, 0.5);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
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
    .head { padding: 12px 16px 8px; flex-direction: column; align-items: flex-start; }
    .head-r { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; }
    h1 { font-size: clamp(22px, 6vw, 32px); }
    .sub { font-size: 12px; }
    .legend-shell { padding: 8px 12px; overflow-x: auto; }
    .foot { padding: 6px 14px; }
  }

  @media (max-height: 520px) {
    .head { padding: 6px 14px 4px; flex-direction: row; align-items: center; gap: 12px; }
    .head-l { display: flex; align-items: baseline; gap: 10px; }
    h1 { font-size: 18px; margin: 0; }
    .tagline { display: none; }
    .sub { display: none; }
    .head-r { flex-direction: row; align-items: center; gap: 6px; }
    .io { display: none; }
    .panel-toggle { padding: 6px 10px; font-size: 10px; }
    .legend-shell { padding: 4px 12px; overflow-x: auto; }
    .foot { display: none; }
    .rotate-hint { display: none; }
  }
</style>
