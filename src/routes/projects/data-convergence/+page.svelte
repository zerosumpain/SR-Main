<script lang="ts">
  import { onMount } from 'svelte';
  import Visualization from './components/Visualization.svelte';
  import ConfigTable from './components/ConfigTable.svelte';
  import Controls from './components/Controls.svelte';
  import Legend from './components/Legend.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import ScenarioBar from './components/ScenarioBar.svelte';
  import { resolveModel } from './lib/strands';
  import { defaultStore, buildScenario, BASELINE_STRANDS, BASELINE_OUTPUTS } from './lib/defaults';
  import {
    loadStore,
    saveStore,
    clearStore,
    validateStore,
    serialiseStore,
    downloadJSON,
    newId,
  } from './lib/storage';
  import type {
    StrandConfig, OutputConfig, ID, ZoomLevel, Scenario, ScenarioStore,
  } from './lib/types';

  // --- Scenario store ---
  let store = $state<ScenarioStore>(defaultStore());
  let activeScenario = $derived(store.scenarios.find((s) => s.id === store.activeId) ?? store.scenarios[0]);
  let strands = $derived(activeScenario?.strands ?? []);
  let outputs = $derived(activeScenario?.outputs ?? []);
  let model = $derived(resolveModel(strands, outputs));

  // --- Playback / view state ---
  let playhead = $state(Date.parse('2023-01-01'));
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
  let vizRef: ReturnType<typeof Visualization> | undefined = $state(undefined);

  onMount(() => {
    const saved = loadStore();
    if (saved) store = saved;
    mounted = true;

    const mq = window.matchMedia('(orientation: portrait)');
    portrait = mq.matches;
    const onChange = () => (portrait = mq.matches);
    mq.addEventListener('change', onChange);

    const hash = window.location.hash;
    const hashMatch = hash.match(/t=([0-9.]+)/);
    if (hashMatch) {
      const ratio = Math.max(0, Math.min(1, parseFloat(hashMatch[1])));
      const m = resolveModel(strands, outputs);
      playhead = m.tStart + ratio * (m.tEnd - m.tStart);
    }
    const zoomMatch = hash.match(/zoom=(6m|1y|10y|adult)/);
    if (zoomMatch) zoom = zoomMatch[1] as ZoomLevel;
    if (hash.includes('panel')) panelOpen = true;

    return () => mq.removeEventListener('change', onChange);
  });

  $effect(() => {
    if (!mounted) return;
    saveStore(store);
  });

  $effect(() => {
    const tStart = model.tStart;
    const tEnd = model.tEnd;
    if (playhead < tStart) playhead = tStart;
    if (playhead > tEnd) playhead = tEnd;
  });

  // --- Mutation helpers (all operate on the ACTIVE scenario) ---
  function patchActive(patch: Partial<Scenario>) {
    const idx = store.scenarios.findIndex((s) => s.id === store.activeId);
    if (idx < 0) return;
    const now = new Date().toISOString();
    const next = [...store.scenarios];
    next[idx] = { ...next[idx], ...patch, updatedAt: now };
    store = { ...store, scenarios: next };
  }
  function setStrands(strands: StrandConfig[]) { patchActive({ strands }); }
  function setOutputs(outputs: OutputConfig[]) { patchActive({ outputs }); }

  function toggleStrandVisible(id: ID) {
    const next = strands.map((s) =>
      s.id === id ? { ...s, visible: s.visible === false ? true : false } : s
    );
    setStrands(next);
  }
  function toggleOutputVisible(id: ID) {
    const next = outputs.map((o) =>
      o.id === id ? { ...o, visible: o.visible === false ? true : false } : o
    );
    setOutputs(next);
  }

  function handleDragEdit(strandId: ID, handle: 'start' | 'merge', newIso: string) {
    const next = strands.map((s) =>
      s.id === strandId
        ? (handle === 'merge' ? { ...s, mergeDate: newIso } : { ...s, startDate: newIso })
        : s
    );
    setStrands(next);
  }

  // --- Scenario commands ---
  function switchScenario(id: ID) {
    store = { ...store, activeId: id };
  }
  function createScenario() {
    const sc = buildScenario('New scenario', undefined, BASELINE_STRANDS, BASELINE_OUTPUTS);
    store = { activeId: sc.id, scenarios: [...store.scenarios, sc] };
  }
  function duplicateScenario() {
    if (!activeScenario) return;
    const sc = buildScenario(`${activeScenario.name} (copy)`, activeScenario.description, activeScenario.strands, activeScenario.outputs);
    store = { activeId: sc.id, scenarios: [...store.scenarios, sc] };
  }
  function renameScenario(name: string) { patchActive({ name }); }
  function describeScenario(description: string) { patchActive({ description }); }
  function deleteScenario() {
    if (store.scenarios.length <= 1) return;
    const idx = store.scenarios.findIndex((s) => s.id === store.activeId);
    const remaining = store.scenarios.filter((s) => s.id !== store.activeId);
    const nextActive = remaining[Math.min(idx, remaining.length - 1)].id;
    store = { activeId: nextActive, scenarios: remaining };
  }
  function resetActiveToBaseline() {
    if (!activeScenario) return;
    patchActive({ strands: deepClone(BASELINE_STRANDS), outputs: deepClone(BASELINE_OUTPUTS) });
  }
  function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

  // --- Playback loop, speed map ---
  let lastTs: number | null = null;
  let rafHandle: number | null = null;
  const dayMs = 1000 * 60 * 60 * 24;
  const ZOOM_DAYS_PER_SECOND: Record<string, number> = {
    '6m': 7, '1y': 30, '10y': 90, 'adult': 182,
  };

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
    const daysPerSec = ZOOM_DAYS_PER_SECOND[zoom] ?? 30;
    const delta = daysPerSec * dayMs * speed * dt;
    playhead = Math.min(model.tEnd, playhead + delta);
    if (playhead >= model.tEnd) { playing = false; rafHandle = null; return; }
    rafHandle = requestAnimationFrame(loop);
  }

  // --- Hover ---
  function handleHover(
    hit: { kind: 'strand'; id: ID } | { kind: 'output'; id: ID } | { kind: 'spine' } | null,
    x: number, y: number,
  ) {
    hoverId = hit && hit.kind !== 'output' ? (hit.kind === 'spine' ? 'spine' : hit.id) : null;
    hoverOutputId = hit && hit.kind === 'output' ? hit.id : null;
    tipX = x; tipY = y;
  }
  function setHoverStrand(id: ID | null) { hoverId = id; hoverOutputId = null; }
  function setHoverOutput(id: ID | null) { hoverOutputId = id; hoverId = null; }

  // --- I/O ---
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
      const validated = validateStore(parsed);
      if (!validated) throw new Error('Not a valid scenario store.');
      store = validated;
    } catch (err) {
      importError = err instanceof Error ? err.message : 'Failed to parse JSON.';
    }
  }
  function exportJson() {
    downloadJSON(`data-convergence-scenarios-${Date.now()}.json`, serialiseStore(store));
  }
  function copyJson() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(serialiseStore(store)).catch(() => {});
    }
  }
  function resetAllScenarios() {
    clearStore();
    store = defaultStore();
  }
  function exportPng() {
    vizRef?.exportPng(`data-convergence-${(activeScenario?.name ?? 'scenario').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.png`);
  }
</script>

<svelte:head>
  <title>The Spine — Data Convergence Timeline</title>
  <meta name="description" content="Scenario-planning infographic showing how scattered data streams converge into a single source of truth, with annual collections, schemas, and downstream consumers." />
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
      <span class="tagline">FIELD STUDY №1 · V4 · SCENARIO PLANNING</span>
      <h1>The Spine</h1>
      <p class="sub">
        An infographic timeline that models how separate data streams — each with its own schema —
        might converge into a single, trusted source of truth, and what downstream collections rely on them.
      </p>
    </div>
    <div class="head-r">
      <div class="io">
        <button class="link" type="button" onclick={exportPng}>PNG</button>
        <button class="link" type="button" onclick={exportJson}>JSON</button>
        <button class="link" type="button" onclick={copyJson}>Copy</button>
        <button class="link" type="button" onclick={pickJsonFile}>Import</button>
        <button class="link" type="button" onclick={resetAllScenarios}>Reset all</button>
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

  <ScenarioBar
    scenarios={store.scenarios}
    activeId={store.activeId}
    onSwitch={switchScenario}
    onCreate={createScenario}
    onDuplicate={duplicateScenario}
    onRename={renameScenario}
    onDescribe={describeScenario}
    onDelete={deleteScenario}
    onResetActive={resetActiveToBaseline}
  />

  {#if importError}
    <div class="import-error" role="alert">Couldn't import: {importError}</div>
  {/if}

  <section class="viz-shell">
    <Visualization
      bind:this={vizRef}
      {model}
      {playhead}
      {zoom}
      onHover={handleHover}
      onDragEdit={handleDragEdit}
    />
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
      rawStrands={strands}
      rawOutputs={outputs}
      {hoverId}
      {hoverOutputId}
      onHoverStrand={setHoverStrand}
      onHoverOutput={setHoverOutput}
      onToggleStrand={toggleStrandVisible}
      onToggleOutput={toggleOutputVisible}
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
          if (next.strands) setStrands(next.strands);
          if (next.outputs) setOutputs(next.outputs);
        }}
      />
    </div>
  </aside>

  {#if panelOpen}
    <div class="panel-backdrop" onclick={() => (panelOpen = false)} aria-hidden="true"></div>
  {/if}

  <footer class="foot">
    <span>
      Designed and built for John. <code>/projects/data-convergence</code> · Tip: drag a strand's
      square handle to move its merge date, or the round one to move its start.
    </span>
  </footer>
</div>

<style>
  :global(html), :global(body) { margin: 0; }
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
  .viz-shell { flex: 1 1 auto; min-height: 220px; position: relative; z-index: 1; overflow: hidden; }

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
    padding: 14px 28px 8px;
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
    font-size: clamp(22px, 3.6vw, 36px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 4px 0 4px;
  }
  .sub {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-soft);
    max-width: 70ch;
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
  @keyframes spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }

  .legend-shell {
    position: relative;
    z-index: 1;
    padding: 10px 18px 10px;
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
    padding: 6px 18px 8px;
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
    .head { padding: 12px 16px 6px; flex-direction: column; align-items: flex-start; }
    .head-r { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; }
    h1 { font-size: clamp(20px, 6vw, 28px); }
    .sub { font-size: 12px; }
    .legend-shell { padding: 8px 12px; overflow-x: auto; }
    .foot { padding: 6px 14px; }
  }

  @media (max-height: 540px) {
    .head { padding: 6px 14px 4px; flex-direction: row; align-items: center; gap: 12px; }
    .head-l { display: flex; align-items: baseline; gap: 10px; }
    h1 { font-size: 16px; margin: 0; }
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
