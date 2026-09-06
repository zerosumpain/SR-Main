<script lang="ts">
  /**
   * The thread's entities in three dimensions, inside the drill.
   *
   * This is the intel page's `NetworkGraph3D` fed a different graph, not a
   * second 3D view: every interaction (drag, hover, click, double-click,
   * camera framing) is that component's. It is told to colour by CATEGORY and
   * handed one category per node — the four classes the rail cares about —
   * with a colour per class. The legend below is those four, with counts, so
   * the picture is read the same way whether or not the viewer knows the
   * rail's hue rule.
   *
   * Loaded lazily by the modal: three.js is not something every drill pays for.
   */
  import NetworkGraph3D from '$lib/components/intel/NetworkGraph3D.svelte';
  import { GRAPH_CLASS, GRAPH_CLASSES, toNetGraph } from '$lib/jkai/context-panel/graph3d';
  import type { DrillGraph } from '$lib/jkai/context-panel/types';

  let {
    graph,
    onOpen,
  }: {
    graph: DrillGraph;
    /** A node's drill key — the modal navigates to it. */
    onOpen?: (drill: string) => void;
  } = $props();

  const net = $derived(toNetGraph(graph));
  const drillOf = $derived(new Map(graph.nodes.map((n) => [n.id, n.drill])));
  let selectedId = $state<string | null>(null);

  function open(id: string): void {
    const drill = drillOf.get(id);
    if (drill) onOpen?.(drill);
  }
</script>

<div class="g3">
  <div class="g3-scene">
    {#key graph.nodes.length}
      <NetworkGraph3D
        nodes={net.nodes}
        edges={net.edges}
        colourBy="category"
        categoryColours={net.categoryColours}
        showShells={false}
        explode={1.2}
        {selectedId}
        onSelect={(id) => (selectedId = id)}
        onOpen={open}
      />
    {/key}
  </div>
  <div class="g3-legend" aria-label="What the colours mean">
    {#each GRAPH_CLASSES as cls (cls)}
      <span class="g3-key" class:quiet={net.counts[cls] === 0}>
        <i style="background: {GRAPH_CLASS[cls].colour}"></i>
        {GRAPH_CLASS[cls].label}
        <b>{net.counts[cls]}</b>
      </span>
    {/each}
    <span class="g3-hint">named relations drawn; co-occurrence only where it tethers a loose node · drag · click · double-click opens</span>
  </div>
</div>

<style>
  .g3 {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
  }
  /* The intel component fills its host and floors itself at 420px; the modal
     gives it a fixed band so the sections beneath keep their place. */
  .g3-scene {
    height: 480px;
    min-height: 0;
  }
  .g3-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    padding: 8px 18px 10px;
    border-top: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .g3-key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .g3-key.quiet {
    color: var(--text-ghost);
  }
  .g3-key i {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: var(--radius-pill);
  }
  .g3-key b {
    font-weight: 500;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .g3-hint {
    margin-left: auto;
    color: var(--text-ghost);
    text-transform: none;
    letter-spacing: 0;
  }
  @media (max-width: 899px) {
    .g3-scene {
      height: 360px;
    }
    .g3-hint {
      display: none;
    }
  }
</style>
