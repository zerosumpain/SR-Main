<script lang="ts" module>
  export interface GraphNode {
    id: string;
    name: string;
    type: string;
    degree: number;
    /** 0..1 centrality from the report. Drives fill. */
    weight: number;
  }
  export interface GraphEdge {
    source: string;
    target: string;
    kind: string;
    strength: number;
  }
</script>

<script lang="ts">
  /**
   * The session's entity network.
   *
   * Encoding decisions, in the order the dataviz procedure asks them:
   *
   *  - **Form:** magnitude + relationship, so a node-link diagram. Size carries
   *    degree; position carries the force layout's clustering.
   *  - **Colour:** a SINGLE-hue sequential ramp on centrality, not a categorical
   *    palette by entity type. Two reasons — the site's palette is cream/ink/
   *    burnt-orange and inventing seven type hues would break it, and the intel
   *    graph already learned that type-coloured nodes "told you nothing you
   *    couldn't read from the label". Type lives in the label and the tooltip.
   *  - **Relief:** the palest steps of that ramp sit near 1.2:1 against the cream
   *    surface, which the contrast check flags as needing relief rather than
   *    dismissal. So every node carries a solid ink stroke and the strongest
   *    nodes are directly labelled — a faint fill is never the only thing
   *    holding a node together.
   *
   * d3 handles (simulation, zoom) are plain `let`, never `$state`: a simulation
   * that both reads and writes reactive state from its tick handler is the
   * documented route to `effect_update_depth_exceeded`.
   */
  import * as d3 from 'd3';
  import { onMount } from 'svelte';

  let {
    nodes = [],
    edges = [],
    height = 380,
  }: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    height?: number;
  } = $props();

  let svgEl: SVGSVGElement | null = null;
  // Never $state — see the header note.
  let sim: d3.Simulation<any, any> | null = null;

  let hovered = $state<{ name: string; type: string; degree: number; x: number; y: number } | null>(null);
  let width = $state(760);

  /** How many nodes get a permanent label. More than this and they collide. */
  const LABELLED = 10;

  const ordered = $derived([...nodes].sort((a, b) => b.weight - a.weight));
  const labelled = $derived(new Set(ordered.slice(0, LABELLED).map((n) => n.id)));

  /**
   * Sequential fill. Floor deliberately above the ramp's lightest step: a node
   * at 1.18:1 against cream is invisible, and the point of the low end is
   * "less central", not "absent".
   */
  function fill(weight: number): string {
    const a = 0.22 + Math.max(0, Math.min(1, weight)) * 0.68;
    return `rgba(196, 87, 10, ${a.toFixed(3)})`;
  }

  function radius(n: GraphNode): number {
    return 4 + Math.sqrt(Math.max(1, n.degree)) * 2.4;
  }

  onMount(() => {
    if (!svgEl || nodes.length === 0) return;
    const box = svgEl.getBoundingClientRect();
    width = box.width || 760;

    const simNodes = nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e }));

    const svg = d3.select(svgEl);
    const g = svg.append('g');

    const link = g
      .append('g')
      .attr('stroke', 'rgba(26, 16, 8, 0.22)')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke-width', (d: any) => 0.6 + (d.strength ?? 0.5) * 1.4);

    const node = g
      .append('g')
      .selectAll('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', (d: any) => radius(d))
      .attr('fill', (d: any) => fill(d.weight))
      // The stroke is the relief the contrast check obliges — it is what makes
      // a low-centrality node legible at all on cream.
      .attr('stroke', '#1a1008')
      .attr('stroke-width', 1.1)
      .style('cursor', 'pointer');

    node
      .on('mouseenter', (event: MouseEvent, d: any) => {
        const r = svgEl!.getBoundingClientRect();
        hovered = {
          name: d.name,
          type: d.type,
          degree: d.degree,
          x: event.clientX - r.left,
          y: event.clientY - r.top,
        };
      })
      .on('mouseleave', () => {
        hovered = null;
      });

    const label = g
      .append('g')
      .selectAll('text')
      .data(simNodes.filter((n) => labelled.has(n.id)))
      .join('text')
      .text((d: any) => (d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name))
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', 12)
      .attr('fill', 'var(--text-primary)')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#ede4d4')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none');

    sim = d3
      .forceSimulation(simNodes as any)
      .force('link', d3.forceLink(simLinks as any).id((d: any) => d.id).distance(70).strength(0.35))
      .force('charge', d3.forceManyBody().strength(-120).distanceMax(420))
      .force('center', d3.forceCenter(width / 2, height / 2))
      // Most entities in a research session have NO relationship at all — this
      // run had 36 entities and 17 edges. Without a homing force those isolated
      // nodes are pushed outward by charge with nothing pulling them back, and
      // they end up beyond the viewport: the first render showed five nodes of
      // thirty-six. forceCenter only moves the mean, so it does not help.
      .force('x', d3.forceX(width / 2).strength(0.06))
      .force('y', d3.forceY(height / 2).strength(0.09))
      .force('collide', d3.forceCollide().radius((d: any) => radius(d) + 6))
      .on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);
        node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
        label.attr('x', (d: any) => d.x + radius(d) + 4).attr('y', (d: any) => d.y + 4);
      });

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(zoom as any);

    /**
     * Frame everything once the layout settles.
     *
     * A force layout has no idea what the viewport is, so whatever it produces
     * has to be fitted afterwards. Without this the graph is only accidentally
     * in view — and for a sparse network it mostly is not.
     */
    sim.on('end', () => {
      const xs = simNodes.map((n: any) => n.x ?? 0);
      const ys = simNodes.map((n: any) => n.y ?? 0);
      if (!xs.length) return;
      const pad = 48;
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const scale = Math.min(2, Math.min(width / bw, height / bh));
      const tx = width / 2 - ((minX + maxX) / 2) * scale;
      const ty = height / 2 - ((minY + maxY) / 2) * scale;
      svg
        .transition()
        .duration(400)
        .call(zoom.transform as any, d3.zoomIdentity.translate(tx, ty).scale(scale));
    });

    return () => {
      sim?.stop();
      sim = null;
      svg.selectAll('*').remove();
    };
  });
</script>

<div class="wrap" style:height="{height}px">
  {#if nodes.length === 0}
    <p class="note">No entities were extracted for this run.</p>
  {:else}
    <svg bind:this={svgEl} {height} role="img" aria-label="Entity network: {nodes.length} entities, {edges.length} relationships"
    ></svg>
    {#if hovered}
      <div class="tip" style:left="{hovered.x + 12}px" style:top="{hovered.y + 12}px">
        <b>{hovered.name}</b>
        <span>{hovered.type} · {hovered.degree} link{hovered.degree === 1 ? '' : 's'}</span>
      </div>
    {/if}
    <div class="scale" aria-hidden="true">
      <span>less central</span>
      <span class="swatch s1"></span><span class="swatch s2"></span><span class="swatch s3"></span><span class="swatch s4"></span>
      <span>more</span>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; width: 100%; overflow: hidden; }
  svg { width: 100%; display: block; }
  .note { margin: 0; padding: 1rem; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; }

  .tip {
    position: absolute; pointer-events: none; z-index: 2;
    background: var(--surface-elevated); border: 1px solid var(--text-primary);
    padding: 4px 7px; display: grid; gap: 1px; max-width: 240px;
  }
  .tip b { font-size: 0.85rem; }
  .tip span { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .scale { position: absolute; left: 8px; bottom: 6px; display: flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .swatch { width: 14px; height: 9px; border: 1px solid var(--text-primary); }
  .s1 { background: rgba(196, 87, 10, 0.22); }
  .s2 { background: rgba(196, 87, 10, 0.44); }
  .s3 { background: rgba(196, 87, 10, 0.66); }
  .s4 { background: rgba(196, 87, 10, 0.9); }
</style>
