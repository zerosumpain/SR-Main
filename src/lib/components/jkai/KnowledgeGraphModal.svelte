<script lang="ts">
  import type { ThreadGraph, ThreadGraphNode, ThreadNodeKind } from '$lib/jkai/thread-graph';
  import {
    MODAL_LAYOUT,
    placeNodes,
    drawEdges,
    canvasHeight,
  } from '$lib/jkai/graph-layout';
  import { nodeStyle, edgeStyle, legendFor } from '$lib/jkai/graph-colors';

  let {
    graph,
    selectedId,
    onSelect,
    onClose,
  }: {
    graph: ThreadGraph;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onClose: () => void;
  } = $props();

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

  const legend = $derived(legendFor(graph.nodes, graph.edges));
  const placed = $derived(placeNodes(graph.nodes, MODAL_LAYOUT));
  const edges = $derived(drawEdges(graph.edges, placed, MODAL_LAYOUT, selected?.id ?? null));
  const height = $derived(canvasHeight(graph.nodes.length, MODAL_LAYOUT, 420));
  const width = 900;

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
      .sort((a, b) => (a.verb === 'MENTIONED WITH' ? 1 : 0) - (b.verb === 'MENTIONED WITH' ? 1 : 0));
  });

  /** Concept nodes are real intel entities, so the graph is a way INTO the
   *  intel surface rather than a dead end. Everything else keeps whatever
   *  provenance link the graph builder gave it. */
  const drillLabel = $derived(
    selected?.kind === 'concept' ? 'open in intel →' : selected?.href ? 'open →' : null,
  );

  // Portal to <body>: a modal nested inside the rail would be clipped by the
  // rail's overflow and trapped under the hub header's stacking context.
  // Deliberately a local action, NOT $lib/canvas/portal — that one re-appends
  // the node on destroy and resurrects the overlay.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="gm-backdrop" use:portal onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="gm-panel" role="dialog" aria-label="Thread knowledge graph" onclick={(e) => e.stopPropagation()}>
    <header class="gm-hd">
      <div class="gm-hd-left">
        <span class="gm-title">Knowledge graph</span>
        <span class="gm-count">
          {graph.nodes.length}
          {graph.nodes.length === 1 ? 'node' : 'nodes'} / {graph.edges.length}
          {graph.edges.length === 1 ? 'edge' : 'edges'}
        </span>
      </div>
      <div class="gm-hd-right">
        <a class="gm-chip" href="/jkai/intel">intel ↗</a>
        <button type="button" class="gm-chip" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </header>

    <div class="gm-body">
      <div class="gm-canvas-wrap">
        <div class="gm-canvas" style="height: {height}px; min-width: {width}px;">
          <svg class="gm-edges" {width} {height} aria-hidden="true">
            {#each edges as e, i (i)}
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
          {#each edges.filter((e) => e.active) as e, i (`l${i}`)}
            <span
              class="gm-edge-label"
              style="left: {(e.x1 + e.x2) / 2}px; top: {(e.y1 + e.y2) / 2}px;"
            >{e.verb}</span>
          {/each}
          {#each placed as node (node.id)}
            {@const s = nodeStyle(node)}
            <button
              type="button"
              class="gm-node"
              class:selected={node.id === selected?.id}
              style="left: {node.x}px; top: {node.y}px; --n-color: {s.color}; --n-fill: {s.fill};"
              onclick={() => onSelect(node.id)}
              title={s.hint}
            >
              <span class="gm-glyph" aria-hidden="true">{GLYPH[node.kind]}</span>
              <span class="gm-label">{node.name}</span>
            </button>
          {/each}
        </div>
        <div class="gm-legend">
          {#each legend as row (row.label)}
            <span class="lg-row" title={row.hint}>
              {#if row.kind === 'node'}
                <span class="lg-swatch" style="background: {row.color};"></span>
              {:else}
                <span class="lg-line" style="--lg-color: {row.color};" class:dashed={!!row.dash}></span>
              {/if}
              {row.label}
            </span>
          {/each}
        </div>
      </div>

      {#if selected}
        <aside class="gm-side">
          <div class="gm-type">{selected.type}</div>
          <div class="gm-name">{selected.name}</div>
          {#if selected.note}<p class="gm-note">{selected.note}</p>{/if}
          {#if drillLabel && selected.href}
            <a class="gm-drill" href={selected.href}>{drillLabel}</a>
          {/if}

          <div class="gm-rel-hd">Relations</div>
          {#if relations.length === 0}
            <p class="gm-note">Nothing else in this thread connects to it yet.</p>
          {:else}
            <div class="gm-rels">
              {#each relations as r, i (i)}
                <div class="gm-rel">
                  <button type="button" class="gm-rel-main" onclick={() => onSelect(r.target.id)}>
                    <span class="gm-verb">{r.verb}</span>
                    <span class="gm-target">{r.target.name}</span>
                    <span class="gm-where">{r.target.type}</span>
                  </button>
                  {#if r.target.href}
                    <a class="gm-rel-drill" href={r.target.href} aria-label="Open {r.target.name}">↗</a>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
</div>

<style>
  .gm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(26, 16, 8, 0.45);
  }
  .gm-panel {
    display: flex;
    flex-direction: column;
    width: min(1240px, 100%);
    max-height: 100%;
    /* Opaque — --card-bg is a 7% tint and would let the thread show through. */
    background: var(--surface-elevated);
    border: 2px solid rgba(26, 16, 8, 0.22);
    border-radius: 0;
  }

  .gm-hd {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 16px;
    border-bottom: 1px solid var(--divider);
  }
  .gm-hd-left,
  .gm-hd-right {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .gm-hd-right {
    align-items: center;
  }
  .gm-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
  }
  .gm-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .gm-chip {
    display: inline-flex;
    align-items: center;
    padding: 5px 9px;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .gm-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  .gm-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .gm-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 14px;
    padding: 8px 10px 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .lg-row {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .lg-swatch {
    width: 8px;
    height: 8px;
    flex: none;
  }
  .lg-line {
    width: 15px;
    height: 0;
    flex: none;
    border-top: 2px solid var(--lg-color);
  }
  .lg-line.dashed {
    border-top-style: dashed;
  }

  .gm-canvas-wrap {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background-color: var(--bg);
  }
  .gm-canvas {
    position: relative;
    background-image: radial-gradient(rgba(26, 16, 8, 0.13) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .gm-edges {
    position: absolute;
    left: 0;
    top: 0;
  }
  .gm-edge-label {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 1px 4px;
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
    pointer-events: none;
  }
  .gm-node {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 200px;
    padding: 6px 10px;
    /* Per-node provenance colour — see $lib/jkai/graph-colors. */
    background: var(--n-fill, var(--bg));
    border: 1px solid var(--n-color, rgba(26, 16, 8, 0.3));
    border-radius: 0;
    cursor: pointer;
    transition: border-color 0.2s ease-out, background 0.2s ease-out;
  }
  .gm-node:hover {
    border-color: var(--accent-tint-35);
  }
  .gm-node.selected {
    background: var(--n-color);
    border: 2px solid var(--n-color);
  }
  .gm-glyph {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--n-color, var(--accent));
  }
  .gm-node.selected .gm-glyph {
    color: rgba(255, 255, 255, 0.8);
  }
  .gm-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gm-node.selected .gm-label {
    color: #fff;
  }

  .gm-side {
    flex: none;
    width: 320px;
    padding: 16px;
    border-left: 1px solid var(--divider);
    overflow-y: auto;
  }
  .gm-type {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
  }
  .gm-name {
    margin-top: 6px;
    font-family: var(--font-brand);
    font-size: var(--fs-body-lg);
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .gm-note {
    margin: 8px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .gm-drill {
    display: inline-flex;
    margin-top: 12px;
    padding: 6px 10px;
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-sharp);
    background: var(--accent-tint-08);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    text-decoration: none;
  }
  .gm-drill:hover {
    background: var(--accent);
    color: #fff;
  }

  .gm-rel-hd {
    margin-top: 20px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
  }
  .gm-rels {
    display: flex;
    flex-direction: column;
  }
  .gm-rel {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid rgba(26, 16, 8, 0.06);
  }
  .gm-rel-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 0;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .gm-rel-main:hover .gm-target {
    color: var(--accent);
  }
  .gm-verb {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
  }
  .gm-target {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gm-where {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.4);
  }
  .gm-rel-drill {
    flex: none;
    padding: 4px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-decoration: none;
  }
  .gm-rel-drill:hover {
    color: var(--accent);
  }

  @media (max-width: 899px) {
    .gm-backdrop {
      padding: 0;
    }
    .gm-panel {
      height: 100%;
      border-width: 0;
    }
    .gm-body {
      flex-direction: column;
    }
    .gm-side {
      width: auto;
      border-left: none;
      border-top: 1px solid var(--divider);
    }
  }
</style>
