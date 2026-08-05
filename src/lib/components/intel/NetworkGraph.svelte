<script lang="ts">
  // The intel network, drawn as a force-directed link chart.
  //
  // Differences from the old /jkai/intel/graph, all of which came from looking
  // at the real 492-entity graph:
  //   - nodes are sized by PageRank, not raw degree, so one mega-hub does not
  //     flatten everything else into identical dots
  //   - colour is by detected community, with entity-type shown as the icon —
  //     type-coloured nodes told you nothing you couldn't read from the label
  //   - cross-community edges are drawn in accent, because they are the
  //     interesting ones
  //   - labels appear for the most important nodes and on hover, rather than
  //     for all or none
  //   - a highlighted path can be overlaid on the layout
  //
  // d3 handles (simulation, zoom behaviour, selections) are plain `let`, never
  // $state: nothing reactive reads them, and a simulation that both reads and
  // writes reactive state from its tick handler is the documented route to
  // effect_update_depth_exceeded.

  import * as d3 from 'd3';
  import { untrack } from 'svelte';

  import type { NetNode, NetEdge } from './types';
  import { recencyFade } from './graph-visual';

  let {
    nodes = [],
    edges = [],
    highlightPath = null,
    matchedIds = [],
    selectedId = null,
    onSelect,
    onOpen,
  }: {
    nodes: NetNode[];
    edges: NetEdge[];
    /** Ordered entity ids to draw as a highlighted route. */
    highlightPath?: string[] | null;
    /**
     * Literal hits from the keyword filter. The rest of what is drawn is the
     * neighbourhood around them — context, not answer — so it is dimmed rather
     * than removed: a keyword view with no edges says nothing about a network.
     */
    matchedIds?: string[];
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onOpen?: (id: string) => void;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let hovered = $state<NetNode | null>(null);
  let tooltip = $state({ x: 0, y: 0 });

  // ── Non-reactive d3 handles ────────────────────────────────────────────────
  type SimNode = NetNode & d3.SimulationNodeDatum;
  type SimEdge = d3.SimulationLinkDatum<SimNode> & NetEdge;

  let simulation: d3.Simulation<SimNode, SimEdge> | null = null;
  let svgEl: SVGSVGElement | null = null;
  let zoomBehaviour: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let rootGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** Node positions survive a filter change so the layout does not jump. */
  const positions = new Map<string, { x: number; y: number }>();

  /**
   * Cluster colours. Distinct enough to tell apart, muted enough to sit on the
   * cream background without shouting. Communities beyond this cycle.
   */
  const CLUSTER_COLOURS = [
    '#0e5b66', '#c4570a', '#2d7a3a', '#7a3a8a', '#b0892a',
    '#3a6ea5', '#a53a3a', '#4a7a6a', '#8a5a2a', '#5a4a8a',
  ];
  const clusterColour = (c: number) => CLUSTER_COLOURS[c % CLUSTER_COLOURS.length];

  const pathSet = $derived(new Set(highlightPath ?? []));
  const matchSet = $derived(new Set(matchedIds ?? []));
  /** Only dim when there is something to dim AGAINST. */
  const dimming = $derived(matchSet.size > 0);
  const pathEdgeKeys = $derived.by(() => {
    const set = new Set<string>();
    const p = highlightPath ?? [];
    for (let i = 0; i < p.length - 1; i++) {
      set.add([p[i], p[i + 1]].sort().join('|'));
    }
    return set;
  });

  function radius(n: NetNode): number {
    // sqrt so a 10× importance difference is a ~3× size difference.
    return 5 + Math.sqrt(Math.max(0, n.importance)) * 20;
  }

  /**
   * An edge endpoint's id. d3's forceLink mutates `source`/`target` from the id
   * string into the node object once the simulation is built, so anything
   * reading them afterwards has to handle both forms.
   */
  function endpointId(v: unknown): string {
    return typeof v === 'string' ? v : ((v as { id?: string })?.id ?? '');
  }

  function destroy() {
    simulation?.stop();
    simulation = null;
    if (svgEl) d3.select(svgEl).remove();
    svgEl = null;
    rootGroup = null;
    zoomBehaviour = null;
  }

  function render() {
    if (!container) return;
    destroy();

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Copies, because d3's force layout mutates the data it is given and the
    // props belong to the parent.
    const simNodes: SimNode[] = nodes.map((n) => {
      const prev = positions.get(n.id);
      return { ...n, x: prev?.x, y: prev?.y };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e }));

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, width, height].join(' '))
      .attr('role', 'img')
      .attr('aria-label', `Intel network, ${simNodes.length} entities`);
    svgEl = svg.node();

    const g = svg.append('g');
    rootGroup = g;

    zoomBehaviour = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on('zoom', (event) => g.attr('transform', event.transform.toString()));
    svg.call(zoomBehaviour);
    // Clicking empty canvas clears the selection.
    svg.on('click', (event) => {
      if (event.target === svgEl) onSelect?.(null);
    });

    simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          // Well-connected pairs sit closer; peripheral ones get room to breathe.
          .distance((l) => 40 + 60 / (1 + Math.min((l.source as SimNode).degree ?? 1, 6)))
          .strength(0.35),
      )
      .force('charge', d3.forceManyBody<SimNode>().strength((d) => -120 - radius(d) * 12))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => radius(d) + 4))
      // Pull clusters apart along x so communities read as separate regions.
      .force('x', d3.forceX<SimNode>((d) => width / 2 + (((d.community % 5) - 2) * width) / 7).strength(0.045))
      .force('y', d3.forceY(height / 2).strength(0.045));

    const link = g
      .append('g')
      .attr('fill', 'none')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      // `d3.forceLink().id()` has already replaced source/target with the node
      // OBJECTS by this point, so they must be read through endpointId — casting
      // them to string produced "[object Object]" keys and the highlighted path
      // was never actually drawn in accent.
      .attr('stroke', (d) =>
        pathEdgeKeys.has([endpointId(d.source), endpointId(d.target)].sort().join('|'))
          ? 'var(--accent)'
          : d.crossCommunity
            ? 'rgba(196, 87, 10, 0.42)'
            : 'rgba(26, 16, 8, 0.16)',
      )
      .attr('stroke-width', (d) => (d.strength === 'strong' ? 2 : d.strength === 'weak' ? 0.7 : 1.2))
      // Older evidence recedes. The colours above already carry their own alpha,
      // so this multiplies on top rather than replacing it.
      .attr('stroke-opacity', (d) => recencyFade(d.recency));

    const node = g
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation?.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    node
      .append('circle')
      .attr('r', (d) => radius(d))
      .attr('fill', (d) => clusterColour(d.community))
      .attr('fill-opacity', (d) =>
        // Keyword dimming first, then age. A node that is both off-keyword and
        // stale must not vanish, so the age term is floored — see recencyFade.
        (dimming && !matchSet.has(d.id) ? 0.14 : d.confirmed ? 0.85 : 0.4) *
        recencyFade(d.recency),
      )
      .attr('stroke', (d) =>
        d.id === selectedId ? 'var(--accent)' : pathSet.has(d.id) ? 'var(--accent)' : 'rgba(237,228,212,0.9)',
      )
      .attr('stroke-width', (d) => (d.id === selectedId || pathSet.has(d.id) ? 3 : 1.5));

    // A ring marks a broker — an entity holding separate clusters together.
    node
      .filter((d) => d.brokerage > 0.02)
      .append('circle')
      .attr('r', (d) => radius(d) + 3.5)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 2')
      .attr('opacity', 0.75);

    // Labels only for entities big enough to earn one, plus anything on a
    // highlighted path or matching the keyword. Everything else labels on hover.
    node
      .filter((d) => radius(d) > 10 || pathSet.has(d.id) || matchSet.has(d.id))
      .append('text')
      .text((d) => (d.name.length > 26 ? `${d.name.slice(0, 24)}…` : d.name))
      .attr('x', (d) => radius(d) + 5)
      .attr('y', 4)
      // 13 == --fs-label. Kept as a literal number because this is an SVG
      // presentation attribute: browsers do not substitute var() there, so a
      // token would silently fall back to the inherited size.
      .attr('font-size', 13)
      .attr('font-family', 'var(--font-body)')
      .attr('fill', 'var(--text-secondary)')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none');

    node
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation();
        onSelect?.(d.id);
      })
      .on('dblclick', (event: MouseEvent, d) => {
        event.stopPropagation();
        onOpen?.(d.id);
      })
      .on('mouseenter', (event: MouseEvent, d) => {
        hovered = d;
        const rect = container?.getBoundingClientRect();
        tooltip = {
          x: event.clientX - (rect?.left ?? 0) + 14,
          y: event.clientY - (rect?.top ?? 0) + 14,
        };
      })
      .on('mousemove', (event: MouseEvent) => {
        const rect = container?.getBoundingClientRect();
        tooltip = {
          x: event.clientX - (rect?.left ?? 0) + 14,
          y: event.clientY - (rect?.top ?? 0) + 14,
        };
      })
      .on('mouseleave', () => {
        hovered = null;
      });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simulation.on('end', () => {
      for (const n of simNodes) {
        if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y });
      }
      fitToView(simNodes, width, height);
    });

    // Fit once early too. A large graph takes seconds to settle, and until it
    // does the layout can spread far outside the viewport — the first thing the
    // user sees would otherwise be a mostly empty canvas with the graph
    // off-screen.
    let fitted = false;
    simulation.on('tick.fit', () => {
      if (fitted || (simulation?.alpha() ?? 1) > 0.35) return;
      fitted = true;
      fitToView(simNodes, width, height);
    });
  }

  /**
   * Zoom and pan so the BULK of the graph fills the viewport.
   *
   * Deliberately fits the 4th–96th percentile of node positions rather than the
   * absolute extremes. The real graph has ~180 disconnected fragments that the
   * layout flings to the edges; fitting to those shrank the main body — the part
   * anyone actually wants to read — to a cluster of dots in the centre.
   * Outliers stay reachable by scrolling out.
   */
  function fitToView(simNodes: SimNode[], width: number, height: number) {
    if (!svgEl || !zoomBehaviour || !simNodes.length) return;

    const xs = simNodes.map((n) => n.x).filter((v): v is number => v != null).sort((a, b) => a - b);
    const ys = simNodes.map((n) => n.y).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (!xs.length || !ys.length) return;

    const lo = (arr: number[]) => arr[Math.floor(arr.length * 0.04)];
    const hi = (arr: number[]) => arr[Math.min(arr.length - 1, Math.ceil(arr.length * 0.96))];
    const margin = 30;

    let minX = lo(xs) - margin;
    let maxX = hi(xs) + margin;
    let minY = lo(ys) - margin;
    let maxY = hi(ys) + margin;
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return;

    const pad = 40;
    const scale = Math.min(
      6,
      Math.max(0.15, Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY))),
    );
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 - ((minY + maxY) / 2) * scale;

    d3.select(svgEl)
      .transition()
      .duration(400)
      .call(zoomBehaviour.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // Full rebuild ONLY when the data or the highlighted path changes. The reads
  // that should re-trigger are hoisted and tracked; everything render() does is
  // untracked, so mutating `hovered`/`tooltip` from d3 handlers can never feed
  // back into this effect.
  //
  // `selectedId` is deliberately NOT a dependency here. It used to be, which
  // meant every click on a node tore down the SVG and restarted the force
  // simulation from scratch — hundreds of elements rebuilt and the layout
  // visibly jumping, just to move one highlight ring. Selection is a paint
  // change, so it repaints in place below.
  $effect(() => {
    nodes;
    edges;
    highlightPath;
    matchedIds;
    container;
    untrack(() => render());
  });

  // Selection repaint: restyle the existing circles rather than rebuilding.
  $effect(() => {
    const id = selectedId;
    if (!rootGroup) return;
    untrack(() => {
      rootGroup!
        .selectAll<SVGCircleElement, SimNode>('g.node > circle:first-of-type')
        .attr('stroke', (d) =>
          d.id === id || pathSet.has(d.id) ? 'var(--accent)' : 'rgba(237,228,212,0.9)',
        )
        .attr('stroke-width', (d) => (d.id === id || pathSet.has(d.id) ? 3 : 1.5));
    });
  });

  $effect(() => {
    const el = container;
    if (!el || typeof ResizeObserver === 'undefined') return;

    // Debounced: a resize fires continuously while a pane is dragged, and
    // render() is a full teardown-and-rebuild of every element.
    let pending: ReturnType<typeof setTimeout> | null = null;
    resizeObserver = new ResizeObserver(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        untrack(() => render());
      }, 220);
    });
    resizeObserver.observe(el);
    return () => {
      if (pending) clearTimeout(pending);
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  $effect(() => () => destroy());

  export function resetZoom() {
    if (svgEl && zoomBehaviour) {
      d3.select(svgEl).transition().duration(300).call(zoomBehaviour.transform, d3.zoomIdentity);
    }
  }
</script>

<div class="graph-host" bind:this={container}>
  {#if nodes.length === 0}
    <div class="empty">Nothing matches these filters.</div>
  {/if}

  {#if hovered}
    <div class="tip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
      <div class="tip-head">
        <span>{hovered.icon}</span>
        <strong>{hovered.name}</strong>
      </div>
      <div class="tip-meta">{hovered.type} · {hovered.degree} links</div>
      {#if hovered.summary}
        <p>{hovered.summary.slice(0, 160)}{hovered.summary.length > 160 ? '…' : ''}</p>
      {/if}
      {#if hovered.brokerage > 0.02}
        <div class="tip-flag">Connects separate clusters</div>
      {/if}
      <div class="tip-hint">Click to inspect · double-click to open</div>
    </div>
  {/if}
</div>

<style>
  .graph-host {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 420px;
    overflow: hidden;
    background: var(--bg);
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  .tip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    max-width: 280px;
    /* Opaque — it floats over the graph. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 8px 10px;
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .tip-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .tip-head strong {
    font-weight: 600;
  }
  .tip-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-transform: lowercase;
  }
  .tip p {
    margin: 5px 0 0;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .tip-flag {
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tip-hint {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .graph-host :global(.node:hover circle) {
    fill-opacity: 1;
  }
</style>
