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
  let speed = $state(1);
  let mode = $state<'federated' | 'central'>('federated');
  let edtechOn = $state(false);
  // the single source of truth for what is (or was just) playing — catalogue
  // scenarios and generated ask-the-federation scenarios alike
  let activeScenario = $state<Scenario | null>(null);
  const activeId = $derived(activeScenario?.id ?? null);
  let logEntries = $state<LogEntry[]>([]);
  let counters = $state<Record<CounterKey, number>>({ exchanges: 0, pupilRecordsMoved: 0, aggregatesReturned: 0, refusals: 0, auditEntries: 0 });
  let inspectorNode = $state<NetNode | null>(null);
  let inspectorSchool = $state<SchoolInfo | null>(null);
  let contractOpen = $state(true);
  let pickerOpen = $state(false); // mobile scenario drawer
  let canFullscreen = $state(false);
  let isFullscreen = $state(false);
  let catalogue = $state<'scenarios' | 'joins'>('scenarios'); // catalogue tab
  let logOpen = $state(true); // standalone overlay log collapse


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
        if (s && (s.usesEdtech ?? touchesEdtech(s)) && !edtechOn) setEdtech(true);
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
    pickerOpen = false;
    engine.loadScenario(s);
    if (!standalone) shell?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** run a cross-context join: build the scenario from the join catalogue and play it */
  export function runJoin(q: JoinQuery) {
    runScenario(buildJoinScenario(runJoinQuery(q)));
  }

  const JOIN_CHIP: Record<string, string> = { current: 'today', emerging: 'new law', future: 'frontier' };

  function setEdtech(on: boolean) {
    edtechOn = on;
    sceneHandle?.setEdtech(on);
    if (engine) engine.edtechActive = on;
  }

  function togglePlay() {
    if (!engine) return;
    if (ended && activeScenario) { engine.restart(); return; }
    engine.toggle();
    playing = engine.playing;
  }
  function stepFwd() { engine?.stepForward(); }
  function restart() { engine?.restart(); }
  function stopScenario() { engine?.stop(); }
  function setSpeed(x: number) { speed = x; engine?.setSpeed(x); }
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
    <!-- top bar: mode + view -->
    <div class="hud top">
      <div class="mode-seg" role="group" aria-label="Architecture mode">
        <button class:on={mode === 'federated'} onclick={() => setMode('federated')} title="Federated exchange — records stay at source; queries travel.">Federated</button>
        <button class:on={mode === 'central'} class="danger" onclick={() => setMode('central')} title="Central store counterfactual — everything copied to one national database.">Central store</button>
      </div>
      <button class="ghost" class:lit={edtechOn} onclick={() => setEdtech(!edtechOn)} title="Toggle the edtech tendrils — real platforms imagined as certified spurs on the exchange">
        ◇ edtech ring{edtechOn ? ' · on' : ''}
      </button>
      <button class="ghost" onclick={() => sceneHandle?.resetView()} title="Reset the camera">⌂ view</button>
      {#if canFullscreen}
        <button class="ghost" onclick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Fill the screen'}>
          {isFullscreen ? '⤡ exit' : '⛶ full screen'}
        </button>
      {/if}
      {#if !embed}
        <button class="ghost picker-toggle" onclick={() => (pickerOpen = !pickerOpen)} aria-expanded={pickerOpen}>☰ scenarios</button>
      {/if}
    </div>

    <!-- scenario browser (hidden in deck-embed mode: slides drive scenarios) -->
    {#if !embed}
    <aside class="hud panel scenarios" class:open={pickerOpen}>
      <div class="cat-tabs" role="tablist">
        <button role="tab" class:on={catalogue === 'scenarios'} onclick={() => (catalogue = 'scenarios')}>Scenarios</button>
        <button role="tab" class:on={catalogue === 'joins'} onclick={() => (catalogue = 'joins')}>Joins ✦</button>
      </div>
      {#if catalogue === 'scenarios'}
        {#each SCENARIO_GROUPS as g}
          <div class="sc-group">
            <span class="sc-g">{g}</span>
            {#each SCENARIOS.filter((s) => s.group === g) as s}
              <button class="sc-item" class:on={activeId === s.id} onclick={() => run(s.id)} title={s.tagline}>{s.title}</button>
            {/each}
          </div>
        {/each}
      {:else}
        <p class="cat-note">Questions that join <b>two context spaces</b> — schools × local authorities (and, at the frontier, health). Each returns a match confidence, not a certainty.</p>
        {#each JOIN_GROUPS as g}
          <div class="sc-group">
            <span class="sc-g">{g.label}</span>
            {#each JOIN_QUERIES.filter((q) => q.horizon === g.key) as q}
              <button class="sc-item join" class:on={activeId === `join-${q.id}`} onclick={() => runJoin(q)} title={q.question}>
                <span class="ji-q">{q.question}</span>
                <span class="ji-meta">
                  <em class="ji-diff {q.difficulty}">{q.difficulty}</em>
                  {#if q.singleContext}<em class="ji-base">baseline</em>{:else}<em class="ji-h">{JOIN_CHIP[q.horizon]}</em>{/if}
                </span>
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </aside>
    {/if}

    <!-- transport + narration -->
    <div class="hud narrate">
      {#if activeScenario}
        <div class="n-head">
          <span class="n-title">{activeScenario.title}</span>
          {#if phase}<span class="n-phase">{phase}</span>{/if}
          {#if stepCount}<span class="n-step">{stepIndex}/{stepCount}</span>{/if}
          {#if awaitingNext}<span class="n-hint">stage repeats every 5 s</span>{/if}
          <div class="transport">
            {#if !ended}
              <button class="next-btn" class:ready={awaitingNext} onclick={stepFwd} title="Advance to the next stage">
                {stepIndex >= stepCount ? 'Finish' : 'Next stage'} ▸
              </button>
            {/if}
            <button onclick={togglePlay} title={ended ? 'Replay' : playing ? 'Pause' : 'Play'}>{ended ? '↺' : playing ? '❚❚' : '▶'}</button>
            <button onclick={restart} title="Restart">⟲</button>
            <button onclick={stopScenario} title="Exit scenario">✕</button>
            <span class="speed">
              {#each [1, 2, 3] as x}
                <button class:on={speed === x} onclick={() => setSpeed(x)}>{x}×</button>
              {/each}
            </span>
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
      <aside class="hud panel inspector">
        <button class="close" onclick={() => { inspectorNode = null; inspectorSchool = null; }} aria-label="Close">✕</button>
        {#if inspectorNode}
          <span class="p-lab">
            {inspectorNode.kind === 'store' ? 'DfE estate · existing store'
              : inspectorNode.kind === 'edtech' ? 'edtech tendril · imagined'
              : inspectorNode.kind === 'la' ? (inspectorNode.sector === 'cross' ? 'cross-sector world' : 'local-authority data')
              : inspectorNode.kind === 'resolver' ? 'identity resolver'
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

{#snippet sideStack()}
  <div class="side-stack">
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
        </ul>
        <p class="lg-note">Drag to orbit · scroll to zoom · click any structure or dot to inspect it.</p>
      </div>
    {/if}
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

<!-- standalone one-screen: log + contract are on-canvas overlays -->
{#if ready && standalone}
  <aside class="hud rail" class:collapsed={!logOpen}>
    <button class="rail-toggle" onclick={() => (logOpen = !logOpen)} aria-expanded={logOpen}>
      <span class="p-lab">Exchange log &amp; contract</span>
      <span class="c-chev" class:open={logOpen}>▾</span>
    </button>
    {#if logOpen}
      <div class="rail-body">
        {@render exchangeLog()}
        {@render sideStack()}
      </div>
    {/if}
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
  .top { top: 10px; left: 12px; right: 12px; display: flex; gap: 8px; align-items: center; }
  .mode-seg { display: inline-flex; background: rgba(241,234,214,0.92); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.25); backdrop-filter: blur(4px); }
  .mode-seg button { background: transparent; border: none; color: var(--ink); padding: 6px 12px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .mode-seg button.on { background: var(--accent-ink); color: #fff; }
  .mode-seg button.danger.on { background: #8a2d3a; }
  .ghost { background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 7px 11px; cursor: pointer; backdrop-filter: blur(4px); }
  .ghost:hover { border-color: rgba(28,22,17,0.5); }
  .ghost.lit { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .picker-toggle { display: none; margin-left: auto; }

  /* scenario browser */
  .scenarios { top: 54px; left: 12px; bottom: 118px; width: 218px; overflow-y: auto; background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); padding: 12px 12px 10px; backdrop-filter: blur(5px); }
  .sc-group { margin-bottom: 10px; }
  .sc-g { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); margin: 4px 0; }
  .sc-item { display: block; width: 100%; text-align: left; background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); color: var(--ink); font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 500; padding: 6px 9px; margin: 3px 0; cursor: pointer; }
  .sc-item:hover { border-color: rgba(28,22,17,0.45); }
  .sc-item.on { background: var(--ink); color: var(--paper, #f1ead6); border-color: var(--ink); }

  /* narration + transport — the presentation caption band */
  .narrate { left: 50%; transform: translateX(-50%); width: min(1240px, calc(100% - 24px)); bottom: 14px; background: rgba(241,234,214,0.95); border: 1.5px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); padding: 14px 22px 16px; backdrop-filter: blur(6px); }
  .n-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
  .n-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(17px, 1.8vw, 24px); letter-spacing: -0.01em; }
  .n-phase { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; color: #fff; background: var(--accent-ink); border-radius: var(--radius-sharp); padding: 3px 9px; }
  .n-step { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(28,22,17,0.55); }
  .transport { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
  .transport > button { background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); width: 30px; height: 26px; cursor: pointer; color: var(--ink); font-size: 11px; line-height: 1; }
  .transport > button:hover:not(:disabled) { border-color: var(--ink); }
  .transport > button:disabled { opacity: 0.4; cursor: default; }
  .transport > .next-btn { width: auto; padding: 0 14px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; background: var(--ink); border-color: var(--ink); color: var(--paper, #f1ead6); }
  .transport > .next-btn:hover { background: #000; }
  .transport > .next-btn.ready { animation: next-nudge 2.4s ease-in-out infinite; }
  @keyframes next-nudge {
    0%, 100% { background: var(--ink); border-color: var(--ink); }
    50% { background: var(--accent-ink); border-color: var(--accent-ink); }
  }
  .n-hint { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .speed { display: inline-flex; background: rgba(28,22,17,0.07); border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); padding: 1px; margin-left: 4px; }
  .speed button { background: transparent; border: none; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; padding: 4px 7px; cursor: pointer; color: var(--ink); border-radius: var(--radius-round); }
  .speed button.on { background: var(--ink); color: #fff; }
  .n-text { margin: 0; font-family: 'Fraunces', serif; font-size: clamp(16px, 1.7vw, 23px); line-height: 1.42; color: rgba(28,22,17,0.88); max-width: 110ch; }

  /* counters */
  .counters { top: 54px; right: 12px; display: flex; flex-direction: column; gap: 6px; }
  .ct { background: rgba(241,234,214,0.92); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); padding: 6px 11px; text-align: right; min-width: 120px; backdrop-filter: blur(4px); }
  .ct b { display: block; font-family: 'Fraunces', serif; font-size: clamp(18px, 1.7vw, 26px); line-height: 1.1; }
  .ct span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .ct.hot { border-color: rgba(196,87,10,0.6); }
  .ct.hot b { color: var(--accent, #c4570a); }
  .counters-inline { display: none; }

  /* inspector */
  .inspector { right: 12px; bottom: 118px; width: 250px; background: rgba(241,234,214,0.96); border: 1.5px solid rgba(28,22,17,0.3); border-radius: var(--radius-round); padding: 12px 14px; }
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

  /* catalogue tabs + join items */
  .cat-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .cat-tabs button { flex: 1; background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 4px; cursor: pointer; color: var(--ink); }
  .cat-tabs button.on { background: var(--ink); color: var(--paper, #f1ead6); border-color: var(--ink); }
  .cat-note { font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.66); margin: 0 0 8px; }
  .cat-note b { color: var(--ink); }
  .sc-item.join { display: flex; flex-direction: column; gap: 5px; align-items: stretch; padding: 8px 9px; }
  .ji-q { font-size: 12px; line-height: 1.3; }
  .ji-meta { display: flex; gap: 5px; flex-wrap: wrap; }
  .ji-meta em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 5px; border-radius: var(--radius-sharp); }
  .ji-diff.hard { background: rgba(138,45,58,0.14); color: #8a2d3a; }
  .ji-diff.medium { background: rgba(176,137,42,0.18); color: #8a6a1a; }
  .ji-diff.easy { background: rgba(47,125,79,0.14); color: #2f7d4f; }
  .ji-h, .ji-base { background: rgba(28,22,17,0.08); color: rgba(28,22,17,0.6); }
  .sc-item.join.on .ji-q { color: var(--paper, #f1ead6); }
  .sc-item.join.on em { opacity: 0.92; }

  /* standalone right rail: exchange log + contract as an on-canvas overlay */
  .rail { top: 250px; right: 12px; bottom: 116px; width: min(330px, 42vw); display: flex; flex-direction: column; background: rgba(241,234,214,0.94); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); backdrop-filter: blur(5px); overflow: hidden; }
  .rail.collapsed { bottom: auto; }
  .rail-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; background: none; border: none; cursor: pointer; padding: 9px 12px; }
  .rail-toggle .p-lab { margin: 0; }
  .rail-body { overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 8px; }
  .rail-body :global(.log-wrap), .rail-body :global(.side-stack) { border: none; background: none; padding: 0; }
  .rail-body :global(.log) { max-height: 32vh; }
  .inspector { z-index: 9; }

  /* labels rendered by CSS2DRenderer live outside Svelte's scope */
  :global(.fed-label) { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.72); text-shadow: 0 0 6px rgba(239,231,213,0.9); white-space: nowrap; }
  :global(.fed-label.sup.major) { font-size: 10.5px; font-weight: 600; color: rgba(28,22,17,0.9); }
  :global(.fed-label.con) { color: rgba(14,91,102,0.95); font-weight: 600; }
  :global(.fed-label.ledger) { color: rgba(176,137,42,1); }
  :global(.fed-label.ring) { color: rgba(28,22,17,0.4); letter-spacing: 0.22em; font-size: 8px; }
  :global(.fed-label.central) { color: #8a2d3a; font-weight: 600; font-size: 11px; }
  :global(.fed-label.store) { color: rgba(138,84,80,1); font-size: 8.5px; }
  :global(.fed-label.edt) { color: rgba(125,110,88,0.95); font-size: 8px; letter-spacing: 0.08em; }
  :global(.fed-label.la) { color: rgba(47,107,115,0.98); font-weight: 600; font-size: 8.5px; }
  :global(.fed-label.la.cross) { color: rgba(154,106,47,1); }
  :global(.fed-label.resolver) { color: rgba(168,90,42,1); font-weight: 700; font-size: 9px; letter-spacing: 0.14em; }

  @media (max-width: 900px) {
    .rail { display: none; }
  }

  @media (max-width: 900px) {
    .sim-shell { height: max(480px, calc(100svh - var(--topH, 56px) - 50px)); }
    .narrate { padding: 10px 14px 12px; }
    .n-text { font-size: 14px; }
    .n-title { font-size: 16px; }
    .picker-toggle { display: inline-block; }
    .scenarios { display: none; }
    .scenarios.open { display: block; width: min(260px, 78vw); z-index: 8; }
    .counters { display: none; }
    .counters-inline { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .counters-inline .ct { min-width: 0; flex: 1 1 30%; padding: 4px 8px; text-align: left; }
    .counters-inline .ct b { font-size: 14px; }
    .inspector { bottom: auto; top: 54px; }
    .under { grid-template-columns: 1fr; }
  }
</style>
