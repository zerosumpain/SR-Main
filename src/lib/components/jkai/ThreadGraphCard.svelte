<script lang="ts">
  /**
   * The thread's knowledge graph, as a card inside the inspector's CONTEXT mode.
   *
   * It used to be the whole right-hand column and owned its own chrome: a
   * header, a node/edge count row, a phone sheet handle and a cost footer. Once
   * the inspector took over the column, every one of those became a second copy
   * of something the panel already draws — so they are gone, and what is left is
   * the part only this component can say: the picture, the ranked reading, the
   * selected entity, and whether the thread feeds intelligence at all.
   *
   * The picture is a fixed 324px (see RAIL_RADIAL — the slot geometry is what
   * makes "no two chips overlap" checkable) and is centred in the wider column
   * rather than stretched, because stretching it would move the chips off the
   * slots the layout maths proved.
   */
  import type { ThreadGraph, ThreadGraphNode, ThreadNodeKind } from '$lib/jkai/thread-graph';
  import { emptyThreadGraph } from '$lib/jkai/thread-graph';
  import KnowledgeGraphModal from './KnowledgeGraphModal.svelte';
  import { RAIL_RADIAL, RAIL_DRAW_LIMIT, placeNodes, drawEdges, visibleEdges } from '$lib/jkai/graph-layout';
  import { nodeStyle, edgeStyle, legendFor } from '$lib/jkai/graph-colors';
  import { hub } from '$lib/jkai/hub-bus.svelte';

  let { conversationId }: { conversationId: string | null } = $props();

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
   *  to collide, and the full name lives in the detail cell below. */
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
  const TOPIC_LIMIT = 5;
  const conceptNodes = $derived(graph.nodes.filter((n) => n.kind === 'concept'));
  const topics = $derived(conceptNodes.slice(0, TOPIC_LIMIT));
  const topMentions = $derived(Math.max(1, ...topics.map((t) => t.mentions)));

  // The card is a summary; the modal is where the graph is legible and where you
  // cross over into /jkai/intel.
  let expanded = $state(false);

  /** The ER reading of the graph: every edge touching the selected node, as
   *  `VERB → target`. */
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

  /** The inspector's one scroll cell has room now, so this cap is editorial
   *  rather than structural: four relations is a reading, forty is a dump, and
   *  the modal is where forty belongs. */
  const RELATION_LIMIT = 4;
  const shownRelations = $derived(relations.slice(0, RELATION_LIMIT));
  const hiddenRelationCount = $derived(Math.max(0, relations.length - RELATION_LIMIT));

  function relativeSeen(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  }
</script>

<section class="tg">
  <header class="tg-hd">
    <h3 class="tg-title">Knowledge graph</h3>
    <span class="tg-count">{graph.nodes.length}n · {graph.edges.length}e</span>
    <button
      type="button"
      class="tg-expand"
      onclick={() => (expanded = true)}
      disabled={graph.nodes.length === 0}
      title="Open the full graph"
    >expand ⤢</button>
  </header>

  <!-- Paper, dotted, and exactly as wide as the layout maths assumes. Centred in
       the column rather than stretched: the chips sit on proven slots. -->
  <div class="tg-canvas">
    <div class="tg-plot">
    {#if loading && graph.nodes.length === 0}
      <div class="tg-msg">reading the thread…</div>
    {:else if graph.nodes.length === 0}
      <div class="tg-msg">
        {#if !conversationId}
          No thread selected.
        {:else if !graph.intelEnabled}
          This thread is not feeding intelligence.
        {:else}
          Nothing extracted from this thread yet.
        {/if}
      </div>
    {:else}
      <svg class="tg-edges" width={RAIL_RADIAL.width} height={RAIL_RADIAL.height} aria-hidden="true">
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
            opacity={e.active ? 1 : 0.4}
          />
        {/each}
      </svg>
      {#each placed as node (node.id)}
        {@const s = nodeStyle(node)}
        <button
          type="button"
          class="tg-node"
          class:selected={node.id === selected?.id}
          class:centre={node.ring === 0}
          style="left: {node.x}px; top: {node.y}px; width: {node.w}px; height: {node.h}px; --n-color: {s.color}; --n-fill: {s.fill};"
          onclick={() => (selectedId = node.id)}
          ondblclick={() => { selectedId = node.id; expanded = true; }}
          title="{node.name} — {s.hint}"
        >
          <span class="tg-node-bar" aria-hidden="true"></span>
          <span class="tg-glyph" aria-hidden="true">{GLYPH[node.kind]}</span>
          <span class="tg-node-label">{chipLabel(node)}</span>
        </button>
      {/each}
    {/if}
    </div>
  </div>

  {#if graph.nodes.length > 0}
    <!-- The legend says what the COLOURS mean; the shapes are self-evident and
         the provenance split is the thing that needs explaining. Only the
         provenances actually present are listed — see legendFor. -->
    <div class="tg-legend">
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
          +{hiddenNodeCount} more
        </button>
      {/if}
    </div>
  {/if}

  {#if topics.length > 0}
    <!-- What the thread is ABOUT, ranked. The picture says how things connect;
         it has never said which of them matters, and that was the question. -->
    <section class="tg-sec">
      <div class="tg-sec-hd">
        <span class="tg-eyebrow">Top topics</span>
        <span class="tg-meta" title="Messages in this thread that name it">
          {topics.length} of {conceptNodes.length}
        </span>
      </div>
      <div class="tg-rows">
        {#each topics as t, i (t.id)}
          <button
            type="button"
            class="tp"
            class:selected={t.id === selected?.id}
            onclick={() => (selectedId = t.id)}
            title="{t.name} — {t.type}, named in {t.mentions} {t.mentions === 1 ? 'message' : 'messages'}"
          >
            <span class="tp-rank">{i + 1}</span>
            <span class="tp-name">{t.name}</span>
            <span class="tp-n">{t.mentions}</span>
            <span class="tp-bar" aria-hidden="true">
              <span
                class="tp-fill"
                style="width: {Math.round((t.mentions / topMentions) * 100)}%; background: {nodeStyle(t).color};"
              ></span>
            </span>
          </button>
        {/each}
      </div>
      {#if conceptNodes.length > topics.length}
        <button type="button" class="tg-more" onclick={() => (expanded = true)}>
          +{conceptNodes.length - topics.length} more topics →
        </button>
      {/if}
    </section>
  {/if}

  {#if selected}
    <section class="tg-sec tg-selected">
      <div class="tg-sec-hd">
        <span class="tg-eyebrow">Selected</span>
        <span class="tg-meta">{relativeSeen(selected.lastSeen)}</span>
      </div>
      <div class="sel-type" style="--n-color: {nodeStyle(selected).color};">{selected.type}</div>
      {#if selected.href}
        <a class="sel-name" href={selected.href}>{selected.name}</a>
      {:else}
        <div class="sel-name">{selected.name}</div>
      {/if}
      {#if selected.note}
        <p class="tg-note">{selected.note}</p>
      {/if}
    </section>

    <section class="tg-sec">
      <div class="tg-sec-hd">
        <span class="tg-eyebrow">Relations</span>
        {#if relations.length > 0}
          <span class="tg-meta">{relations.length}</span>
        {/if}
      </div>
      {#if relations.length === 0}
        <p class="tg-note">Nothing else in this thread connects to it yet.</p>
      {:else}
        <div class="tg-rows">
          {#each shownRelations as r, i (i)}
            <button
              type="button"
              class="rel"
              onclick={() => (selectedId = r.target.id)}
              title="{r.verb} {r.target.name}"
            >
              <span class="rel-verb">{r.verb}</span>
              <span class="rel-target">{r.target.name}</span>
            </button>
          {/each}
        </div>
        {#if hiddenRelationCount > 0}
          <button type="button" class="tg-more" onclick={() => (expanded = true)}>
            +{hiddenRelationCount} more →
          </button>
        {/if}
      {/if}
    </section>
  {/if}

  <!-- Whether this thread feeds the knowledge base at all. Off stops FUTURE
       extraction; what the thread has already contributed is removed by the
       separate action beside it, because "stop listening" and "unsay it" are
       different intentions and folding them together makes the safe one
       destructive. -->
  <section class="tg-sec tg-intel">
    <div class="tg-sec-hd">
      <span class="tg-eyebrow">Feeds intelligence</span>
      <button
        type="button"
        role="switch"
        class="tg-switch"
        class:on={graph.intelEnabled}
        aria-checked={graph.intelEnabled}
        aria-label="Add entities and relationships from this thread to intelligence"
        disabled={!conversationId || intelBusy}
        title={graph.intelEnabled
          ? 'On — entities and relationships from this thread are extracted into /jkai/intel.'
          : 'Off — nothing further from this thread reaches /jkai/intel. What it has already contributed stays.'}
        onclick={toggleIntel}
      ><span class="tg-knob"></span></button>
    </div>
    <div class="intel-note">
      <span>
        {#if graph.intelEnabled}
          {graph.conceptTotal} {graph.conceptTotal === 1 ? 'entity' : 'entities'} in intel
        {:else}
          Paused — {graph.conceptTotal} already in intel
        {/if}
      </span>
      {#if graph.conceptTotal > 0}
        <button
          type="button"
          class="intel-forget"
          class:armed={forgetArmed}
          disabled={forgetting}
          onclick={forgetThreadIntel}
          onblur={() => (forgetArmed = false)}
          title="Remove the entities and relationships this thread contributed. Anything a second source also asserts is kept."
        >{forgetting ? 'forgetting…' : forgetArmed ? 'sure? →' : 'forget'}</button>
      {/if}
    </div>
  </section>
</section>

{#if expanded}
  <KnowledgeGraphModal
    {graph}
    {selectedId}
    onSelect={(id) => (selectedId = id)}
    onClose={() => (expanded = false)}
  />
{/if}

<style>
  /* The card sits on the inspector's paper and uses its grammar: mono tracked
     eyebrows, hairline rules, no frame of its own. */
  .tg {
    display: block;
    background: var(--bg);
    border-bottom: 1px solid var(--line-hair);
  }

  .tg-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    line-height: 1.2;
  }
  .tg-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .tg-note {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .tg-sec {
    padding: 12px 15px 14px;
    border-top: 1px solid var(--line-hair);
  }
  .tg-sec-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .tg-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tg-more {
    display: block;
    margin-top: 9px;
    padding: 6px 0 0;
    width: 100%;
    border: none;
    border-top: 1px solid var(--line-hair);
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .tg-more:hover {
    color: var(--accent-hover);
  }

  /* ── Head ────────────────────────────────────────────────────────────── */
  .tg-hd {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 12px 15px 10px;
  }
  .tg-title {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
  }
  .tg-count {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .tg-expand {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .tg-expand:hover:not(:disabled) {
    color: var(--accent-hover);
  }
  .tg-expand:disabled {
    color: var(--text-ghost);
    cursor: default;
  }

  /* ── Canvas ──────────────────────────────────────────────────────────── */
  /* The dot grid runs the full width of the column — it is the drafting paper
     the picture is pinned to, and a 33px dotless gutter either side read as the
     grid having failed rather than as a margin. */
  .tg-canvas {
    position: relative;
    height: 256px;
    overflow: hidden;
    background-color: var(--bg);
    background-image: radial-gradient(rgba(26, 16, 8, 0.13) 1px, transparent 1px);
    background-size: 20px 20px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
  }
  /* The plot itself stays exactly as wide as RAIL_RADIAL assumes and is centred
     in it: the chip positions are the slot geometry, not a percentage. */
  .tg-plot {
    position: relative;
    width: 324px;
    max-width: 100%;
    height: 100%;
    margin: 0 auto;
  }
  .tg-edges {
    position: absolute;
    left: 0;
    top: 0;
  }
  .tg-msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 28px;
    text-align: center;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-ghost);
  }

  /* Chips are sized by the layout, not by their content: the slot geometry is
     what makes "no two chips overlap" checkable, and it needs a known box. */
  .tg-node {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px 0 0;
    overflow: hidden;
    /* --n-color / --n-fill come from graph-colors: petrol for what the base
       already held, burnt-orange for what only this chat says, muted for the
       thread's own artefacts. */
    background: var(--n-fill, var(--bg));
    border: 1px solid var(--n-color, rgba(26, 16, 8, 0.3));
    border-radius: 0;
    cursor: pointer;
    transition: background 0.15s ease-out;
  }
  /* Provenance runs down the chip's leading edge as well as round its border, so
     it survives selection — which INVERTS the chip rather than recolouring it.
     Hue means provenance here and nothing else; if selection also spoke in hue,
     the two claims would collide. */
  .tg-node-bar {
    flex: none;
    align-self: stretch;
    width: 3px;
    background: var(--n-color);
  }
  .tg-node:hover {
    filter: brightness(0.97);
  }
  /* The middle of the picture is the thread's headline topic, so it is lifted
     off the dot grid with a paper halo rather than left to be found. */
  .tg-node.centre {
    box-shadow: 0 0 0 3px var(--bg);
  }
  .tg-node.selected {
    background: var(--text-primary);
    border-color: var(--text-primary);
  }
  .tg-glyph {
    flex: none;
    margin-left: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--n-color, var(--accent));
  }
  .tg-node.selected .tg-glyph {
    color: rgba(255, 255, 255, 0.75);
  }
  .tg-node-label {
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
  .tg-node.selected .tg-node-label {
    color: var(--bg);
  }

  /* ── Legend ──────────────────────────────────────────────────────────── */
  .tg-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 12px;
    padding: 9px 15px 10px;
    background: var(--surface-sunken);
  }
  .lg-row {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .lg-swatch {
    width: 8px;
    height: 8px;
    flex: none;
  }
  .lg-line {
    width: 14px;
    height: 0;
    flex: none;
    border-top: 2px solid var(--lg-color);
  }
  .lg-line.dashed {
    border-top-style: dashed;
  }
  .lg-more {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .lg-more:hover {
    color: var(--accent-hover);
  }

  /* ── Topics ──────────────────────────────────────────────────────────── */
  /* Rank, name and count on the line; the bar underneath at full width. A bar
     squeezed between a name and a number in this column is too short to be
     comparable, and an incomparable bar is decoration. */
  .tp {
    display: grid;
    grid-template-columns: 15px 1fr auto;
    align-items: baseline;
    gap: 0 8px;
    width: 100%;
    padding: 6px 6px 7px;
    margin: 0 -6px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease-out;
  }
  .tp:hover,
  .tp.selected {
    background: var(--surface-sunken);
  }
  .tp-rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .tp-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .tp:hover .tp-name,
  .tp.selected .tp-name {
    color: var(--text-primary);
  }
  .tp-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .tp-bar {
    grid-column: 2 / -1;
    display: block;
    height: 3px;
    margin-top: 5px;
    background: rgba(26, 16, 8, 0.08);
  }
  .tp-fill {
    display: block;
    height: 100%;
  }

  /* ── Selected ────────────────────────────────────────────────────────── */
  .tg-selected {
    background: var(--surface-sunken);
  }
  .sel-type {
    display: inline-block;
    padding: 2px 7px;
    margin-bottom: 7px;
    border-left: 3px solid var(--n-color);
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .sel-name {
    display: block;
    margin-bottom: 6px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  a.sel-name {
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
  }
  a.sel-name:hover {
    color: var(--accent);
  }

  /* ── Relations ───────────────────────────────────────────────────────── */
  /* The verb is the line that scans, so it leads and the target sits under it. */
  .rel {
    display: block;
    width: 100%;
    padding: 6px 6px 7px;
    margin: 0 -6px;
    border: none;
    border-left: 2px solid var(--line-hair);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease-out, background 0.15s ease-out;
  }
  .rel:hover {
    background: var(--surface-sunken);
    border-left-color: var(--accent);
  }
  .rel-verb {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .rel-target {
    display: block;
    margin-top: 1px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.35;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .rel:hover .rel-target {
    color: var(--text-primary);
  }

  /* ── Feeds intelligence ──────────────────────────────────────────────── */
  .tg-intel {
    background: var(--surface-sunken);
  }
  .tg-switch {
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
  .tg-switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .tg-switch:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .tg-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--text-ghost);
    transition: transform 0.2s ease-out, background 0.2s ease-out;
  }
  .tg-switch.on .tg-knob {
    background: #fff;
    transform: translateX(16px);
  }
  .intel-note {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .intel-forget {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .intel-forget:hover,
  .intel-forget.armed {
    color: var(--error);
  }

  @media (max-width: 799px) {
    .tp,
    .rel {
      padding-top: 9px;
      padding-bottom: 10px;
    }
  }
</style>
