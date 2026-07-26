<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import type { ThreadGraph, ThreadGraphNode, ThreadNodeKind } from '$lib/jkai/thread-graph';

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

  // Reload whenever the thread changes. `loadedFor` is a plain let, not $state:
  // it is written by the loader the effect calls, and making it reactive would
  // subscribe the effect to its own write.
  let loadedFor: string | null = null;
  let loadSeq = 0;

  async function load(id: string) {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}/graph`);
      if (!res.ok || seq !== loadSeq) return;
      const next = (await res.json()) as ThreadGraph;
      if (seq !== loadSeq) return;
      graph = next;
      selectedId = next.nodes[0]?.id ?? null;
    } catch {
      if (seq === loadSeq) graph = { nodes: [], edges: [], conceptsReady: false };
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    const id = conversationId;
    if (!id) {
      graph = { nodes: [], edges: [], conceptsReady: false };
      selectedId = null;
      loadedFor = null;
      return;
    }
    if (id === loadedFor) return;
    loadedFor = id;
    void load(id);
  });

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

  // Three hand-placed columns, exactly as the prototype lays them out: it keeps
  // every chip inside the rail without a force simulation that could push one
  // off the edge. Nodes fill column-major so edges tend to run left-to-right.
  const COLUMNS = [16, 106, 202];
  const ROW_TOP = 28;
  const ROW_GAP = 56;
  const CHIP_CENTRE = { x: 44, y: 11 };

  type Placed = ThreadGraphNode & { x: number; y: number };
  const placed = $derived.by<Placed[]>(() => {
    const perColumn = Math.max(1, Math.ceil(graph.nodes.length / COLUMNS.length));
    return graph.nodes.map((n, i) => {
      const col = Math.min(COLUMNS.length - 1, Math.floor(i / perColumn));
      const row = i % perColumn;
      return { ...n, x: COLUMNS[col], y: ROW_TOP + row * ROW_GAP };
    });
  });
  const positions = $derived(new Map(placed.map((p) => [p.id, p])));

  const drawnEdges = $derived(
    graph.edges
      .map((e) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        return {
          ...e,
          x1: a.x + CHIP_CENTRE.x,
          y1: a.y + CHIP_CENTRE.y,
          x2: b.x + CHIP_CENTRE.x,
          y2: b.y + CHIP_CENTRE.y,
          active: e.source === selected?.id || e.target === selected?.id,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null),
  );

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
    <span class="rail-label">Knowledge graph</span>
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
          <line
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={e.active ? 'var(--accent)' : 'rgba(26,16,8,.24)'}
            stroke-width={e.active ? 2 : 1}
            stroke-dasharray={e.active ? undefined : '3 3'}
          />
        {/each}
      </svg>
      {#each placed as node (node.id)}
        <button
          type="button"
          class="gr-node"
          class:selected={node.id === selected?.id}
          style="left: {node.x}px; top: {node.y}px;"
          onclick={() => (selectedId = node.id)}
          title={node.name}
        >
          <span class="gr-glyph" aria-hidden="true">{GLYPH[node.kind]}</span>
          <span class="gr-label">{chipLabel(node)}</span>
        </button>
      {/each}
      <div class="gr-legend">
        <span>◆ entity</span><span>■ artefact</span><span>▲ run</span>
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
      <div class="rail-label">Relations</div>
      {#if relations.length === 0}
        <p class="gr-note">Nothing else in this thread connects to it yet.</p>
      {:else}
        {#each relations as r, i (i)}
          <button type="button" class="gr-rel" onclick={() => (selectedId = r.target.id)}>
            <span class="gr-verb">{r.verb}</span>
            <span class="gr-target">{r.target.name}</span>
            <span class="gr-where">{r.target.type}</span>
          </button>
        {/each}
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
    background: var(--bg);
    border: 1px solid rgba(26, 16, 8, 0.3);
    border-radius: 0;
    cursor: pointer;
    transition: background 0.2s ease-out, border-color 0.2s ease-out;
  }
  .gr-node:hover {
    border-color: var(--accent-tint-35);
  }
  .gr-node.selected {
    background: var(--accent);
    border: 2px solid var(--accent);
  }
  .gr-glyph {
    font-family: var(--font-mono);
    font-size: 8px;
    line-height: 1;
    color: var(--accent);
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
  .gr-legend {
    position: absolute;
    left: 9px;
    bottom: 8px;
    display: flex;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.5);
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
  .gr-name {
    display: block;
    font-family: var(--font-brand);
    font-size: 15px;
    font-weight: 500;
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
  }

  .gr-relations {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
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
  .gr-where {
    flex: none;
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.4);
    white-space: nowrap;
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
    .gr-where,
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
