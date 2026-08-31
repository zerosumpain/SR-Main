<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import type { ThreadGraph, ThreadGraphNode, ThreadNodeKind } from '$lib/jkai/thread-graph';
  import { emptyThreadGraph } from '$lib/jkai/thread-graph';
  import KnowledgeGraphModal from './KnowledgeGraphModal.svelte';
  import { RAIL_RADIAL, RAIL_DRAW_LIMIT, placeNodes, drawEdges, visibleEdges } from '$lib/jkai/graph-layout';
  import { nodeStyle, edgeStyle, legendFor } from '$lib/jkai/graph-colors';
  import { hub } from '$lib/jkai/hub-bus.svelte';

  let {
    conversationId,
    threadCostUsd = null,
    contextFraction = null,
    sheetDetent = 'closed',
    onCloseSheet,
    embedded = false,
  }: {
    conversationId: string | null;
    threadCostUsd?: number | null;
    contextFraction?: number | null;
    /** Phone bottom sheet (2b): closed hides it, peek drops the graph pane,
     *  full is the desktop rail's content. Ignored on desktop. */
    sheetDetent?: 'closed' | 'peek' | 'full';
    onCloseSheet?: () => void;
    /** Render inside the contextual rail rather than owning the rail itself. */
    embedded?: boolean;
  } = $props();

  let graph = $state<ThreadGraph>(emptyThreadGraph());
  let loading = $state(false);
  let selectedId = $state<string | null>(null);

  // Reload on a thread switch AND on every completed turn. `loadedKey` is a
  // plain let, not $state: it is written by the loader the effect calls, and
  // making it reactive would subscribe the effect to its own write.
  let loadedKey: string | null = null;
  let loadSeq = 0;

  // Poll handle + attempt counter. Plain lets for the same reason — nothing
  // reactive reads them, and as $state the scheduling helpers would re-trigger
  // the effect that calls them.
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollAttempt = 0;

  /**
   * Concept nodes are not ready when a turn is. Extraction runs on a cadence
   * (assistant turn 2, then every 4th) and is *queued* behind an LLM call, so
   * the graph the turn will produce lands seconds later. Fetching once on `done`
   * would therefore keep showing the pre-turn graph — the original bug, just
   * moved. So while `conceptsReady` is false we chase it a few times and stop.
   */
  const CONCEPT_POLL_DELAYS_MS = [4_000, 10_000, 25_000];

  function cancelPoll(): void {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function load(id: string): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}/graph`);
      if (!res.ok || seq !== loadSeq) return;
      const next = (await res.json()) as ThreadGraph;
      if (seq !== loadSeq) return;
      graph = next;
      // Keep whatever the user was looking at if the refetch still has it —
      // a background refresh must not yank the detail panel out from under them.
      if (!next.nodes.some((n) => n.id === selectedId)) {
        selectedId = next.nodes[0]?.id ?? null;
      }
      // A thread that has opted out will never produce concepts, so chasing
      // `conceptsReady` on it is three fetches that can only ever fail.
      if (!next.conceptsReady && next.intelEnabled && pollAttempt < CONCEPT_POLL_DELAYS_MS.length) {
        const delay = CONCEPT_POLL_DELAYS_MS[pollAttempt];
        pollAttempt += 1;
        cancelPoll();
        pollTimer = setTimeout(() => {
          pollTimer = null;
          void load(id);
        }, delay);
      }
    } catch {
      if (seq === loadSeq) graph = emptyThreadGraph();
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    const id = conversationId;
    // Tracked: the chat page bumps this on every completed turn.
    const revision = hub.graphRevision;
    if (!id) {
      graph = emptyThreadGraph();
      selectedId = null;
      loadedKey = null;
      cancelPoll();
      return;
    }
    const key = `${id}:${revision}`;
    if (key === loadedKey) return;
    loadedKey = key;
    pollAttempt = 0;
    cancelPoll();
    void load(id);
  });

  $effect(() => () => cancelPoll());

  // ── Feeding /jkai/intel ───────────────────────────────────────────────────
  // The flag lives on the graph payload rather than in its own piece of state,
  // so there is nothing to keep in step when the thread changes: one fetch, one
  // source of truth, and the optimistic write goes to the same place.
  let intelBusy = $state(false);
  /** Two-click confirm on the destructive one. */
  let forgetArmed = $state(false);
  let forgetting = $state(false);

  async function toggleIntel(): Promise<void> {
    if (!conversationId || intelBusy) return;
    const next = !graph.intelEnabled;
    intelBusy = true;
    graph = { ...graph, intelEnabled: next };
    try {
      const res = await fetch(`/api/jkai/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intelEnabled: next }),
      });
      if (!res.ok) graph = { ...graph, intelEnabled: !next };
    } catch {
      graph = { ...graph, intelEnabled: !next };
    } finally {
      intelBusy = false;
    }
  }

  async function forgetThreadIntel(): Promise<void> {
    if (!conversationId || forgetting) return;
    if (!forgetArmed) {
      forgetArmed = true;
      return;
    }
    forgetting = true;
    try {
      await fetch(`/api/jkai/conversations/${conversationId}/graph`, { method: 'DELETE' });
      // Refetch rather than clearing locally: the cascade keeps any entity a
      // second note also asserts, so what survives is a server decision.
      pollAttempt = CONCEPT_POLL_DELAYS_MS.length;
      await load(conversationId);
    } catch {
      // Leave the graph as it was — the next turn refetches anyway.
    } finally {
      forgetting = false;
      forgetArmed = false;
    }
  }

  const selected = $derived<ThreadGraphNode | null>(
    graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0] ?? null,
  );

  const GLYPH: Record<ThreadNodeKind, string> = {
    concept: '◆',
    model: '◆',
    artefact: '■',
    doc: '■',
    image: '■',
    intel: '■',
    run: '▲',
  };

  /** Chip label. Chips are a fixed 100px so the radial slots can be proven not
   *  to collide, and the full name lives in the detail panel below. */
  function chipLabel(node: ThreadGraphNode): string {
    const base = node.name.replace(/\.[a-z0-9]+$/i, '');
    return base.length > 11 ? `${base.slice(0, 10)}…` : base;
  }

  /**
   * What the canvas draws: the top seven, which the server has already ranked by
   * how much the thread talks about each one. Drawing all twelve in 324px is the
   * squash this replaced — the rest are still on the topic list below and in the
   * modal, which has room for them.
   *
   * Whatever is selected is always drawn, even when it is ranked below the cut:
   * selecting a topic from the list and having the picture not move would read
   * as the click doing nothing.
   */
  const drawnNodes = $derived.by(() => {
    const top = graph.nodes.slice(0, RAIL_DRAW_LIMIT);
    if (!selectedId || top.some((n) => n.id === selectedId)) return top;
    const node = graph.nodes.find((n) => n.id === selectedId);
    if (!node) return top;
    return [...top.slice(0, RAIL_DRAW_LIMIT - 1), node];
  });

  // Layout is shared with the expanded modal — see $lib/jkai/graph-layout.
  const placed = $derived(placeNodes(drawnNodes, RAIL_RADIAL));
  const drawnEdges = $derived(
    drawEdges(visibleEdges(graph.edges, selected?.id ?? null), placed, selected?.id ?? null),
  );
  const hiddenNodeCount = $derived(Math.max(0, graph.nodes.length - drawnNodes.length));

  const legend = $derived(legendFor(drawnNodes, drawnEdges));

  /**
   * The ranked reading of the thread — the thing a picture of twelve chips was
   * never going to give. Concepts only: a model or an attachment is something
   * the thread USED, not something it is about.
   */
  const TOPIC_LIMIT = 4;
  const topics = $derived(graph.nodes.filter((n) => n.kind === 'concept').slice(0, TOPIC_LIMIT));
  const topMentions = $derived(Math.max(1, ...topics.map((t) => t.mentions)));
  const topicTotal = $derived(graph.nodes.filter((n) => n.kind === 'concept').length);

  // The rail is a summary; the modal is where the graph is legible and where
  // you cross over into /jkai/intel.
  let expanded = $state(false);

  /** The ER reading of the graph: every edge touching the selected node, as
   *  `VERB → target → TYPE`. */
  const relations = $derived.by(() => {
    if (!selected) return [];
    return graph.edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => {
        const otherId = e.source === selected.id ? e.target : e.source;
        const other = graph.nodes.find((n) => n.id === otherId);
        return other ? { verb: e.verb, target: other } : null;
      })
      .filter((r): r is { verb: string; target: ThreadGraphNode } => r !== null)
      // Typed intel relationships first — they say more than co-occurrence.
      .sort((a, b) => (a.verb === 'MENTIONED WITH' ? 1 : 0) - (b.verb === 'MENTIONED WITH' ? 1 : 0));
  });

  /** Relations shown inline. The rail must not scroll — a 324px column with its
   *  own scrollbar, inside a page that also scrolls, reads as broken and hides
   *  the very thing it is meant to surface. So the list is capped to what fits
   *  and the overflow is handed to the modal, which has room for all of it.
   *  Three rather than four now: the topic list took the space, and it is the
   *  better use of it. */
  const RAIL_RELATION_LIMIT = 3;
  const shownRelations = $derived(relations.slice(0, RAIL_RELATION_LIMIT));
  const hiddenRelationCount = $derived(Math.max(0, relations.length - RAIL_RELATION_LIMIT));

  function relativeSeen(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  }

  const contextPct = $derived(
    contextFraction === null ? null : Math.max(0, Math.min(100, Math.round(contextFraction * 100))),
  );
</script>

<aside class="graph-rail" class:embedded data-detent={sheetDetent}>
  <!-- Phone sheet grab handle (2b). Tapping cycles peek → full → closed. -->
  <button
    type="button"
    class="sheet-handle"
    onclick={onCloseSheet}
    aria-label="Close knowledge graph"
  ><span></span></button>

  <div class="gr-hd">
    <button
      type="button"
      class="rail-label gr-expand-label"
      onclick={() => (expanded = true)}
      disabled={graph.nodes.length === 0}
      title="Expand the graph"
    >Knowledge graph ⤢</button>
    <span class="gr-count">
      {graph.nodes.length}
      {graph.nodes.length === 1 ? 'node' : 'nodes'} / {graph.edges.length}
      {graph.edges.length === 1 ? 'edge' : 'edges'}
    </span>
  </div>

  <!-- Whether this thread feeds the knowledge base at all. Off stops FUTURE
       extraction; what the thread has already contributed is removed by the
       separate action below, because "stop listening" and "unsay it" are
       different intentions and folding them together makes the safe one
       destructive. -->
  <div class="gr-intel">
    <div class="gr-intel-row">
      <span class="rail-label">Add to intelligence</span>
      <button
        type="button"
        role="switch"
        class="gr-switch"
        class:on={graph.intelEnabled}
        aria-checked={graph.intelEnabled}
        aria-label="Add entities and relationships from this thread to intelligence"
        disabled={!conversationId || intelBusy}
        title={graph.intelEnabled
          ? 'On — entities and relationships from this thread are extracted into /jkai/intel.'
          : 'Off — nothing further from this thread reaches /jkai/intel. What it has already contributed stays.'}
        onclick={toggleIntel}
      ><span class="gr-knob"></span></button>
    </div>
    <div class="gr-intel-note">
      {#if graph.intelEnabled}
        <span>{graph.conceptTotal} {graph.conceptTotal === 1 ? 'entity' : 'entities'} in intel</span>
      {:else}
        <span>Paused — {graph.conceptTotal} already in intel</span>
      {/if}
      {#if graph.conceptTotal > 0}
        <button
          type="button"
          class="gr-forget"
          class:armed={forgetArmed}
          disabled={forgetting}
          onclick={forgetThreadIntel}
          onblur={() => (forgetArmed = false)}
          title="Remove the entities and relationships this thread contributed. Anything a second source also asserts is kept."
        >{forgetting ? 'forgetting…' : forgetArmed ? 'sure? →' : 'forget'}</button>
      {/if}
    </div>
  </div>

  <div class="gr-canvas">
    {#if loading && graph.nodes.length === 0}
      <div class="gr-empty">reading the thread…</div>
    {:else if graph.nodes.length === 0}
      <div class="gr-empty">
        {#if !conversationId}
          No thread selected.
        {:else if !graph.intelEnabled}
          This thread is not feeding intelligence.
        {:else}
          Nothing extracted from this thread yet.
        {/if}
      </div>
    {:else}
      <svg class="gr-edges" width={RAIL_RADIAL.width} height={RAIL_RADIAL.height} aria-hidden="true">
        {#each drawnEdges as e, i (i)}
          {@const s = edgeStyle(e)}
          <line
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={s.color}
            stroke-width={e.active ? 2 : 1}
            stroke-dasharray={s.dash}
            opacity={e.active ? 1 : 0.45}
          />
        {/each}
      </svg>
      {#each placed as node (node.id)}
        {@const s = nodeStyle(node)}
        <button
          type="button"
          class="gr-node"
          class:selected={node.id === selected?.id}
          class:centre={node.ring === 0}
          style="left: {node.x}px; top: {node.y}px; width: {node.w}px; height: {node.h}px; --n-color: {s.color}; --n-fill: {s.fill};"
          onclick={() => (selectedId = node.id)}
          ondblclick={() => { selectedId = node.id; expanded = true; }}
          title="{node.name} — {s.hint}"
        >
          <span class="gr-glyph" aria-hidden="true">{GLYPH[node.kind]}</span>
          <span class="gr-label">{chipLabel(node)}</span>
        </button>
      {/each}
    {/if}
  </div>

  {#if graph.nodes.length > 0}
    <!-- Under the canvas, not floating over it. Absolutely positioned inside the
         box, the legend sat on top of whichever chip the layout put at the
         bottom. -->
    <div class="gr-legend">
      {#each legend as row (row.label)}
        <span class="lg-row" title={row.hint}>
          {#if row.kind === 'node'}
            <span class="lg-swatch" style="background: {row.color};"></span>
          {:else}
            <span class="lg-line" style="--lg-color: {row.color};" class:dashed={!!row.dash}></span>
          {/if}
          {row.short}
        </span>
      {/each}
      {#if hiddenNodeCount > 0}
        <button type="button" class="lg-more" onclick={() => (expanded = true)}>
          +{hiddenNodeCount} not drawn →
        </button>
      {/if}
    </div>
  {/if}

  {#if topics.length > 0}
    <!-- What the thread is ABOUT, ranked. The picture says how things connect;
         it has never said which of them matters, and that was the question. -->
    <div class="gr-topics">
      <div class="gr-topics-hd">
        <span class="rail-label">Top topics</span>
        <span class="gr-topics-hint" title="Messages in this thread that name it">by mentions</span>
      </div>
      {#each topics as t, i (t.id)}
        <button
          type="button"
          class="gr-topic"
          class:selected={t.id === selected?.id}
          onclick={() => (selectedId = t.id)}
          title="{t.name} — {t.type}, named in {t.mentions} {t.mentions === 1 ? 'message' : 'messages'}"
        >
          <span class="gr-topic-rank">{i + 1}</span>
          <span class="gr-topic-name">{t.name}</span>
          <span class="gr-topic-bar" aria-hidden="true">
            <span
              class="gr-topic-fill"
              style="width: {Math.round((t.mentions / topMentions) * 100)}%; background: {nodeStyle(t).color};"
            ></span>
          </span>
          <span class="gr-topic-n">{t.mentions}</span>
        </button>
      {/each}
      {#if topicTotal > topics.length}
        <button type="button" class="gr-topics-more" onclick={() => (expanded = true)}>
          +{topicTotal - topics.length} more →
        </button>
      {/if}
    </div>
  {/if}

  {#if selected}
    <div class="gr-detail">
      <div class="gr-detail-top">
        <span class="gr-type">{selected.type}</span>
        <span class="gr-seen">{relativeSeen(selected.lastSeen)}</span>
      </div>
      {#if selected.href}
        <a class="gr-name" href={selected.href}>{selected.name}</a>
      {:else}
        <div class="gr-name">{selected.name}</div>
      {/if}
      {#if selected.note}
        <p class="gr-note">{selected.note}</p>
      {/if}
    </div>

    <div class="gr-relations">
      <div class="gr-rel-hd">
        <span class="rail-label">Relations</span>
        {#if relations.length > 0}
          <span class="gr-rel-count">{relations.length}</span>
        {/if}
      </div>
      {#if relations.length === 0}
        <p class="gr-note">Nothing else in this thread connects to it yet.</p>
      {:else}
        {#each shownRelations as r, i (i)}
          <button
            type="button"
            class="gr-rel"
            onclick={() => (selectedId = r.target.id)}
            title="{r.verb} {r.target.name}"
          >
            <span class="gr-verb">{r.verb}</span>
            <span class="gr-target">{r.target.name}</span>
          </button>
        {/each}
        {#if hiddenRelationCount > 0}
          <button type="button" class="gr-rel-more" onclick={() => (expanded = true)}>
            +{hiddenRelationCount} more →
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  <div class="gr-foot">
    <span>
      thread {formatGbp(threadCostUsd ?? 0)}{contextPct !== null ? ` · ctx ${contextPct}%` : ''}
    </span>
    <a class="gr-ledger" href="/admin/ops/costs">ledger →</a>
  </div>
</aside>

{#if expanded}
  <KnowledgeGraphModal
    {graph}
    {selectedId}
    onSelect={(id) => (selectedId = id)}
    onClose={() => (expanded = false)}
  />
{/if}

<style>
  .graph-rail {
    width: 324px;
    flex: none;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--line-hair);
    background: var(--surface-rail);
  }

  .graph-rail.embedded {
    width: 100%;
    height: auto;
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--line-hair);
    background: transparent;
  }

  .graph-rail.embedded .sheet-handle {
    display: none;
  }

  .rail-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
  }

  .gr-expand-label {
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    transition: color 0.2s ease-out;
  }
  .gr-expand-label:hover:not(:disabled) {
    color: var(--accent);
  }
  .gr-expand-label:disabled {
    cursor: default;
  }

  .sheet-handle {
    display: none;
  }

  .gr-hd {
    flex: none;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-hair);
  }
  .gr-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  /* ── Feeds-intel switch ───────────────────────────────────────────────── */
  .gr-intel {
    flex: none;
    padding: 9px 12px 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .gr-intel-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .gr-switch {
    flex: none;
    position: relative;
    width: 34px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    background: var(--bg);
    cursor: pointer;
    transition: background 0.2s ease-out, border-color 0.2s ease-out;
  }
  .gr-switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .gr-switch:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .gr-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--text-ghost);
    transition: transform 0.2s ease-out, background 0.2s ease-out;
  }
  .gr-switch.on .gr-knob {
    background: #fff;
    transform: translateX(16px);
  }
  .gr-intel-note {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .gr-forget {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .gr-forget:hover,
  .gr-forget.armed {
    color: var(--status-fail);
  }

  /* Canvas — the same 20px dot grid the workflow canvas uses. */
  .gr-canvas {
    position: relative;
    flex: none;
    height: 256px;
    overflow: hidden;
    background-color: var(--bg);
    background-image: radial-gradient(rgba(26, 16, 8, 0.13) 1px, transparent 1px);
    background-size: 20px 20px;
  }
  .gr-edges {
    position: absolute;
    left: 0;
    top: 0;
  }
  .gr-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 24px;
    text-align: center;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-ghost);
  }
  /* Chips are sized by the layout, not by their content: the slot geometry is
     what makes "no two chips overlap" checkable, and it needs a known box. */
  .gr-node {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    overflow: hidden;
    /* --n-color / --n-fill are set per node from graph-colors: petrol for what
       the knowledge base already held, burnt-orange for what only this chat
       says, muted for the thread's own artefacts. */
    background: var(--n-fill, var(--bg));
    border: 1px solid var(--n-color, rgba(26, 16, 8, 0.3));
    border-radius: 0;
    cursor: pointer;
    transition: background 0.2s ease-out, border-color 0.2s ease-out;
  }
  .gr-node:hover {
    border-color: var(--n-color);
    filter: brightness(0.97);
  }
  /* The middle of the picture is the thread's headline topic, so it is drawn as
     the one solid chip rather than left to be found. */
  .gr-node.centre {
    box-shadow: 0 0 0 3px var(--bg);
  }
  .gr-node.selected {
    background: var(--n-color);
    border: 2px solid var(--n-color);
  }
  .gr-glyph {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--n-color, var(--accent));
  }
  .gr-node.selected .gr-glyph {
    color: rgba(255, 255, 255, 0.8);
  }
  .gr-label {
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
  }
  .gr-node.selected .gr-label {
    color: #fff;
  }

  /* Legend says what the COLOURS mean, not what the glyphs mean — the shapes
     were self-evident, the provenance split is the thing that needs explaining.
     Only the provenances actually present are listed (see legendFor). */
  .gr-legend {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 9px;
    padding: 6px 12px 7px;
    border-bottom: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.5);
  }
  .lg-row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .lg-swatch {
    width: 7px;
    height: 7px;
    flex: none;
  }
  .lg-line {
    width: 12px;
    height: 0;
    flex: none;
    border-top: 2px solid var(--lg-color);
  }
  .lg-line.dashed {
    border-top-style: dashed;
  }
  /* Its own full-width row: with `margin-left: auto` it landed wherever the
     legend happened to wrap to, which was usually the middle of a line. */
  .lg-more {
    flex-basis: 100%;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .lg-more:hover {
    color: var(--accent);
  }

  /* ── Top topics ───────────────────────────────────────────────────────── */
  .gr-topics {
    flex: none;
    padding: 9px 12px 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .gr-topics-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .gr-topics-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .gr-topic {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 3px 0;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .gr-topic-rank {
    flex: none;
    width: 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .gr-topic-name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gr-topic:hover .gr-topic-name,
  .gr-topic.selected .gr-topic-name {
    color: var(--text-primary);
  }
  /* A bar, not a number alone: the ranking is a comparison and the eye reads
     length faster than it reads two digits. */
  .gr-topic-bar {
    flex: none;
    width: 54px;
    height: 5px;
    background: rgba(26, 16, 8, 0.08);
  }
  .gr-topic-fill {
    display: block;
    height: 100%;
  }
  .gr-topic-n {
    flex: none;
    width: 14px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .gr-topics-more {
    display: block;
    width: 100%;
    margin-top: 5px;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .gr-topics-more:hover {
    color: var(--accent);
  }

  /* The rail is a stack of cells: graph, then topics, then the detail, then the
     thread-cost footer — each closed by its own hairline. */
  .gr-detail {
    flex: none;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-hair);
  }
  .gr-detail-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .gr-type {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
  }
  .gr-seen {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  /* Names run to a 60-char generated filename. Wrap anywhere so a long token
     breaks instead of pushing the column wide, and clamp to two lines. */
  .gr-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-family: var(--font-brand);
    font-size: var(--fs-body);
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a.gr-name:hover {
    color: var(--accent);
  }
  .gr-note {
    margin: 5px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    /* Summaries are model-written and occasionally a paragraph. Clamp rather
       than scroll — the whole point of the rail is a glance, and the modal has
       the full text. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /* Nothing in the rail scrolls. This block absorbs whatever height is left, so
     a short viewport clips the least important cell rather than pushing the
     footer off the bottom. */
  .gr-relations {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 10px 12px;
  }
  .gr-rel-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }
  .gr-rel-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .gr-rel {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 5px 0;
    border: none;
    border-bottom: 1px solid rgba(26, 16, 8, 0.06);
    background: none;
    cursor: pointer;
  }
  .gr-rel:hover .gr-target {
    color: var(--accent);
  }
  .gr-rel-more {
    display: block;
    width: 100%;
    margin-top: 7px;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .gr-rel-more:hover {
    color: var(--accent);
  }
  /* Verbs come from `intel_relationships.label`, which is model-written and runs
     to a sentence ("PRODUCES THE WORD DELTA AS THE RESPONSE"). Unbounded, one of
     those pushed the target name it is describing clean off the rail. */
  .gr-verb {
    flex: none;
    max-width: 52%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gr-target {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gr-foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(26, 16, 8, 0.5);
  }
  .gr-ledger {
    color: rgba(26, 16, 8, 0.75);
    text-decoration: none;
  }
  .gr-ledger:hover {
    color: var(--accent);
  }

  /* ── Phone bottom sheet (2b) ──────────────────────────────────────────── */
  @media (max-width: 799px) {
    .graph-rail {
      width: 100%;
      height: auto;
      margin-top: auto;
      border-left: none;
      border-top: 2px solid rgba(26, 16, 8, 0.22);
      background: var(--bg);
      pointer-events: auto;
    }
    .sheet-handle {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 8px 0 4px;
      background: none;
      border: none;
      cursor: pointer;
    }
    .sheet-handle span {
      display: block;
      width: 44px;
      height: 5px;
      border-radius: var(--radius-pill);
      background: rgba(26, 16, 8, 0.25);
    }
    /* Peek drops the graph pane; the topics, detail and relations are the useful
       part on a phone, and the canvas costs half the screen. */
    .graph-rail[data-detent='peek'] .gr-canvas,
    .graph-rail[data-detent='peek'] .gr-legend,
    .graph-rail[data-detent='peek'] .gr-hd {
      display: none;
    }
    .gr-relations {
      max-height: 32vh;
    }
    .gr-rel,
    .gr-topic {
      min-height: 44px;
      align-items: center;
    }
    .gr-target,
    .gr-note {
      font-size: var(--fs-label);
    }
    .gr-verb,
    .gr-count,
    .gr-seen,
    .gr-type,
    .gr-foot {
      font-size: var(--fs-label-xs);
    }
    .gr-foot {
      padding-bottom: max(9px, env(safe-area-inset-bottom));
    }
  }
</style>
