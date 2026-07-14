<script lang="ts">
  // FederationSim — the interactive model: Three.js canvas (scene.ts) + scenario
  // engine (engine.ts) + this HUD. All render-loop handles are plain lets (never
  // $state — see svelte5-pitfalls); $state holds only what the template reads.
  import { onMount } from 'svelte';
  import { buildTopology, schoolInfo, holderById, DFE_ID, LEDGER_ID, DEFAULT_SCHOOL_COUNT, type Topology, type NetNode, type SchoolInfo } from './topology';
  import { SimEngine, type SimEvent, type LogEntry, type CounterKey, type Scenario } from './engine';
  import { SCENARIOS, SCENARIO_GROUPS, scenarioById } from './scenarios';
  import { JOIN_QUERIES, JOIN_GROUPS, runJoinQuery, buildJoinScenario, type JoinQuery } from './joins';
  import { createFederationScene, type SceneHandle, type PickResult } from './scene';

  let {
    onActiveScenario,
    onReady,
    embed = false,
    standalone = false,
  }: {
    onActiveScenario?: (s: Scenario | null) => void;
    /** Fires once the engine+scene are live, passing the playback API — lets an
     *  embedding host (e.g. a deck slide) auto-run a scenario without racing
     *  bind:this against onMount ordering. */
    onReady?: (api: { run: (id: string) => void; runScenario: (s: Scenario) => void }) => void;
    /** Compact presentation mode (sr. decks): canvas + narration + counters
     *  only — no scenario catalogue, exchange log or colour-language panels.
     *  The embedding slide provides the narrative around it. */
    embed?: boolean;
    /** Dedicated single-screen simulation: keep the full catalogue + joins, but
     *  move the log/contract into on-canvas overlays so nothing scrolls. */
    standalone?: boolean;
  } = $props();

  // --- non-reactive handles (render loop internals) ---
  let container: HTMLElement;
  let shell: HTMLElement;
  let sceneHandle: SceneHandle | null = null;
  let engine: SimEngine | null = null;
  let topo: Topology | null = null;

  // --- UI state (only what the template reads) ---
  let ready = $state(false);
  let webglFailed = $state(false);
  let narration = $state('An ordinary morning on the exchange. Ambient traffic only — pick a scenario to run a simulation.');
  let phase = $state<string | undefined>(undefined);
  let stepIndex = $state(0);
  let stepCount = $state(0);
  let playing = $state(false);
  let ended = $state(false);
  // the current stage has fully played and is looping its visuals — Next advances
  let awaitingNext = $state(false);
  let mode = $state<'federated' | 'central'>('federated');
  // the ring around the exchange has two mutually-exclusive layers: the certified
  // apps, or the MIS access brokers (aggregators). 'off' shows neither.
  let ringLayer = $state<'off' | 'apps' | 'brokers'>('off');
  let showReach = $state(false); // overlay indicative schools-reached on the ring
  // the single source of truth for what is (or was just) playing — catalogue
  // scenarios and generated ask-the-federation scenarios alike
  let activeScenario = $state<Scenario | null>(null);
  const activeId = $derived(activeScenario?.id ?? null);
  let logEntries = $state<LogEntry[]>([]);
  let counters = $state<Record<CounterKey, number>>({ exchanges: 0, pupilRecordsMoved: 0, aggregatesReturned: 0, refusals: 0, auditEntries: 0 });
  let inspectorNode = $state<NetNode | null>(null);
  let inspectorSchool = $state<SchoolInfo | null>(null);
  let contractOpen = $state(true);
  let canFullscreen = $state(false);
  let isFullscreen = $state(false);
  let logOpen = $state(false); // standalone bottom-left log — collapsed by default, expands up

  // the scenario/join dropdown reflects whatever is (or was just) playing
  const selectValue = $derived(
    activeId == null ? ''
      : activeId.startsWith('join-') ? `join:${activeId.slice(5)}`
      : `sc:${activeId}`,
  );
  function onPickScenario(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v.startsWith('sc:')) run(v.slice(3));
    else if (v.startsWith('join:')) {
      const q = JOIN_QUERIES.find((x) => x.id === v.slice(5));
      if (q) runJoin(q);
    }
  }


  const COUNTER_META: Array<{ key: CounterKey; label: string; hot?: boolean }> = [
    { key: 'exchanges', label: 'exchanges' },
    { key: 'aggregatesReturned', label: 'aggregate returns' },
    { key: 'pupilRecordsMoved', label: 'pupil-level records moved', hot: true },
    { key: 'refusals', label: 'refusals' },
    { key: 'auditEntries', label: 'ledger entries' },
  ];

  function handleEvent(e: SimEvent) {
    switch (e.type) {
      case 'narrate':
        narration = e.text;
        phase = e.phase;
        stepIndex = e.stepIndex + 1;
        stepCount = e.stepCount;
        awaitingNext = false;
        break;
      case 'step-settled':
        awaitingNext = true;
        break;
      case 'log':
        logEntries = [e.entry, ...logEntries].slice(0, 60);
        break;
      case 'counter':
        counters[e.key] += e.delta;
        break;
      case 'scenario-start': {
        // per-scenario counters reset on EVERY start path (run, restart, replay);
        // exchanges + ledger entries are cumulative network history and persist
        counters = { exchanges: counters.exchanges, pupilRecordsMoved: 0, aggregatesReturned: 0, refusals: 0, auditEntries: counters.auditEntries };
        ended = false;
        playing = true;
        // sits on the start EVENT (not just playScenario) so replay/restart
        // paths also force the tendril ring visible for edtech scenarios
        const s = engine?.activeScenario ?? null;
        if (s && (s.usesEdtech ?? touchesEdtech(s)) && ringLayer !== 'apps') applyRing('apps');
        onActiveScenario?.(s);
        break;
      }
      case 'scenario-end':
        ended = true;
        playing = false;
        awaitingNext = false;
        narration = 'Scenario complete. Replay it or pick another — the ambient traffic carries on regardless.';
        phase = undefined;
        break;
      case 'stopped':
        playing = false;
        ended = false;
        awaitingNext = false;
        activeScenario = null;
        narration = 'Back to the ambient morning. Pick a scenario to run a simulation.';
        phase = undefined;
        onActiveScenario?.(null);
        break;
      default:
        sceneHandle?.applyEvent(e);
    }
  }

  function handlePick(p: PickResult | null) {
    if (!topo) return;
    if (!p) { inspectorNode = null; inspectorSchool = null; return; }
    if (p.kind === 'node' && p.nodeId) {
      inspectorNode = topo.byId.get(p.nodeId) ?? null;
      inspectorSchool = null;
    } else if (p.kind === 'school' && p.schoolIndex !== undefined) {
      inspectorSchool = schoolInfo(topo, p.schoolIndex);
      inspectorNode = null;
    }
  }

  /** does this scenario touch the edtech tendrils? then the ring must be visible */
  function touchesEdtech(s: Scenario): boolean {
    return s.steps.some((step) => step.actions.some((a) => {
      switch (a.kind) {
        case 'pulse': return a.from.startsWith('edt-') || a.to.startsWith('edt-');
        case 'flash': return a.node.startsWith('edt-');
        case 'highlight': return a.nodes.some((n) => n.startsWith('edt-'));
        default: return false;
      }
    }));
  }

  export function run(id: string) {
    const s = scenarioById(id);
    if (!s) return;
    runScenario(s);
  }

  /** play any scenario — catalogue or externally built (ask-the-federation / join) */
  export function runScenario(s: Scenario) {
    if (!engine || !ready) return; // dead engine when WebGL failed — don't fake a run
    activeScenario = s;
    engine.loadScenario(s);
    if (!standalone) shell?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** run a cross-context join: build the scenario from the join catalogue and play it */
  export function runJoin(q: JoinQuery) {
    runScenario(buildJoinScenario(runJoinQuery(q)));
  }

  /** switch the ring layer (off / certified apps / MIS brokers). Only the apps layer
   *  carries ambient + scenario traffic, so the engine's edtech flag tracks it. */
  function applyRing(layer: 'off' | 'apps' | 'brokers') {
    ringLayer = layer;
    sceneHandle?.setEdtech(layer === 'apps');
    sceneHandle?.setAggregators(layer === 'brokers');
    if (engine) {
      engine.edtechActive = layer === 'apps';
      engine.aggregatorsActive = layer === 'brokers'; // brokers drive the ambient plumbing
    }
  }
  function toggleReach() {
    showReach = !showReach;
    sceneHandle?.setReach(showReach);
  }

  function togglePlay() {
    if (!engine) return;
    if (ended && activeScenario) { engine.restart(); return; }
    engine.toggle();
    playing = engine.playing;
  }
  function stepFwd() { engine?.stepForward(); }
  function stopScenario() { engine?.stop(); }
  function setMode(m: 'federated' | 'central') { mode = m; sceneHandle?.setMode(m); }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell?.requestFullscreen?.();
  }

  onMount(() => {
    canFullscreen = typeof shell?.requestFullscreen === 'function';
    const reduced = window.innerWidth < 800 || (navigator.hardwareConcurrency ?? 8) <= 4;
    topo = buildTopology();
    engine = new SimEngine({
      suppliers: topo.supplierIds,
      consumers: ['con-la', 'con-csc', 'con-tre', 'con-ofsted'],
      hub: DFE_ID,
      ledger: LEDGER_ID,
      edtech: topo.edtechIds,
      aggregators: topo.aggregatorIds,
    });
    let unsub = () => {};
    try {
      sceneHandle = createFederationScene(container, topo, { reduced, onPick: handlePick });
      const eng = engine;
      sceneHandle.addTick((dt) => eng.tick(dt));
      unsub = engine.subscribe(handleEvent);
      ready = true;
      onReady?.({ run, runScenario });
    } catch (err) {
      console.error('federation scene failed to start', err);
      webglFailed = true;
    }
    return () => {
      unsub();
      sceneHandle?.dispose();
      sceneHandle = null;
    };
  });
</script>

<svelte:document onfullscreenchange={() => (isFullscreen = document.fullscreenElement === shell)} />

{#snippet counterTiles()}
  {#each COUNTER_META as c}
    <div class="ct" class:hot={c.hot && counters[c.key] > 0}>
      <b>{counters[c.key].toLocaleString('en-GB')}</b>
      <span>{c.label}</span>
    </div>
  {/each}
{/snippet}

<div class="sim-shell" class:embed bind:this={shell}>
  <div class="sim-canvas" bind:this={container}></div>

  {#if webglFailed}
    <div class="webgl-fallback">
      <b>The 3D model needs WebGL.</b>
      <p>Your browser or device declined to start it. The scenario catalogue below still describes every simulation in full.</p>
    </div>
  {/if}

  {#if ready}
    <!-- top bar: scenario picker + mode + ring + view -->
    <div class="hud top">
      {#if !embed}
        <label class="sc-select">
          <span class="sc-select-lab">Scenario</span>
          <select value={selectValue} onchange={onPickScenario} aria-label="Choose a scenario or cross-context join">
            <option value="" disabled>Pick a scenario…</option>
            {#each SCENARIO_GROUPS as g}
              <optgroup label={g}>
                {#each SCENARIOS.filter((s) => s.group === g) as s}
                  <option value={`sc:${s.id}`}>{s.title}</option>
                {/each}
              </optgroup>
            {/each}
            {#each JOIN_GROUPS as g}
              <optgroup label={`Join · ${g.label}`}>
                {#each JOIN_QUERIES.filter((q) => q.horizon === g.key) as q}
                  <option value={`join:${q.id}`}>{q.question} — {q.difficulty}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
      {/if}
      <div class="mode-seg" role="group" aria-label="Architecture mode">
        <button class:on={mode === 'federated'} onclick={() => setMode('federated')} title="Federated exchange — records stay at source; queries travel.">Federated</button>
        <button class:on={mode === 'central'} class="danger" onclick={() => setMode('central')} title="Central store counterfactual — everything copied to one national database.">Central store</button>
      </div>
      <span class="ring-seg" role="group" aria-label="Outer ring layer">
        <span class="seg-lab">◇ Ring</span>
        <button class:on={ringLayer === 'off'} onclick={() => applyRing('off')} title="Hide the outer ring">Off</button>
        <button class:on={ringLayer === 'apps'} onclick={() => applyRing('apps')} title="Certified edtech apps as spurs on the exchange — imagined contributors of aggregate intelligence">Apps</button>
        <button class:on={ringLayer === 'brokers'} onclick={() => applyRing('brokers')} title="MIS access brokers (Wonde, Xporter, Assembly, Salamander) — the plumbing that moves school data today">Brokers</button>
      </span>
      {#if ringLayer !== 'off'}
        <button class="ghost" class:lit={showReach} onclick={toggleReach} title="Overlay each platform's approximate school reach">＃ reach{showReach ? ' · on' : ''}</button>
      {/if}
      <span class="zoom-seg" role="group" aria-label="Zoom">
        <button onclick={() => sceneHandle?.zoom(0.82)} title="Zoom in (or ⌘/Ctrl-scroll)" aria-label="Zoom in">+</button>
        <button onclick={() => sceneHandle?.zoom(1.22)} title="Zoom out (or ⌘/Ctrl-scroll)" aria-label="Zoom out">−</button>
      </span>
      <button class="ghost" onclick={() => sceneHandle?.resetView()} title="Reset the camera">⌂ view</button>
      {#if canFullscreen}
        <button class="ghost" onclick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Fill the screen'}>
          {isFullscreen ? '⤡ exit' : '⛶ full screen'}
        </button>
      {/if}
    </div>

    <!-- transport + narration (compact caption band) -->
    <div class="hud narrate" class:idle={!activeScenario}>
      {#if activeScenario}
        <div class="n-head">
          <span class="n-title">{activeScenario.title}</span>
          {#if phase}<span class="n-phase">{phase}</span>{/if}
          {#if stepCount}<span class="n-step">{stepIndex}/{stepCount}</span>{/if}
          <div class="transport">
            {#if !ended}
              <button class="next-btn" class:ready={awaitingNext} onclick={stepFwd} title="Advance to the next stage">
                {stepIndex >= stepCount ? 'Finish' : 'Next'} ▸
              </button>
            {/if}
            <button onclick={togglePlay} title={ended ? 'Replay' : playing ? 'Pause' : 'Play'}>{ended ? '↺' : playing ? '❚❚' : '▶'}</button>
            <button onclick={stopScenario} title="Exit scenario">✕</button>
          </div>
        </div>
      {/if}
      <p class="n-text">{narration}</p>
    </div>

    <!-- counters -->
    <div class="hud counters">
      {@render counterTiles()}
    </div>

    <!-- inspector -->
    {#if inspectorNode || inspectorSchool}
      <aside class="hud panel inspector" class:sa={standalone}>
        <button class="close" onclick={() => { inspectorNode = null; inspectorSchool = null; }} aria-label="Close">✕</button>
        {#if inspectorNode}
          <span class="p-lab">
            {inspectorNode.kind === 'store' ? 'DfE estate · existing store'
              : inspectorNode.kind === 'edtech' ? 'edtech app · imagined contributor'
              : inspectorNode.kind === 'aggregator' ? 'MIS access broker · the plumbing today'
              : inspectorNode.kind === 'la' ? (inspectorNode.sector === 'cross' ? 'cross-sector world' : 'local-authority data')
              : inspectorNode.kind === 'resolver' ? 'the spine · identity resolver'
              : inspectorNode.kind === 'registry' ? 'the spine · registry'
              : inspectorNode.kind === 'supplier' ? 'MIS supplier · gateway'
              : inspectorNode.kind}
          </span>
          <h4>{inspectorNode.label}</h4>
          {#if inspectorNode.sub}<span class="i-sub">{inspectorNode.sub}</span>{/if}
          {#if inspectorNode.kind === 'supplier'}
            <div class="i-stats">
              <span><b>{(inspectorNode.schools ?? 0).toLocaleString('en-GB')}</b> schools</span>
              <span><b>{inspectorNode.sharePct}%</b> of estate</span>
            </div>
            <span class="i-src">{inspectorNode.indicative ? 'Indicative — not in the state MIS census' : 'WhichMIS Oct-2025 census'}</span>
          {:else if inspectorNode.kind === 'la'}
            {@const h = holderById(inspectorNode.id)}
            {#if h}
              <div class="i-stats">
                <span><b>{h.cases.toLocaleString('en-GB')}</b> caseload</span>
              </div>
              <span class="i-src">key: {h.key}</span>
            {/if}
          {:else if inspectorNode.reach != null}
            <div class="i-stats">
              <span><b>~{inspectorNode.reach.toLocaleString('en-GB')}</b> schools reached</span>
            </div>
            <span class="i-src">Indicative reach — vendors’ own public figures</span>
          {/if}
          <p>{inspectorNode.desc}</p>
        {:else if inspectorSchool}
          <span class="p-lab">provider · synthetic record</span>
          <h4>{inspectorSchool.name}</h4>
          <span class="i-sub">{inspectorSchool.phase} · {inspectorSchool.region} · URN {inspectorSchool.urn}</span>
          <div class="i-stats">
            <span><b>{inspectorSchool.pupils}</b> pupils</span>
            <span>MIS: <b>{inspectorSchool.supplierLabel}</b></span>
          </div>
          <p>One of {DEFAULT_SCHOOL_COUNT.toLocaleString('en-GB')} dots — one per real English school, clustered by its MIS vendor. Its records live here, in its school and its supplier's estate, and in a federated design, this is where they stay.</p>
        {/if}
      </aside>
    {/if}
  {/if}
</div>

{#snippet exchangeLog()}
  <div class="log-wrap">
    <span class="p-lab">Exchange log · signed & citizen-readable</span>
    <div class="log" role="log">
      {#if logEntries.length === 0}
        <p class="log-empty">Waiting for exchange traffic — run a scenario.</p>
      {/if}
      {#each logEntries as l (l.sig)}
        <div class="log-row {l.kind}">
          <span class="l-clock">{l.clock}</span>
          <span class="l-kind">{l.kind}</span>
          <span class="l-text">{l.text}</span>
          <span class="l-sig">{l.sig}</span>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet contractCard()}
  {#if activeScenario?.contract}
    <div class="contract">
      <button class="c-head" onclick={() => (contractOpen = !contractOpen)} aria-expanded={contractOpen}>
        <span class="p-lab">Query contract</span>
        <span class="c-chev" class:open={contractOpen}>▾</span>
      </button>
      {#if contractOpen}
        {@const c = activeScenario.contract}
        <dl>
          <dt>Requester</dt><dd>{c.requester}</dd>
          <dt>Purpose</dt><dd>{c.purpose}</dd>
          <dt>Legal basis</dt><dd>{c.legalBasis}</dd>
          <dt>Fields</dt><dd>{c.fields.join(' · ')}</dd>
          <dt>Population</dt><dd>{c.population}</dd>
          <dt>Aggregation</dt><dd>{c.aggregation}</dd>
          <dt>Retention</dt><dd>{c.retention}</dd>
        </dl>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet scenarioInfo()}
  {#if activeScenario}
    <div class="counterfactual">
      <span class="p-lab">The central-store counterfactual</span>
      <p><b>Records:</b> {activeScenario.central.records}</p>
      {#if activeScenario.central.exposure !== '—'}<p><b>Exposure:</b> {activeScenario.central.exposure}</p>{/if}
      <p class="cf-note">{activeScenario.central.note}</p>
    </div>
    <div class="lesson">
      <span class="p-lab">What this scenario argues</span>
      <p>{activeScenario.lesson}</p>
    </div>
  {:else}
    <div class="legend">
      <span class="p-lab">Colour language</span>
      <ul>
        <li><i style="background:var(--accent-ink)"></i> query / contract — the question travelling</li>
        <li><i style="background:var(--accent)"></i> record content — pupil-level data moving</li>
        <li><i style="background:#2f7d4f"></i> verified / aggregate answer</li>
        <li><i style="background:#8a2d3a"></i> refusal · breach · outage</li>
        <li><i style="background:#2f6b73"></i> local authorities — the second context space</li>
        <li><i style="background:#7d6e58"></i> edtech apps — imagined certified contributors <em>(Ring · Apps)</em></li>
        <li><i style="background:#67707a"></i> MIS brokers — the plumbing that moves data today <em>(Ring · Brokers)</em></li>
      </ul>
      <p class="lg-note">Drag to orbit · <b>+ / −</b> or ⌘/Ctrl-scroll to zoom · click to inspect. Plain scroll moves the page.</p>
    </div>
  {/if}
{/snippet}

{#snippet sideStack()}
  <div class="side-stack">
    {@render contractCard()}
    {@render scenarioInfo()}
  </div>
{/snippet}

<!-- deck layout: log + contract render BELOW the canvas -->
{#if ready && !embed && !standalone}
  <div class="counters-inline">
    {@render counterTiles()}
  </div>
  <div class="under">
    {@render exchangeLog()}
    {@render sideStack()}
  </div>
{/if}

<!-- standalone one-screen: everything is an on-canvas overlay, corners kept clear -->
{#if ready && standalone}
  <!-- top-left: the central-store counterfactual + the scenario explainer (or legend) -->
  <aside class="hud info-tl">
    {@render scenarioInfo()}
  </aside>

  <!-- bottom-left: exchange log + query contract, collapsed by default, expands upward -->
  <aside class="hud lograil" class:open={logOpen}>
    {#if logOpen}
      <div class="lograil-body">
        {@render exchangeLog()}
        {@render contractCard()}
      </div>
    {/if}
    <button class="lograil-toggle" onclick={() => (logOpen = !logOpen)} aria-expanded={logOpen}>
      <span class="p-lab">Exchange log &amp; contract</span>
      <span class="c-chev up" class:open={logOpen}>▴</span>
    </button>
  </aside>
{/if}

<style>
  .sim-shell { position: relative; height: max(560px, calc(100vh - var(--topH, 56px) - 54px)); height: max(560px, calc(100svh - var(--topH, 56px) - 54px)); border-block: 1px solid rgba(28,22,17,0.25); overflow: hidden; background: #efe7d5; scroll-margin-top: calc(var(--topH, 56px) + 50px); }
  .sim-shell:fullscreen { height: 100vh; border: none; }
  /* deck-embed mode: fit inside a slide with the slide's own narration below */
  .sim-shell.embed { height: max(440px, calc(100svh - 240px)); border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.2); }
  .sim-canvas { position: absolute; inset: 0; cursor: grab; }
  .sim-canvas:active { cursor: grabbing; }

  .webgl-fallback { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; padding: 24px; }
  .webgl-fallback b { font-family: 'Fraunces', serif; font-size: 18px; }
  .webgl-fallback p { max-width: 44ch; font-size: 13.5px; color: rgba(28,22,17,0.7); }

  .hud { position: absolute; z-index: 5; }
  .p-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 6px; }

  /* top bar */
  .top { top: 10px; left: 12px; right: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  /* scenario dropdown — replaces the old left catalogue panel */
  .sc-select { display: inline-flex; align-items: center; gap: 7px; background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); padding: 3px 8px 3px 12px; backdrop-filter: blur(4px); max-width: min(46vw, 340px); }
  .sc-select-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); flex: 0 0 auto; }
  .sc-select select { flex: 1 1 auto; min-width: 0; max-width: 260px; background: transparent; border: none; color: var(--ink); font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; padding: 5px 2px; cursor: pointer; text-overflow: ellipsis; }
  .sc-select select:focus { outline: none; }

  .mode-seg { display: inline-flex; background: rgba(241,234,214,0.92); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.25); backdrop-filter: blur(4px); }
  .mode-seg button { background: transparent; border: none; color: var(--ink); padding: 6px 12px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .mode-seg button.on { background: var(--accent-ink); color: #fff; }
  .mode-seg button.danger.on { background: #8a2d3a; }
  .ghost { background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 7px 11px; cursor: pointer; backdrop-filter: blur(4px); }
  .ghost:hover { border-color: rgba(28,22,17,0.5); }
  .ghost.lit { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .zoom-seg { display: inline-flex; background: rgba(241,234,214,0.92); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.25); backdrop-filter: blur(4px); }
  .zoom-seg button { background: transparent; border: none; color: var(--ink); width: 24px; height: 22px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 14px; line-height: 1; cursor: pointer; }
  .zoom-seg button:hover { background: rgba(28,22,17,0.08); }

  /* ring-layer segmented control (Off / Apps / Brokers) */
  .ring-seg { display: inline-flex; align-items: center; gap: 2px; background: rgba(241,234,214,0.92); padding: 2px 6px 2px 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.25); backdrop-filter: blur(4px); }
  .seg-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.55); padding: 0 6px 0 8px; }
  .ring-seg button { background: transparent; border: none; color: var(--ink); padding: 5px 10px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .ring-seg button.on { background: var(--accent-ink); color: #fff; }

  /* narration + transport — the presentation caption band (compact) */
  .narrate { left: 50%; transform: translateX(-50%); width: min(1180px, calc(100% - 24px)); bottom: 12px; background: rgba(241,234,214,0.95); border: 1.5px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); padding: 9px 18px 10px; backdrop-filter: blur(6px); }
  .narrate.idle { width: min(760px, calc(100% - 24px)); }
  .n-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 3px; }
  .n-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(14px, 1.3vw, 17px); letter-spacing: -0.01em; }
  .n-phase { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; color: #fff; background: var(--accent-ink); border-radius: var(--radius-sharp); padding: 2px 8px; }
  .n-step { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.55); }
  .transport { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
  .transport > button { background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); width: 28px; height: 24px; cursor: pointer; color: var(--ink); font-size: 11px; line-height: 1; }
  .transport > button:hover:not(:disabled) { border-color: var(--ink); }
  .transport > button:disabled { opacity: 0.4; cursor: default; }
  .transport > .next-btn { width: auto; padding: 0 13px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; background: var(--ink); border-color: var(--ink); color: var(--paper, #f1ead6); }
  .transport > .next-btn:hover { background: #000; }
  .transport > .next-btn.ready { animation: next-nudge 2.4s ease-in-out infinite; }
  @keyframes next-nudge {
    0%, 100% { background: var(--ink); border-color: var(--ink); }
    50% { background: var(--accent-ink); border-color: var(--accent-ink); }
  }
  .n-text { margin: 0; font-family: 'Fraunces', serif; font-size: clamp(14px, 1.25vw, 17px); line-height: 1.4; color: rgba(28,22,17,0.88); max-width: 120ch; }

  /* counters */
  .counters { top: 54px; right: 12px; display: flex; flex-direction: column; gap: 6px; }
  .ct { background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); padding: 6px 11px; text-align: right; min-width: 120px; backdrop-filter: blur(4px); }
  .ct b { display: block; font-family: 'Fraunces', serif; font-size: clamp(18px, 1.7vw, 26px); line-height: 1.1; }
  .ct span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .ct.hot { border-color: rgba(196,87,10,0.6); }
  .ct.hot b { color: var(--accent, #c4570a); }
  .counters-inline { display: none; }

  /* inspector — top-left, so it never collides with the counters + rail on the right */
  .inspector { left: 12px; top: 54px; width: 252px; background: rgba(241,234,214,0.96); border: 1.5px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); padding: 12px 14px; }
  .inspector h4 { font-family: 'Fraunces', serif; font-size: 16px; margin: 0 0 2px; }
  .i-sub { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.55); }
  .i-stats { display: flex; gap: 12px; margin: 8px 0 2px; font-size: 12px; }
  .i-stats b { font-family: 'Fraunces', serif; }
  .inspector p { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); margin: 6px 0 0; }
  .inspector .close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: rgba(28,22,17,0.5); cursor: pointer; font-size: 13px; }
  .inspector .close:hover { color: var(--ink); }

  /* under-canvas: log + contract (page is full-bleed, so this constrains itself) */
  .under { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 14px; align-items: start; max-width: 1240px; margin: 16px auto 0; padding: 0 clamp(16px, 3vw, 40px); }
  .counters-inline { max-width: 1240px; margin-inline: auto; padding: 0 clamp(16px, 3vw, 40px); }
  .log-wrap { border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); padding: 10px 12px; }
  .log { max-height: 300px; overflow-y: auto; }
  .log-empty { font-size: 12px; color: rgba(28,22,17,0.5); font-style: italic; }
  .log-row { display: flex; gap: 8px; align-items: baseline; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 3px 6px; border-left: 2px solid transparent; }
  .log-row:nth-child(odd) { background: rgba(28,22,17,0.028); }
  .l-clock { color: rgba(28,22,17,0.45); flex: 0 0 auto; }
  .l-kind { flex: 0 0 62px; text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.06em; padding-top: 1px; }
  .l-text { color: rgba(28,22,17,0.8); min-width: 0; }
  .l-sig { margin-left: auto; color: rgba(28,22,17,0.35); flex: 0 0 auto; }
  .log-row.contract { border-left-color: var(--accent-ink); } .log-row.contract .l-kind { color: var(--accent-ink); }
  .log-row.verify .l-kind { color: rgba(28,22,17,0.55); }
  .log-row.compute .l-kind { color: rgba(28,22,17,0.55); }
  .log-row.return { border-left-color: #2f7d4f; } .log-row.return .l-kind { color: #2f7d4f; }
  .log-row.refuse { border-left-color: #8a2d3a; background: rgba(138,45,58,0.05); } .log-row.refuse .l-kind { color: #8a2d3a; }
  .log-row.audit { border-left-color: #b0892a; } .log-row.audit .l-kind { color: #b0892a; }
  .log-row.info .l-kind { color: rgba(28,22,17,0.45); }

  .side-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .contract { border: 1.5px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: var(--accent-ink-tint-06, rgba(14,91,102,0.06)); }
  .c-head { display: flex; width: 100%; align-items: center; justify-content: space-between; background: none; border: none; cursor: pointer; padding: 10px 12px 6px; }
  .c-head .p-lab { margin: 0; color: var(--accent-ink); }
  .c-chev { font-size: 10px; color: var(--accent-ink); transition: transform 0.15s; }
  .c-chev.open { transform: rotate(180deg); }
  .contract dl { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 3px 10px; margin: 0; padding: 2px 12px 12px; }
  .contract dt { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); padding-top: 2px; }
  .contract dd { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.82); }

  .counterfactual { border: 1px solid rgba(138,45,58,0.4); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(138,45,58,0.045); padding: 10px 12px; }
  .counterfactual .p-lab { color: #8a2d3a; }
  .counterfactual p { font-size: 12px; line-height: 1.5; margin: 3px 0; color: rgba(28,22,17,0.78); }
  .counterfactual .cf-note { font-style: italic; color: rgba(28,22,17,0.62); }

  .lesson { border: 1px solid rgba(28,22,17,0.18); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 10px 12px; }
  .lesson p { font-size: 12.5px; line-height: 1.55; margin: 0; color: rgba(28,22,17,0.8); }

  .legend { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 10px 12px; }
  .legend ul { list-style: none; margin: 0; padding: 0; }
  .legend li { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(28,22,17,0.75); padding: 2px 0; }
  .legend i { width: 10px; height: 10px; border-radius: var(--radius-pill); flex: 0 0 10px; }
  .lg-note { font-size: 11px; color: rgba(28,22,17,0.55); font-style: italic; margin: 8px 0 0; }

  .i-src { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); margin-top: 4px; }

  /* standalone corner overlays — everything on-canvas, nothing scrolls the page */
  /* top-left: the central-store counterfactual + the scenario explainer (or legend) */
  .info-tl { top: 54px; left: 12px; width: min(312px, 31vw); max-height: calc(100% - 210px); overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .info-tl :global(.counterfactual), .info-tl :global(.lesson), .info-tl :global(.legend) { background: rgba(241,234,214,0.95); backdrop-filter: blur(6px); }

  /* bottom-left: exchange log + query contract — collapsed to a bar, expands UPWARD */
  .lograil { left: 12px; bottom: 76px; width: min(342px, 42vw); display: flex; flex-direction: column; z-index: 8; }
  .lograil-body { display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; background: rgba(241,234,214,0.96); border: 1px solid rgba(28,22,17,0.22); border-bottom: none; border-radius: var(--radius-round) var(--radius-round) 0 0; padding: 10px 10px 6px; backdrop-filter: blur(6px); }
  .lograil-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; background: rgba(241,234,214,0.96); border: 1px solid rgba(28,22,17,0.24); border-radius: var(--radius-round); cursor: pointer; padding: 9px 12px; backdrop-filter: blur(6px); }
  .lograil.open .lograil-toggle { border-radius: 0 0 var(--radius-round) var(--radius-round); border-top: none; }
  .lograil-toggle .p-lab { margin: 0; }
  .lograil-body :global(.log-wrap) { border: none; background: none; padding: 0; }
  .lograil-body :global(.log) { max-height: 28vh; }

  /* inspector: default top-left (deck); standalone moves it bottom-right, clear of the corners */
  .inspector { z-index: 9; }
  .inspector.sa { top: auto; left: auto; bottom: 76px; right: 12px; }

  /* labels rendered by CSS2DRenderer live outside Svelte's scope */
  :global(.fed-label) { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.72); text-shadow: 0 0 6px rgba(239,231,213,0.9); white-space: nowrap; }
  :global(.fed-label.sup.major) { font-size: 10.5px; font-weight: 600; color: rgba(28,22,17,0.9); }
  :global(.fed-label.con) { color: rgba(14,91,102,0.95); font-weight: 600; }
  :global(.fed-label.ledger) { color: rgba(176,137,42,1); }
  :global(.fed-label.ring) { color: rgba(28,22,17,0.4); letter-spacing: 0.22em; font-size: 8px; }
  :global(.fed-label.central) { color: #8a2d3a; font-weight: 600; font-size: 11px; }
  :global(.fed-label.store) { color: rgba(138,84,80,1); font-size: 8.5px; }
  :global(.fed-label.edt) { color: rgba(125,110,88,0.95); font-size: 8px; letter-spacing: 0.08em; }
  :global(.fed-label.agg) { color: rgba(74,84,96,1); font-weight: 600; font-size: 8.5px; letter-spacing: 0.08em; }
  :global(.fed-label .l-reach) { font-size: 7.5px; letter-spacing: 0.03em; color: rgba(28,22,17,0.6); font-weight: 500; margin-top: 1px; }
  :global(.fed-label.la) { color: rgba(47,107,115,0.98); font-weight: 600; font-size: 8.5px; }
  :global(.fed-label.la.cross) { color: rgba(154,106,47,1); }
  :global(.fed-label.resolver) { color: rgba(168,90,42,1); font-weight: 700; font-size: 9px; letter-spacing: 0.14em; }
  :global(.fed-label.registry) { color: rgba(20,105,115,1); font-weight: 600; font-size: 8.5px; }
  :global(.fed-label.spine-lab) { color: rgba(20,105,115,1); font-weight: 700; font-size: 9.5px; letter-spacing: 0.18em; text-shadow: 0 0 8px rgba(239,231,213,0.95); }

  @media (max-width: 900px) {
    .info-tl, .lograil { display: none; }
  }

  /* mid widths: the top bar can wrap to two rows, so drop the corner panels clear of it */
  @media (min-width: 901px) and (max-width: 1240px) {
    .counters { top: 96px; }
    .inspector { top: 96px; }
    .info-tl { top: 96px; max-height: calc(100% - 250px); }
  }

  @media (max-width: 900px) {
    .sim-shell { height: max(480px, calc(100svh - var(--topH, 56px) - 50px)); }
    .narrate, .narrate.idle { width: calc(100% - 16px); padding: 8px 12px 9px; }
    .n-text { font-size: 13.5px; }
    .n-title { font-size: 15px; }
    .sc-select { max-width: none; flex: 1 1 100%; }
    .counters { display: none; }
    .counters-inline { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .counters-inline .ct { min-width: 0; flex: 1 1 30%; padding: 4px 8px; text-align: left; }
    .counters-inline .ct b { font-size: 14px; }
    .inspector, .inspector.sa { top: auto; bottom: 88px; left: 8px; right: 8px; width: auto; }
    .under { grid-template-columns: 1fr; }
  }
</style>
