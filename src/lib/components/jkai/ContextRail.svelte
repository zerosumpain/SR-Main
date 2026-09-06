<script lang="ts">
  /**
   * The thread inspector — /jkai chat's right-hand column.
   *
   * It answers three different questions, and they are peers rather than a
   * hierarchy:
   *
   *   CONTEXT   what this thread is ABOUT   — the classifier's lens, its cards,
   *                                           and the thread's knowledge graph
   *   ACTIVITY  what it is DOING            — workers, tool calls, builds
   *   LEDGER    what it has COST            — spend, context window, model
   *   MEMORY    what it CARRIES IN          — what jkai was given, what the
   *                                           thread wrote, what went stale
   *
   * Only the first was ever drawn here. The other two existed as numbers the
   * chat pane already owned and had nowhere to put: the ledger went to the hub
   * header, the workers to a tray inside the transcript, the spend to a link in
   * a footer. Giving them a mode each is what turns the column from a widget
   * into an instrument — and the whole column now shares ONE grammar (mono
   * eyebrow, hairline rule, cell) instead of the three registers it had grown:
   * a gradient header, floating cards, and an embedded rail with its own
   * head and foot.
   *
   * TWO TIERS of navigation, deliberately. The mode keys pick the question; the
   * lens strip, which only exists under CONTEXT, picks which reading of the
   * thread answers it. They are drawn as mirror images — the lit mode key takes
   * an accent bar on its top edge, the lit lens key on its bottom — so the
   * subordinate one is legible as subordinate.
   *
   * ACTIVITY raises itself while a turn is in flight and settles back when the
   * turn ends. That is the only automatic behaviour here, and it yields the
   * instant the user touches the picker: a panel that overrides a deliberate
   * choice is a panel you stop trusting.
   *
   * Layout rule: the CHROME never scrolls. Head, mode keys, lens strip, focus
   * and the foot readout are pinned; exactly one cell scrolls.
   */
  import { untrack } from 'svelte';
  import { contextPanelSchema, type ContextLens, type ContextPanel } from '$lib/jkai/context-panel/types';
  import { hub } from '$lib/jkai/hub-bus.svelte';
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import { shortModelLabel } from '$lib/jkai/model-label';
  import type { TraceStep } from '$lib/jkai/tool-trace';
  import ContextCard from './context/ContextCard.svelte';
  import ContextDrillModal from './context/ContextDrillModal.svelte';
  import MemoryMode from './context/MemoryMode.svelte';
  import ThreadGraphCard from './ThreadGraphCard.svelte';
  import { bumpGraphRevision } from '$lib/jkai/hub-bus.svelte';

  let { conversationId, sheetDetent = 'closed', onCloseSheet }: {
    conversationId: string | null;
    /** Phone bottom sheet: closed hides it, peek is a short detent, full is the
     *  desktop column's content. Ignored on desktop. */
    sheetDetent?: 'closed' | 'peek' | 'full';
    onCloseSheet?: () => void;
  } = $props();

  // ── Mode ──────────────────────────────────────────────────────────────────

  type Mode = 'context' | 'activity' | 'ledger' | 'memory';
  const MODE_STORAGE_KEY = 'jkai.inspectorMode';
  const MODES: { key: Mode; label: string }[] = [
    { key: 'context', label: 'Context' },
    { key: 'activity', label: 'Activity' },
    { key: 'ledger', label: 'Ledger' },
    { key: 'memory', label: 'Memory' },
  ];

  function storedMode(): Mode {
    try {
      const v = localStorage.getItem(MODE_STORAGE_KEY);
      if (v === 'context' || v === 'activity' || v === 'ledger' || v === 'memory') return v;
    } catch {
      // Private mode / storage disabled — the default is a fine answer.
    }
    return 'context';
  }

  let mode = $state<Mode>('context');
  let modeHydrated = false;

  /**
   * Where to return when the turn ends, and the timer that does it. Both are
   * plain `let`s on purpose: nothing reactive reads them, and as `$state` the
   * scheduling below would re-trigger the effect that schedules it — the
   * effect-reads-its-own-write loop this codebase keeps rediscovering.
   */
  let restoreTo: Mode | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const SETTLE_MS = 2500;

  function pickMode(next: Mode): void {
    // A deliberate choice outranks the auto-surface, for good.
    restoreTo = null;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    mode = next;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is no reason to refuse it.
    }
  }

  const activity = $derived(hub.activity);

  $effect(() => {
    // Tracked: whether a turn is in flight. Everything else — including every
    // read of `mode`, which this effect also writes — is untracked.
    const streaming = activity.streaming;
    untrack(() => {
      if (!modeHydrated) {
        modeHydrated = true;
        mode = storedMode();
      }
      if (streaming) {
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        if (mode !== 'activity') {
          restoreTo = mode;
          mode = 'activity';
        }
        return;
      }
      if (!restoreTo) return;
      const back = restoreTo;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        // Re-check: the user may have picked a mode while this was pending, in
        // which case `restoreTo` is null and their choice stands.
        if (restoreTo === back && mode === 'activity') mode = back;
        restoreTo = null;
      }, SETTLE_MS);
    });
  });

  $effect(() => () => {
    if (settleTimer) clearTimeout(settleTimer);
  });

  // ── Context panel (lenses + cards) ────────────────────────────────────────
  // Unchanged behaviour: the classifier picks a lens from the thread, the user
  // may override it, and the override is remembered per conversation.

  let panel = $state<ContextPanel | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let manualLens = $state<ContextLens | null>(null);
  let loadedKey = '';
  let lensConversationId: string | null = null;
  let sequence = 0;

  const orderedLenses = $derived(
    panel?.lenses.slice().sort((a, b) =>
      a.id === 'general' ? -1 : b.id === 'general' ? 1 : b.score - a.score,
    ) ?? [],
  );

  async function load(id: string, lens: ContextLens | null) {
    const seq = ++sequence;
    loading = true;
    error = null;
    try {
      const query = lens ? `?lens=${lens}` : '';
      const response = await fetch(`/api/jkai/conversations/${id}/context-panel${query}`);
      if (!response.ok) throw new Error(`Context panel returned ${response.status}`);
      const parsed = contextPanelSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Context panel returned an invalid manifest');
      if (seq === sequence) panel = parsed.data;
    } catch (cause) {
      if (seq === sequence) error = cause instanceof Error ? cause.message : 'Context panel unavailable';
    } finally {
      if (seq === sequence) loading = false;
    }
  }

  $effect(() => {
    const id = conversationId;
    const revision = hub.graphRevision;
    if (id !== lensConversationId) {
      lensConversationId = id;
      try {
        const stored = id ? localStorage.getItem(`jkai.contextLens.${id}`) : null;
        const parsed = contextPanelSchema.shape.selectedLens.safeParse(stored);
        manualLens = parsed.success ? parsed.data : null;
      } catch {
        manualLens = null;
      }
      loadedKey = '';
    }
    const key = `${id ?? ''}:${revision}:${manualLens ?? 'auto'}`;
    if (key === loadedKey) return;
    loadedKey = key;
    if (!id) { panel = null; return; }
    void load(id, manualLens);
  });

  function selectLens(lens: ContextLens) {
    manualLens = lens === panel?.automaticLens ? null : lens;
    if (!conversationId) return;
    try {
      if (manualLens) localStorage.setItem(`jkai.contextLens.${conversationId}`, manualLens);
      else localStorage.removeItem(`jkai.contextLens.${conversationId}`);
    } catch {
      // Storage is an enhancement; the in-memory selection still works.
    }
  }

  function askAbout(label: string, detail: string) {
    window.dispatchEvent(new CustomEvent('jkai:context-prompt', {
      detail: { conversationId, text: `Use the selected context from the side panel:\n${detail}\n\n${label}` },
    }));
  }

  // ── Drill ─────────────────────────────────────────────────────────────────
  // A double-click on any tile or row, or the card's title, opens ONE modal
  // with a server-composed manifest for that target. The rail only holds the
  // key; what it means is the drill composer's business.

  let drillTarget = $state<string | null>(null);
  /** Bumped after a memory action in the drill so the MEMORY mode re-reads. */
  let memoryRevision = $state(0);

  function openDrill(target: string): void {
    drillTarget = target;
  }

  function refreshAfterDrill(what: 'panel' | 'graph' | 'memory'): void {
    if (what === 'graph') {
      bumpGraphRevision();
      return;
    }
    if (what === 'memory') {
      memoryRevision += 1;
      return;
    }
    if (conversationId) void load(conversationId, manualLens);
  }

  /** The graph is a reading of the thread's entities, so it belongs to the two
   *  lenses that are about entities. Same rule as before the redesign. */
  const showGraph = $derived(panel?.selectedLens === 'intel' || panel?.selectedLens === 'general');

  // ── Live clock ────────────────────────────────────────────────────────────
  // One ticker for every elapsed figure. `id` is a local const, never $state:
  // the effect writes `now` and does not read it.

  let now = $state(Date.now());
  const workersRunning = $derived(activity.workers.some((w) => w.status === 'running'));
  const clockNeeded = $derived(activity.streaming || workersRunning);

  $effect(() => {
    if (!clockNeeded) return;
    const id = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  /** Elapsed of the turn in flight, and the duration of the last one to finish
   *  — so a settled panel still says how long the work took. */
  let turnStartedAt = $state<number | null>(null);
  let lastTurnMs = $state<number | null>(null);

  $effect(() => {
    const streaming = activity.streaming;
    untrack(() => {
      if (streaming) {
        if (turnStartedAt === null) {
          turnStartedAt = Date.now();
          lastTurnMs = null;
        }
        return;
      }
      if (turnStartedAt !== null) {
        lastTurnMs = Date.now() - turnStartedAt;
        turnStartedAt = null;
      }
    });
  });

  function elapsed(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '';
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  const turnElapsed = $derived(
    turnStartedAt !== null ? elapsed(now - turnStartedAt) : elapsed(lastTurnMs),
  );

  // ── Activity ──────────────────────────────────────────────────────────────

  /**
   * Two hues, not fourteen. A tool either READS the world or ACTS on it, and
   * that is the only distinction worth a colour here — petrol for reads,
   * burnt-orange for anything that changes something. The category words come
   * from `categorizeTool`, which the chat pane has already run.
   */
  const ACTING_CATEGORIES = new Set(['RUN', 'MSG', 'CANVAS', 'AGENT', 'MEM', 'SCHED', 'FORGE', 'SETUP']);
  function stepTone(category: string): 'act' | 'read' | 'plain' {
    if (ACTING_CATEGORIES.has(category)) return 'act';
    return category === 'TOOL' ? 'plain' : 'read';
  }

  const stepsRunning = $derived(activity.steps.filter((s) => s.status === 'running').length);
  const stepsFailed = $derived(activity.steps.filter((s) => s.status === 'error').length);
  const workersDone = $derived(activity.workers.filter((w) => w.status !== 'running').length);
  const hasActivity = $derived(
    activity.streaming ||
      activity.workers.length > 0 ||
      activity.steps.length > 0 ||
      activity.build !== null,
  );

  /** The badge on the ACTIVITY key: a count while there is live work, nothing
   *  when there is not. A badge that is always lit stops being a signal. */
  const activityBadge = $derived(
    activity.streaming || workersRunning || stepsRunning > 0
      ? Math.max(1, activity.workers.filter((w) => w.status === 'running').length + stepsRunning)
      : null,
  );

  /**
   * Opening a tool row.
   *
   * The published step carries a summary and a status and nothing else — enough
   * to read the chain, not enough to answer "what did it actually send". The
   * arguments and the result live in the recorded trace, which is fetched ONCE
   * per turn on the first click and cached here. Publishing them through the hub
   * bus instead would push a page of `web_extract` text into shared client state
   * on every token of every turn, to serve a click that usually never comes.
   *
   * Rows are addressed by index because that is what survives: the published
   * list and the recorded chain are the same steps in the same order, and a
   * restored step has no id of its own to match on.
   */
  let openStep = $state<number | null>(null);
  let traceSteps = $state<TraceStep[] | null>(null);
  let traceError = $state<string | null>(null);
  let traceLoading = $state(false);
  /** Which message id `traceSteps` describes — a plain let, nothing reads it
   *  reactively and as $state it would re-trigger the loader that writes it. */
  let tracedMessageId: string | null = null;

  async function toggleStep(i: number): Promise<void> {
    if (openStep === i) {
      openStep = null;
      return;
    }
    openStep = i;
    const id = activity.stepsMessageId;
    if (!id || tracedMessageId === id || traceLoading) return;
    traceLoading = true;
    traceError = null;
    try {
      const res = await fetch(`/api/jkai/trace/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'No recorded chain for this turn.' : `Trace returned ${res.status}`);
      const body = (await res.json()) as { trace?: { steps?: TraceStep[] } };
      traceSteps = body.trace?.steps ?? [];
      tracedMessageId = id;
    } catch (cause) {
      traceError = cause instanceof Error ? cause.message : 'Could not read the recorded chain.';
    } finally {
      traceLoading = false;
    }
  }

  function detailFor(i: number): TraceStep | null {
    return traceSteps?.[i] ?? null;
  }

  function preview(value: unknown, cap = 1200): string {
    if (value === undefined) return '';
    let text: string;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      return '[unserialisable]';
    }
    if (text === undefined) return '';
    return text.length > cap ? `${text.slice(0, cap)}\n… ${text.length - cap} more characters` : text;
  }

  /**
   * Chain analysis. It is an LLM call pinned to the SELFIMPROVE workload, so it
   * is never automatic — the endpoint also refuses to spend when the
   * deterministic pass finds no repeat, ladder or discovery pattern, and says so
   * rather than returning an empty answer.
   */
  let analysis = $state<{
    analysis?: { calls: number; discoveryCalls: number; discoveryShare: number; signals: unknown[] };
    findings?: Array<{ tool: string; calls: number; couldHaveBeen: number; cheaperRoute?: string; evidence: string; rationale: string }>;
    note?: string;
    error?: string;
    model?: string | null;
  } | null>(null);
  let analysing = $state(false);

  async function analyseChainNow(): Promise<void> {
    const id = activity.stepsMessageId ?? activity.traceId;
    if (!id || analysing) return;
    analysing = true;
    analysis = null;
    try {
      const res = await fetch(`/api/jkai/trace/${id}/analyse`, { method: 'POST' });
      analysis = await res.json();
    } catch (cause) {
      analysis = { error: cause instanceof Error ? cause.message : 'Analysis failed' };
    } finally {
      analysing = false;
    }
  }

  // A new turn invalidates whatever was open.
  $effect(() => {
    const id = activity.stepsMessageId;
    untrack(() => {
      if (id !== tracedMessageId) {
        openStep = null;
        traceSteps = null;
        traceError = null;
        analysis = null;
      }
    });
  });

  // ── Ledger ────────────────────────────────────────────────────────────────

  const contextPct = $derived(
    hub.contextFraction === null
      ? null
      : Math.max(0, Math.min(100, Math.round(hub.contextFraction * 100))),
  );
  /** The gauge only warms when the window is genuinely filling. Colouring it
   *  from zero would spend the alarm hue on the normal case. */
  const contextTone = $derived(
    contextPct === null ? 'idle' : contextPct >= 85 ? 'high' : contextPct >= 65 ? 'mid' : 'low',
  );
  const modelLabel = $derived(shortModelLabel(hub.modelId) || '—');

  function compactTokens(n: number | null): string {
    if (n === null || !Number.isFinite(n)) return '—';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    return `${(n / 1_000_000).toFixed(1)}m`;
  }

  const contextWindow = $derived(
    hub.contextTokens !== null && hub.contextFraction !== null && hub.contextFraction > 0
      ? Math.round(hub.contextTokens / hub.contextFraction)
      : null,
  );

  /** The per-turn series, newest last. Capped: 40 bars in 360px is already
   *  3px each, and past that the strip stops being readable as a series. */
  const TURN_BARS = 40;
  const turnCosts = $derived(hub.turnCostsUsd.slice(-TURN_BARS));
  /** Never zero — it is a divisor, and a thread of free turns is possible. */
  const peakTurnCost = $derived(Math.max(1e-9, ...turnCosts));

  /** Average cost per assistant turn — the figure that says whether a thread is
   *  expensive or merely long. */
  const costPerTurn = $derived(
    hub.threadCostUsd !== null && hub.turns !== null && hub.turns > 0
      ? hub.threadCostUsd / hub.turns
      : null,
  );
</script>

<aside class="inspector" data-detent={sheetDetent} data-mode={mode}>
  <button
    type="button"
    class="sheet-handle"
    onclick={onCloseSheet}
    aria-label="Close the thread inspector"
  ><span></span></button>

  <!-- Chrome 1 — the mode keys, and the panel's ONLY top row.
       Geometry is copied from `.tab-strip` in ConversationTabs — 40px on
       `--surface-rail`, closed with the same 2px ink rule — so the two columns
       share a baseline and the chrome reads as one bar across the page rather
       than two bars at different heights. There used to be a `THREAD` header
       above this; its three jobs each had a better home (the live state is the
       badge below and the Working cell inside ACTIVITY, and each mode's action
       moved onto the first cell it belongs to), and removing it is what let the
       row line up.
       The lit key takes the paper ground and an accent bar along its TOP edge,
       so which one is live survives a greyscale print. -->
  <div class="ins-modes" role="tablist" aria-label="Inspector mode">
    {#each MODES as m (m.key)}
      <button
        type="button"
        role="tab"
        id="ins-tab-{m.key}"
        class="ins-key"
        class:on={mode === m.key}
        aria-selected={mode === m.key}
        aria-controls="ins-panel"
        onclick={() => pickMode(m.key)}
      >
        <span>{m.label}</span>
        {#if m.key === 'activity' && activityBadge !== null}
          <span class="ins-badge" aria-label="{activityBadge} running">{activityBadge}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ══ CONTEXT ═════════════════════════════════════════════════════════ -->
  {#if mode === 'context'}
    {#if panel}
      <!-- Chrome 3 — the lens strip. Mirror of the mode keys above: sunken
           ground, and the lit key's accent bar on its BOTTOM edge, which is
           what makes it read as the subordinate tier rather than a second
           equal navigation. -->
      <nav class="ins-lenses" aria-label="Context lens">
        {#each orderedLenses as lens (lens.id)}
          <button
            type="button"
            class="ln-key"
            class:on={lens.id === panel.selectedLens}
            onclick={() => selectLens(lens.id)}
            title={lens.reason}
            aria-pressed={lens.id === panel.selectedLens}
          >
            <span class="ln-name">{lens.id}</span>
            <span class="ln-score" aria-label="{Math.round(lens.score * 100)} per cent match">
              {Math.round(lens.score * 100)}
            </span>
          </button>
        {/each}
      </nav>

      <!-- Chrome 4 — the classifier's reading, in one cell. This replaced a
           92px gradient header whose job was the same sentence. -->
      <div class="ins-focus">
        <div class="fc-top">
          <span class="ins-eyebrow">
            Focus{panel.selectedLens === panel.automaticLens ? '' : ' · pinned'}
          </span>
          <button
            type="button"
            class="ins-act"
            onclick={() => conversationId && load(conversationId, manualLens)}
            title="Re-read the thread"
            disabled={loading || !conversationId}
          >{loading ? 'reading…' : 'refresh ↻'}</button>
        </div>
        <strong class="fc-label" title={panel.focus.label}>{panel.focus.label}</strong>
        <span class="fc-reason">{panel.focus.reason}</span>
        <span class="fc-mark" aria-hidden="true">J/A</span>
      </div>
    {/if}

    <div class="ins-scroll" id="ins-panel" role="tabpanel" tabindex="0" aria-labelledby="ins-tab-{mode}">
      {#if error}
        <div class="ins-alert">
          <span class="ins-eyebrow">Context unavailable</span>
          <p class="ins-note">{error}</p>
          <button type="button" class="ins-more" onclick={() => conversationId && load(conversationId, manualLens)}>
            retry →
          </button>
        </div>
      {:else if !panel}
        <p class="ins-empty">
          {conversationId ? 'Building the contextual view…' : 'Select a conversation.'}
        </p>
      {:else}
        {#each panel.cards as card (card.id)}
          <ContextCard {card} lens={panel.selectedLens} onSelect={askAbout} onDrill={openDrill} />
        {/each}
        {#if showGraph}
          <ThreadGraphCard {conversationId} />
        {/if}
      {/if}
    </div>

  <!-- ══ ACTIVITY ════════════════════════════════════════════════════════ -->
  {:else if mode === 'activity'}
    <div class="ins-scroll" id="ins-panel" role="tabpanel" tabindex="0" aria-labelledby="ins-tab-{mode}">
      <!-- The state line: the panel's one big figure, because it is the thing
           that has to be legible from across the room. -->
      <section class="ins-cell act-state" data-live={activity.streaming}>
        <span class="ins-eyebrow">{activity.streaming ? 'Working' : 'Idle'}</span>
        <div class="act-clock">
          {#if turnElapsed}
            <span class="act-elapsed">{turnElapsed}</span>
          {/if}
          <span class="act-note">
            {#if activity.streaming}
              {stepsRunning > 0 ? `${stepsRunning} tool${stepsRunning === 1 ? '' : 's'} running` : 'thinking'}
            {:else if lastTurnMs !== null}
              last turn
            {:else}
              nothing running
            {/if}
          </span>
        </div>
      </section>

      {#if activity.build}
        <section class="ins-cell">
          <div class="ins-cell-hd">
            <span class="ins-eyebrow">Build</span>
            <span class="ins-meta">{activity.build.status}</span>
          </div>
          <a class="act-build" href="/jkai/builds/{activity.build.id}">
            <span class="act-build-id">{activity.build.id.slice(0, 8)}</span>
            <span class="act-build-go">open →</span>
          </a>
        </section>
      {/if}

      {#if activity.workers.length > 0}
        <section class="ins-cell">
          <div class="ins-cell-hd">
            <span class="ins-eyebrow">Workers</span>
            <span class="ins-meta">{workersDone} of {activity.workers.length} done</span>
          </div>
          <div class="ins-rows">
            {#each activity.workers as w (w.id)}
              <div class="wk-row" data-status={w.status}>
                <span class="wk-mark" aria-hidden="true">
                  {#if w.status === 'running'}<span class="ins-pip"></span>
                  {:else if w.status === 'error'}✗
                  {:else}✓
                  {/if}
                </span>
                <span class="wk-task" title={w.task}>{w.task}</span>
                <span class="wk-time">
                  {w.status === 'running' && w.startedAt ? elapsed(now - w.startedAt) : ''}
                </span>
                {#if w.step}
                  <span class="wk-step" title={w.step}>{w.step}</span>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if activity.steps.length > 0}
        <section class="ins-cell">
          <div class="ins-cell-hd">
            <span class="ins-eyebrow">{activity.stepsAreLive ? 'Tool calls' : 'Last turn'}</span>
            <span class="ins-meta">
              {activity.steps.length}{stepsFailed > 0 ? ` · ${stepsFailed} failed` : ''}
            </span>
          </div>
          <div class="ins-rows">
            {#each activity.steps as s, i (s.id)}
              {@const d = openStep === i ? detailFor(i) : null}
              <div class="st" class:open={openStep === i}>
                <button
                  type="button"
                  class="st-row"
                  data-status={s.status}
                  data-tone={stepTone(s.category)}
                  aria-expanded={openStep === i}
                  onclick={() => toggleStep(i)}
                  title="Show what this call sent and what came back"
                >
                  <span class="st-cat">{s.category}</span>
                  <span class="st-tool">{s.tool}</span>
                  <span class="st-mark" aria-hidden="true">
                    {#if s.status === 'running'}<span class="ins-pip"></span>
                    {:else if s.status === 'error'}✗
                    {:else}✓
                    {/if}
                  </span>
                  {#if s.summary}
                    <span class="st-summary">{s.summary}</span>
                  {/if}
                </button>

                {#if openStep === i}
                  <div class="st-detail">
                    {#if activity.stepsAreLive}
                      <p class="ins-note">
                        The chain is recorded when the turn finishes — the
                        arguments and result appear then.
                      </p>
                    {:else if traceLoading}
                      <p class="ins-note">reading the recorded chain…</p>
                    {:else if traceError}
                      <p class="ins-note st-err">{traceError}</p>
                    {:else if d}
                      <dl class="st-meta">
                        {#if d.durationMs !== undefined}
                          <div><dt>Took</dt><dd>{elapsed(d.durationMs) || `${d.durationMs}ms`}</dd></div>
                        {/if}
                        <div><dt>Called</dt><dd>{d.tool}</dd></div>
                      </dl>
                      <span class="ins-eyebrow st-lbl">Sent</span>
                      <pre class="st-pre">{preview(d.args)}</pre>
                      {#if d.error}
                        <span class="ins-eyebrow st-lbl">Error</span>
                        <pre class="st-pre st-err">{d.error}</pre>
                      {:else}
                        <span class="ins-eyebrow st-lbl">Came back</span>
                        <pre class="st-pre">{preview(d.result) || '(nothing)'}</pre>
                      {/if}
                    {:else}
                      <p class="ins-note">No recorded detail for this step.</p>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <!-- Analysis is an LLM call, so it is never automatic. The endpoint
               refuses to spend when the deterministic pass finds no repeat,
               ladder or discovery pattern, and says so. -->
          {#if !activity.stepsAreLive && (activity.stepsMessageId || activity.traceId)}
            <div class="st-actions">
              <button type="button" class="ins-more" disabled={analysing} onclick={analyseChainNow}>
                {analysing ? 'analysing…' : 'analyse this chain →'}
              </button>
              <a class="ins-act" href="/jkai/trace/{activity.stepsMessageId ?? activity.traceId}">full trace →</a>
            </div>
          {/if}

          {#if analysis}
            <div class="st-analysis">
              {#if analysis.error}
                <p class="ins-note st-err">{analysis.error}</p>
              {:else if analysis.note}
                <p class="ins-note">{analysis.note}</p>
              {:else}
                <div class="an-head">
                  <span class="ins-meta">
                    {analysis.analysis?.calls ?? 0} calls · {analysis.analysis?.discoveryCalls ?? 0} discovery
                  </span>
                  {#if analysis.model}<span class="ins-meta">{shortModelLabel(analysis.model)}</span>{/if}
                </div>
                {#if (analysis.findings ?? []).length === 0}
                  <p class="ins-note">Nothing worth changing in this chain.</p>
                {:else}
                  {#each analysis.findings ?? [] as f (f.tool + f.evidence)}
                    <div class="an-finding">
                      <span class="an-tool">{f.tool}</span>
                      <span class="an-count">{f.calls} → {f.couldHaveBeen}</span>
                      <p class="an-why">{f.rationale}</p>
                      {#if f.cheaperRoute}
                        <p class="an-route">use <strong>{f.cheaperRoute}</strong></p>
                      {/if}
                    </div>
                  {/each}
                {/if}
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      <!-- A thread reopened from history usually kept only a trace id, not the
           step array, so this is the common case rather than the sad one: say
           what is actually true and point at the record that survived. -->
      {#if activity.steps.length === 0 && activity.traceId}
        <section class="ins-cell">
          <div class="ins-cell-hd">
            <span class="ins-eyebrow">Last tool chain</span>
          </div>
          <p class="ins-note">
            This thread's steps are not held in the page after a reload, but the
            chain it ran was recorded.
          </p>
          <a class="ins-more" href="/jkai/trace/{activity.traceId}">open the trace →</a>
        </section>
      {:else if !hasActivity}
        <p class="ins-empty">
          Nothing has run in this thread yet. Tool calls, sub-agents and builds
          appear here as they happen.
        </p>
      {/if}
    </div>

  <!-- ══ MEMORY ══════════════════════════════════════════════════════════ -->
  {:else if mode === 'memory'}
    <div class="ins-scroll" id="ins-panel" role="tabpanel" tabindex="0" aria-labelledby="ins-tab-{mode}">
      <MemoryMode {conversationId} revision={memoryRevision} onDrill={openDrill} onAsk={askAbout} />
    </div>

  <!-- ══ LEDGER ══════════════════════════════════════════════════════════ -->
  {:else}
    <div class="ins-scroll" id="ins-panel" role="tabpanel" tabindex="0" aria-labelledby="ins-tab-{mode}">
      <section class="ins-cell">
        <div class="ins-cell-hd">
          <span class="ins-eyebrow">Thread spend</span>
          <a class="ins-act" href="/admin/ops/costs" title="Every thread's spend">ledger →</a>
        </div>
        <div class="ld-figures">
          <div class="ld-fig">
            <span class="ld-val accent">{formatGbp(hub.threadCostUsd)}</span>
            <span class="ins-meta">total</span>
          </div>
          <div class="ld-fig">
            <span class="ld-val">{hub.turns ?? '—'}</span>
            <span class="ins-meta">turns</span>
          </div>
        </div>
      </section>

      <section class="ins-cell">
        <div class="ins-cell-hd">
          <span class="ins-eyebrow">Context window</span>
          <span class="ins-meta">{contextPct === null ? '—' : `${contextPct}%`}</span>
        </div>
        <!-- A gauge, not a progress bar: the quarter ticks are what turn a
             filled rectangle into a reading you can take at a glance. -->
        <div class="ld-gauge" data-tone={contextTone}>
          <span class="ld-fill" style="width: {contextPct ?? 0}%"></span>
          <span class="ld-tick" style="left: 25%"></span>
          <span class="ld-tick" style="left: 50%"></span>
          <span class="ld-tick" style="left: 75%"></span>
        </div>
        <div class="ld-legend">
          <span>{compactTokens(hub.contextTokens)} in prompt</span>
          <span>{contextWindow === null ? '' : `${compactTokens(contextWindow)} window`}</span>
        </div>
      </section>

      {#if turnCosts.length > 1}
        <section class="ins-cell">
          <div class="ins-cell-hd">
            <span class="ins-eyebrow">Spend by turn</span>
            <span class="ins-meta">peak {formatGbp(peakTurnCost)}</span>
          </div>
          <div class="ld-turns" role="img" aria-label="Cost of each turn, oldest first. Peak {formatGbp(peakTurnCost)}.">
            {#each turnCosts as c, i (i)}
              <span
                class="ld-turn"
                class:last={i === turnCosts.length - 1}
                style="height: {Math.max(6, Math.round((c / peakTurnCost) * 100))}%"
                title="Turn {i + 1} — {formatGbp(c)}"
              ></span>
            {/each}
          </div>
          <!-- Not "turn 1 … turn N": only turns that carry a usage stamp can be
               priced, and a thread can have more turns than stamps. Labelling
               the axis by position would quietly contradict the TURNS figure
               two cells above it. -->
          <div class="ld-legend">
            <span>
              {hub.turns !== null && hub.turns > turnCosts.length
                ? `${turnCosts.length} of ${hub.turns} priced`
                : 'oldest'}
            </span>
            <span>latest</span>
          </div>
        </section>
      {/if}

      <section class="ins-cell">
        <div class="ins-cell-hd">
          <span class="ins-eyebrow">Answering</span>
        </div>
        <div class="ld-model" title={hub.modelId ?? ''}>{modelLabel}</div>
        <dl class="ld-defs">
          <div class="ld-def">
            <dt>Per turn</dt>
            <dd>{costPerTurn === null ? '—' : formatGbp(costPerTurn)}</dd>
          </div>
          <div class="ld-def">
            <dt>In prompt</dt>
            <dd>{compactTokens(hub.contextTokens)} tok</dd>
          </div>
          <div class="ld-def">
            <dt>Lens</dt>
            <dd>{panel?.selectedLens ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <p class="ins-empty ins-empty--left">
        Spend is summed from this thread's own per-turn stamps, so it agrees with
        the cost line under each reply rather than drifting from a separate total.
      </p>
    </div>
  {/if}

  <!-- Chrome 5 — the constant readout. It never changes with the mode; that is
       the point of it. -->
  <footer class="ins-foot">
    <span class="ins-foot-model" title={hub.modelId ?? ''}>{modelLabel}</span>
    <span class="ins-foot-sep" aria-hidden="true">·</span>
    <span class="ins-foot-fig">{formatGbp(hub.threadCostUsd)}</span>
    {#if contextPct !== null}
      <span class="ins-foot-sep" aria-hidden="true">·</span>
      <span class="ins-foot-fig" data-tone={contextTone}>ctx {contextPct}%</span>
    {/if}
  </footer>
</aside>

{#if drillTarget && conversationId}
  <ContextDrillModal
    {conversationId}
    target={drillTarget}
    onClose={() => (drillTarget = null)}
    onAsk={askAbout}
    onRefresh={refreshAfterDrill}
  />
{/if}

<style>
  /* ══ Shell ════════════════════════════════════════════════════════════════
     The column reads as CHROME, not as content: it drops to the deep rail paper
     so the cream conversation beside it stays the lit surface. Everything in
     here is ruled with hairlines and labelled in mono — the grammar the intel
     and drive rails already use. No shadows and no gradients; the previous
     header had both, and they were the reason the column read as a different
     product from the page it sits in. */
  .inspector {
    width: 390px;
    flex: none;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--line-strong);
    background: var(--surface-rail-deep);
  }

  /* ── Shared cell grammar ─────────────────────────────────────────────── */
  /* Reaches the child modes (MemoryMode) through :global under the column's
     own root, so the grammar is declared ONCE rather than copied per mode. */
  .inspector :global(.ins-eyebrow) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    line-height: 1.2;
  }
  .inspector :global(.ins-meta) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .inspector :global(.ins-cell) {
    flex: none;
    padding: 12px 15px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .inspector :global(.ins-cell-hd) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .inspector :global(.ins-rows) {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .inspector :global(.ins-note) {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .inspector :global(.ins-empty) {
    margin: 0;
    padding: 24px 18px;
    text-align: center;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-ghost);
  }
  .inspector :global(.ins-empty--left) {
    text-align: left;
  }
  /* One "there is more of this elsewhere" affordance, shared by every list. */
  .inspector :global(.ins-more) {
    display: block;
    margin-top: 8px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .inspector :global(.ins-more:hover:not(:disabled)) {
    color: var(--accent-hover);
  }
  .inspector :global(.ins-more:disabled) {
    color: var(--text-ghost);
    cursor: default;
  }
  .inspector :global(.ins-alert) {
    margin: 14px 15px;
    padding: 12px 13px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--error);
    background: var(--bg);
  }
  .inspector :global(.ins-alert .ins-note) {
    margin-top: 5px;
    color: var(--error);
  }

  /* The live pulse, used by the running marks in ACTIVITY. The one animated
     thing in the column — live state is the only claim worth moving for, and a
     pulse rather than a spinner keeps a still screenshot readable. */
  .ins-pip {
    display: inline-block;
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: ins-pulse 1.4s ease-in-out infinite;
  }
  @keyframes ins-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  .inspector :global(.ins-act) {
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    transition: color 0.15s ease-out;
  }
  .inspector :global(.ins-act:hover:not(:disabled)) {
    color: var(--accent-hover);
  }
  .inspector :global(.ins-act:disabled) {
    color: var(--text-ghost);
    cursor: default;
  }

  /* ── Chrome 1: mode keys ─────────────────────────────────────────────── */
  /* 40px on --surface-rail, closed with a 2px ink rule. Those three values are
     `.tab-strip` / `.strip-row` in ConversationTabs, copied deliberately: they
     are what makes the panel's top bar and the thread tabs one continuous band
     across the page. Change them there and change them here. */
  .ins-modes {
    flex: none;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    /* 42, not 40: `.strip-row` is 40px and `.tab-strip` puts the 2px rule
       OUTSIDE it, so the band is 42 in total. Under border-box this height
       includes the rule, which leaves the keys the same 40px as the tabs and
       lands the two bottom edges on the same pixel. */
    height: 42px;
    border-bottom: 2px solid var(--text-primary);
    background: var(--surface-rail);
  }
  .ins-key {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 0 4px;
    border: none;
    border-right: 1px solid var(--line-hair);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    transition: background 0.15s ease-out, color 0.15s ease-out;
  }
  .ins-key:last-child {
    border-right: none;
  }
  .ins-key:hover:not(.on) {
    color: var(--text-primary);
  }
  .ins-key.on {
    background: var(--bg);
    color: var(--text-primary);
  }
  .ins-key.on::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: var(--accent);
  }
  .ins-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: #fff;
    font-size: var(--fs-label-xs);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* ── Chrome 3: lens strip (subordinate tier) ─────────────────────────── */
  /* Wraps rather than scrolls. Five lenses fit the column; a sixth drops to a
     second row, which stays legible — where a horizontal scroll would have cut
     the last one in half with no affordance saying so. */
  .ins-lenses {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
  }
  .ln-key {
    position: relative;
    flex: 1 1 auto;
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
    padding: 7px 9px 8px;
    border: none;
    border-right: 1px solid var(--line-hair);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    transition: color 0.15s ease-out;
  }
  .ln-key:last-child {
    border-right: none;
  }
  .ln-key:hover:not(.on) {
    color: var(--text-primary);
  }
  /* Mirror of the mode key: the bar goes along the BOTTOM edge, which reads as
     "this belongs to the row above it". */
  .ln-key.on {
    color: var(--text-primary);
  }
  .ln-key.on::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 2px;
    background: var(--accent);
  }
  .ln-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  /* The classifier's confidence, on the lit key only. It is the answer to "why
     am I looking at THIS reading of the thread", which is a question you only
     have about the one on screen — and carrying it on all five is what pushed
     the strip past the column's width. */
  .ln-score {
    display: none;
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .ln-key.on .ln-score {
    display: inline;
    color: var(--accent);
  }

  /* ── Chrome 4: focus ─────────────────────────────────────────────────── */
  .ins-focus {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fc-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 1px;
    padding: 11px 15px 13px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--bg);
    overflow: hidden;
  }
  .fc-label {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.25;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fc-reason {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }
  /* The one flourish: the hub's monogram set into the corner of the focus cell,
     at the opacity of a watermark on headed paper. */
  .fc-mark {
    position: absolute;
    right: 10px;
    bottom: -9px;
    font-family: var(--font-display);
    font-size: 2.6rem;
    line-height: 1;
    color: var(--text-primary);
    opacity: 0.05;
    pointer-events: none;
  }

  /* ── The scrolling cell ──────────────────────────────────────────────── */
  /* Exactly one thing in this column scrolls. `overflow-y` alone, never the
     shorthand: `overflow: auto` establishes a clip on BOTH axes and quietly
     cuts anything a child paints outside its box. */
  .ins-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  /* The panel is focusable so a keyboard user can scroll it, but a pointer
     click must not paint a ring round the whole column. */
  .ins-scroll:focus {
    outline: none;
  }
  .ins-scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* ══ ACTIVITY ════════════════════════════════════════════════════════════ */

  .act-state {
    display: flex;
    flex-direction: column;
    gap: 7px;
    background: var(--bg);
  }
  .act-state[data-live='true'] {
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  }
  .act-clock {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .act-elapsed {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .act-state[data-live='true'] .act-elapsed {
    color: var(--accent);
  }
  .act-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .act-build {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    background: var(--bg);
    border-left: 3px solid var(--accent-ink);
    text-decoration: none;
  }
  .act-build-id {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .act-build-go {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  /* Workers — mark, task and clock on the first line; what it is doing on the
     second. The task is what you scan for, so it never truncates to nothing. */
  .wk-row {
    display: grid;
    grid-template-columns: 13px 1fr auto;
    align-items: baseline;
    gap: 2px 8px;
    padding: 7px 8px 8px;
    margin: 0 -8px;
    border-left: 2px solid transparent;
  }
  .wk-row[data-status='running'] {
    border-left-color: var(--accent);
    background: var(--surface-sunken);
  }
  .wk-row[data-status='error'] {
    border-left-color: var(--error);
  }
  .wk-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }
  .wk-row[data-status='error'] .wk-mark {
    color: var(--error);
  }
  .wk-row[data-status='done'] .wk-mark {
    color: var(--success);
  }
  .wk-task {
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.35;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .wk-time {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .wk-step {
    grid-column: 2 / -1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  /* Tool calls — the category is a fixed gutter, so the list reads as a column
     of KINDS and the tool names line up whatever the kind. */
  .st {
    margin: 0 -8px;
  }
  .st.open {
    background: var(--surface-sunken);
  }
  .st-row {
    display: grid;
    grid-template-columns: 46px 1fr 12px;
    align-items: baseline;
    gap: 3px 8px;
    width: 100%;
    padding: 6px 8px 7px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease-out;
  }
  .st-row:hover {
    background: var(--surface-sunken);
  }
  .st-row[data-status='running'] {
    background: var(--surface-sunken);
  }

  /* What the call actually sent and got back. Read from the recorded chain, so
     it is the same text the trace page shows rather than a second rendering of
     the same facts. */
  .st-detail {
    padding: 2px 8px 10px;
    border-left: 2px solid var(--accent);
  }
  .st-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0 0 8px;
  }
  .st-meta > div {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .st-meta dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .st-meta dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .st-lbl {
    display: block;
    margin: 8px 0 4px;
  }
  .st-lbl:first-of-type {
    margin-top: 0;
  }
  /* Wraps rather than scrolls sideways: a 390px column with a horizontally
     scrolling code block inside a vertically scrolling cell is two gestures
     fighting, and `overflow-x` would clip the other axis too. */
  .st-pre {
    margin: 0;
    padding: 7px 8px;
    max-height: 190px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .st-err {
    color: var(--error);
  }

  .st-actions {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-top: 9px;
    padding-top: 7px;
    border-top: 1px solid var(--line-hair);
  }
  .st-actions .ins-more {
    margin-top: 0;
  }

  .st-analysis {
    margin-top: 10px;
    padding: 9px 10px 10px;
    background: var(--bg);
    border-left: 3px solid var(--accent-ink);
  }
  .an-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }
  .an-finding {
    padding-top: 7px;
    border-top: 1px dotted var(--line-hair);
  }
  .an-finding:first-of-type {
    padding-top: 0;
    border-top: none;
  }
  .an-tool {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .an-count {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .an-why,
  .an-route {
    margin: 3px 0 6px;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-muted);
  }
  .an-route strong {
    color: var(--accent-ink);
    font-family: var(--font-mono);
  }
  .st-cat {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-align: center;
    padding: 1px 0;
    color: var(--text-muted);
    background: rgba(26, 16, 8, 0.05);
  }
  .st-row[data-tone='act'] .st-cat {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .st-row[data-tone='read'] .st-cat {
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent-ink) 12%, transparent);
  }
  .st-tool {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .st-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }
  .st-row[data-status='error'] .st-mark {
    color: var(--error);
  }
  .st-row[data-status='done'] .st-mark {
    color: var(--success);
  }
  .st-summary {
    grid-column: 2 / -1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  /* ══ LEDGER ══════════════════════════════════════════════════════════════ */

  .ld-figures {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
  }
  .ld-fig {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .ld-fig:last-child {
    text-align: right;
  }
  .ld-val {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .ld-val.accent {
    color: var(--accent);
  }

  /* The gauge. Quarter ticks sit ON the fill, so the reading is a position
     against a scale rather than a length you have to estimate. */
  .ld-gauge {
    position: relative;
    height: 10px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    overflow: hidden;
  }
  .ld-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--accent-ink);
    transition: width 0.3s ease-out;
  }
  .ld-gauge[data-tone='mid'] .ld-fill {
    background: var(--warn);
  }
  .ld-gauge[data-tone='high'] .ld-fill {
    background: var(--accent);
  }
  .ld-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    /* Ink, not paper: at 2% fill a cream tick sits on cream ground and vanishes
       — which is the reading where the scale is doing the most work. */
    background: rgba(26, 16, 8, 0.16);
  }
  .ld-legend {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* One bar per turn, sharing a baseline. Deliberately not a line chart: the
     turns are discrete events, and a curve between them would imply a spend
     that existed at the moments in between. */
  .ld-turns {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 44px;
    padding: 0 1px;
    border-bottom: 1px solid var(--line-strong);
  }
  .ld-turn {
    flex: 1 1 0;
    min-width: 2px;
    background: var(--accent-ink);
  }
  /* The latest turn is the one you are about to add to. */
  .ld-turn.last {
    background: var(--accent);
  }

  .ld-model {
    margin-bottom: 11px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .ld-defs {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ld-def {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px dotted var(--line-hair);
  }
  .ld-def:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .ld-defs dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .ld-defs dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* ── Chrome 5: foot ──────────────────────────────────────────────────── */
  .ins-foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 15px;
    border-top: 1px solid var(--line-strong);
    background: var(--surface-rail);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .ins-foot-model {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ins-foot-sep,
  .ins-foot-fig {
    flex: none;
  }
  .ins-foot-fig[data-tone='mid'] {
    color: var(--warn);
  }
  .ins-foot-fig[data-tone='high'] {
    color: var(--accent);
  }

  /* ── Phone bottom sheet ──────────────────────────────────────────────── */
  .sheet-handle {
    display: none;
  }
  @media (max-width: 799px) {
    .inspector {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 78%;
      transform: translateY(100%);
      transition: transform 0.2s ease-out;
      border-left: none;
      border-top: 1px solid var(--line-strong);
      pointer-events: auto;
    }
    .inspector[data-detent='peek'] {
      height: 42%;
      transform: none;
    }
    .inspector[data-detent='full'] {
      height: 94%;
      transform: none;
    }
    .sheet-handle {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      height: 24px;
      padding: 0;
      border: none;
      background: var(--surface-rail-deep);
      cursor: pointer;
    }
    .sheet-handle span {
      display: block;
      width: 38px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--line-strong);
    }
    /* Touch targets. The 12px type floor still holds; only the boxes grow. */
    .wk-row,
    .st-row,
    .ln-key {
      padding-top: 9px;
      padding-bottom: 10px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ins-pip {
      animation: none;
    }
    .ld-fill,
    .inspector {
      transition: none;
    }
  }
</style>
