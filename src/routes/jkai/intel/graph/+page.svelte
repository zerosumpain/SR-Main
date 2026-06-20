<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { onMount } from 'svelte';
  import * as d3 from 'd3';

  interface GraphNode extends d3.SimulationNodeDatum {
    id: string;
    name: string;
    type: string;
    icon: string;
    color: string;
    summary: string | null;
    connectionCount: number;
    confirmed: boolean;
  }

  interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
    id: string;
    type: string;
    label: string | null;
    strength: string;
  }

  interface GraphType {
    id: string;
    name: string;
    icon: string;
    color: string;
  }

  let container: HTMLDivElement;
  let nodes = $state<GraphNode[]>([]);
  let edges = $state<GraphEdge[]>([]);
  let types = $state<GraphType[]>([]);
  let activeTypeId = $state<string | null>(null);
  let loading = $state(true);
  let hoveredNode = $state<GraphNode | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  async function loadGraph(typeId?: string) {
    loading = true;
    const params = typeId ? `?typeId=${typeId}` : '';
    const res = await fetch(`/api/jkai/intel/graph${params}`);
    if (res.ok) {
      const data = await res.json();
      nodes = data.nodes;
      edges = data.edges;
      types = data.types;
    }
    loading = false;
  }

  function filterByType(typeId: string | null) {
    activeTypeId = typeId;
    loadGraph(typeId ?? undefined);
  }

  onMount(() => {
    loadGraph();
  });

  $effect(() => {
    if (loading || !container || nodes.length === 0) return;

    d3.select(container).selectAll('svg').remove();

    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        }) as any
    );

    const maxConns = Math.max(1, ...nodes.map((n) => n.connectionCount));
    const radiusScale = d3.scaleSqrt().domain([0, maxConns]).range([8, 30]);

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => radiusScale(d.connectionCount) + 5));

    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#4a4a6a')
      .attr('stroke-width', (d) => d.strength === 'strong' ? 2.5 : d.strength === 'moderate' ? 1.5 : 0.8)
      .attr('stroke-opacity', 0.6);

    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .text((d) => d.type.replace(/_/g, ' '))
      .attr('font-size', '9px')
      .attr('fill', '#6b7280')
      .attr('text-anchor', 'middle')
      .attr('dy', -4);

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as any
      );

    node.append('circle')
      .attr('r', (d) => radiusScale(d.connectionCount))
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.2)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', (d) => d.confirmed ? 2 : 1)
      .attr('stroke-dasharray', (d) => d.confirmed ? 'none' : '3,3');

    node.append('text')
      .text((d) => d.icon)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', (d) => `${Math.max(12, radiusScale(d.connectionCount) * 0.8)}px`);

    node.append('text')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => radiusScale(d.connectionCount) + 14)
      .attr('font-size', '11px')
      .attr('fill', '#e5e7eb')
      .attr('font-weight', '500');

    node.on('mouseover', (event: MouseEvent, d) => {
      hoveredNode = d;
      tooltipX = event.pageX;
      tooltipY = event.pageY;
    }).on('mouseout', () => {
      hoveredNode = null;
    });

    node.on('click', (_: MouseEvent, d) => {
      window.location.href = `/jkai/intel/entities/${d.id}`;
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  });
</script>

<PageHeader title="GRAPH" titleHref="/jkai/intel" />

<div class="p-6 sm:p-10 max-w-full mx-auto" style="height: calc(100vh - 60px); display: flex; flex-direction: column;">
  <div class="flex flex-wrap gap-2 mb-4 flex-shrink-0">
    <button
      onclick={() => filterByType(null)}
      class="px-3 py-1.5 rounded-full text-xs border"
      style="{!activeTypeId ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
    >All</button>
    {#each types as type}
      <button
        onclick={() => filterByType(type.id)}
        class="px-3 py-1.5 rounded-full text-xs border"
        style="{activeTypeId === type.id ? 'background: var(--accent); color: white; border-color: var(--accent);' : 'background: var(--card-bg); border-color: var(--card-border);'}"
      >{type.icon} {type.name}</button>
    {/each}
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center" style="color: var(--text-ghost);">Loading graph...</div>
  {:else if nodes.length === 0}
    <div class="flex-1 flex items-center justify-center" style="color: var(--text-ghost);">
      <p>No entities yet. Add notes to build your knowledge graph.</p>
    </div>
  {:else}
    <!-- Dark background intentionally kept for the graph canvas — looks better for visualisation -->
    <div class="flex-1 bg-gray-950 rounded-[var(--radius-round)] overflow-hidden relative" bind:this={container}>
    </div>
    <div class="text-xs mt-2 text-center flex-shrink-0" style="color: var(--text-ghost);">
      {nodes.length} entities &middot; {edges.length} relationships &middot; Drag to rearrange &middot; Scroll to zoom &middot; Click to view
    </div>
  {/if}

  {#if hoveredNode}
    <div
      class="fixed rounded-[var(--radius-round)] px-3 py-2 text-sm pointer-events-none z-50 max-w-xs border"
      style="left: {tooltipX + 12}px; top: {tooltipY - 10}px; background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="font-medium">{hoveredNode.icon} {hoveredNode.name}</div>
      <div class="text-xs" style="color: var(--text-ghost);">{hoveredNode.type} &middot; {hoveredNode.connectionCount} connections</div>
      {#if hoveredNode.summary}
        <div class="text-xs mt-1 line-clamp-3" style="color: var(--text-secondary);">{hoveredNode.summary}</div>
      {/if}
    </div>
  {/if}
</div>
