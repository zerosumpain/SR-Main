<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import type { ThreadGraph, ThreadGraphNode, ThreadNodeKind } from '$lib/jkai/thread-graph';
  import KnowledgeGraphModal from './KnowledgeGraphModal.svelte';
  import { RAIL_LAYOUT, placeNodes, drawEdges } from '$lib/jkai/graph-layout';
  import { nodeStyle, edgeStyle, legendFor } from '$lib/jkai/graph-colors';
  import { hub } from '$lib/jkai/hub-bus.svelte';

  let {
    conversationId,
    threadCostUsd = null,
    contextFraction = null,
    sheetDetent = 'closed',
    onCloseSheet,
  }: {
    conversationId: string | null;
    threadCostUsd?: number | null;
    contextFraction?: number | null;
    /** Phone bottom sheet (2b): closed hides it, peek drops the graph pane,
     *  full is the desktop rail's content. Ignored on desktop. */
    sheetDetent?: 'closed' | 'peek' | 'full';
    onCloseSheet?: () => void;
  } = $props();

  let graph = $state<ThreadGraph>({ nodes: [], edges: [], conceptsReady: false });
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
      if (!next.conceptsReady && pollAttempt < CONCEPT_POLL_DELAYS_MS.length) {
        const delay = CONCEPT_POLL_DELAYS_MS[pollAttempt];
        pollAttempt += 1;
        cancelPoll();
        pollTimer = setTimeout(() => {
          pollTimer = null;
          void load(id);
        }, delay);
      }
    } catch {
      if (seq === loadSeq) graph = { nodes: [], edges: [], conceptsReady: false };
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    const id = conversationId;
    // Tracked: the chat page bumps this on every completed turn.
    const revision = hub.graphRevision;
    if (!id) {
      graph = { nodes: [], edges: [], conceptsReady: false };
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

  /** Chip label. The canvas is 324px wide and nothing may truncate, so the full
   *  name lives in the detail panel below and the chip gets a short form. */
  function chipLabel(node: ThreadGraphNode): string {
    const base = node.name.replace(/\.[a-z0-9]+$/i, '');
    return base.length > 14 ? `${base.slice(0, 13)}…` : base;
  }

  // Layout is shared with the expanded modal — see $lib/jkai/graph-layout.
  const placed = $derived(placeNodes(graph.nodes, RAIL_LAYOUT));
  const drawnEdges = $derived(drawEdges(graph.edges, placed, RAIL_LAYOUT, selected?.id ?? null));

  const legend = $derived(legendFor(graph.nodes, graph.edges));

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
   *  and the overflow is handed to the modal, which has room for all of it. */
  const RAIL_RELATION_LIMIT = 4;
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

<aside class="graph-rail" data-detent={sheetDetent}>
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

  <div class="gr-canvas">
    {#if loading && graph.nodes.length === 0}
      <div class="gr-empty">reading the thread…</div>
    {:else if graph.nodes.length === 0}
      <div class="gr-empty">
        {conversationId ? 'Nothing extracted from this thread yet.' : 'No thread selected.'}
      </div>
    {:else}
      <svg class="gr-edges" width="324" height="308" aria-hidden="true">
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
            opacity={e.active ? 1 : 0.5}
          />
        {/each}
      </svg>
      {#each placed as node (node.id)}
        {@const s = nodeStyle(node)}
        <button
          type="button"
          class="gr-node"
          class:selected={node.id === selected?.id}
          style="left: {node.x}px; top: {node.y}px; --n-color: {s.color}; --n-fill: {s.fill};"
          onclick={() => { selectedId = node.id; expanded = true; }}
          title="{node.name} — {s.hint}"
        >
          <span class="gr-glyph" aria-hidden="true">{GLYPH[node.kind]}</span>
          <span class="gr-label">{chipLabel(node)}</span>
        </button>
      {/each}
      <div class="gr-legend">
        {#each legend as row (row.label)}
          <span class="lg-row" title={row.hint}>
            {#if row.kind === 'node'}
              <span class="lg-swatch" style="background: {row.color};"></span>
            {:else}
              <span
                class="lg-line"
                style="--lg-color: {row.color};"
                class:dashed={!!row.dash}
              ></span>
            {/if}
            {row.label}
          </span>
        {/each}
      </div>
    {/if}
  </div>

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
    border-left: 1px solid var(--divider);
    background: var(--bg-section);
  }

  .rail-label {
    font-family: var(--font-mono);
    font-size: 9px;
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
    border-bottom: 1px solid var(--divider);
  }
  .gr-count {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  /* Canvas — the same 20px dot grid the workflow canvas uses. */
  .gr-canvas {
    position: relative;
    flex: none;
    height: 308px;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
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
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-ghost);
  }
  .gr-node {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 7px;
    max-width: 106px;
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
  .gr-node.selected {
    background: var(--n-color);
    border: 2px solid var(--n-color);
  }
  .gr-glyph {
    font-family: var(--font-mono);
    font-size: 8px;
    line-height: 1;
    color: var(--n-color, var(--accent));
  }
  .gr-node.selected .gr-glyph {
    color: rgba(255, 255, 255, 0.8);
  }
  .gr-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .gr-node.selected .gr-label {
    color: #fff;
  }
  /* Legend says what the COLOURS mean, not what the glyphs mean — the shapes
     were self-evident, the provenance split is the thing that needs explaining.
     Only the provenances actually present are listed (see legendFor). */
  .gr-legend {
    position: absolute;
    left: 9px;
    right: 9px;
    bottom: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 9px;
    font-family: var(--font-mono);
    font-size: 8px;
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

  .gr-detail {
    flex: none;
    padding: 12px;
    border-bottom: 1px solid var(--divider);
  }
  .gr-detail-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .gr-type {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
  }
  .gr-seen {
    font-family: var(--font-mono);
    font-size: 9px;
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
    font-size: 15px;
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
    margin: 6px 0 0;
    font-family: var(--font-body);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-muted);
    /* Summaries are model-written and occasionally a paragraph. Clamp rather
       than scroll — the whole point of the rail is a glance, and the modal has
       the full text. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  /* Nothing in the rail scrolls. The detail block is bounded by the clamps
     above and the relation cap below, so it always fits the column. */
  .gr-relations {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 12px;
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
    font-size: 8.5px;
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
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .gr-rel-more:hover {
    color: var(--accent);
  }
  .gr-verb {
    flex: none;
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
  }
  .gr-target {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: 11.5px;
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
    border-top: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: 9px;
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
    /* Peek drops the graph pane; the detail + relations are the useful part on
       a phone, and the canvas costs half the screen. */
    .graph-rail[data-detent='peek'] .gr-canvas,
    .graph-rail[data-detent='peek'] .gr-hd {
      display: none;
    }
    .gr-canvas {
      height: 296px;
      background-size: 22px 22px;
    }
    .gr-relations {
      max-height: 40vh;
    }
    .gr-rel {
      min-height: 44px;
      align-items: center;
    }
    .gr-target,
    .gr-note {
      font-size: 12.5px;
    }
    .gr-verb,
    .gr-count,
    .gr-seen,
    .gr-type,
    .gr-foot {
      font-size: 10px;
    }
    .gr-foot {
      padding-bottom: max(9px, env(safe-area-inset-bottom));
    }
  }
</style>
