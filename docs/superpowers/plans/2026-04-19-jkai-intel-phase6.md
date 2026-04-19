# JKAI Intel Phase 6 — Graph Visualisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive force-directed graph visualisation of the entity network at `/jkai/intel/graph`. Nodes are entities (sized by connection count, coloured by type). Edges are relationships. Clickable to navigate to entity dossiers. Filterable by entity type.

**Architecture:** D3.js force simulation rendered to SVG within a SvelteKit page. Graph data loaded from a new API endpoint that returns nodes + edges. Client-side filtering and interaction.

**Tech Stack:** SvelteKit, D3.js (d3-force, d3-selection, d3-zoom), Tailwind CSS

---

### Task 1: Graph Data API Endpoint

**Files:**
- Create: `src/routes/api/jkai/intel/graph/+server.ts`

- [ ] **Step 1: Create the graph data endpoint**

Create `src/routes/api/jkai/intel/graph/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelRelationships } from '$lib/db/schema';
import { eq, sql, isNull } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const typeId = url.searchParams.get('typeId') ?? undefined;

  // Load all non-merged entities
  const entityConditions = [isNull(intelEntities.mergedIntoId)];
  if (typeId) entityConditions.push(eq(intelEntities.typeId, typeId));

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      connectionCount: sql<number>`(
        SELECT count(*) FROM intel_relationships
        WHERE intel_relationships.source_entity_id = intel_entities.id
           OR intel_relationships.target_entity_id = intel_entities.id
      )::int`.as('connection_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(sql`${intelEntities.mergedIntoId} IS NULL ${typeId ? sql`AND ${intelEntities.typeId} = ${typeId}` : sql``}`);

  const entityIds = new Set(entities.map((e) => e.id));

  // Load relationships between visible entities
  const relationships = await db
    .select({
      id: intelRelationships.id,
      sourceId: intelRelationships.sourceEntityId,
      targetId: intelRelationships.targetEntityId,
      type: intelRelationships.type,
      label: intelRelationships.label,
      strength: intelRelationships.strength,
    })
    .from(intelRelationships);

  // Filter to only include edges where both endpoints are in the visible set
  const edges = relationships.filter((r) => entityIds.has(r.sourceId) && entityIds.has(r.targetId));

  // Load entity types for filter UI
  const types = await db
    .select({
      id: intelEntityTypes.id,
      name: intelEntityTypes.name,
      icon: intelEntityTypes.icon,
      color: intelEntityTypes.color,
    })
    .from(intelEntityTypes);

  return json({
    nodes: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.typeName,
      icon: e.typeIcon,
      color: e.typeColor,
      summary: e.summary,
      connectionCount: e.connectionCount,
      confirmed: e.confirmed,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: e.type,
      label: e.label,
      strength: e.strength,
    })),
    types,
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/jkai/intel/graph/
git commit -m "feat(intel): add graph data API endpoint"
```

---

### Task 2: Install D3.js

- [ ] **Step 1: Install d3 dependencies**

```bash
npm install d3@7 && npm install -D @types/d3@7
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(intel): add d3.js dependency for graph visualisation"
```

---

### Task 3: Graph Visualisation Page

**Files:**
- Create: `src/routes/jkai/intel/graph/+page.svelte`

- [ ] **Step 1: Create the graph page**

Create `src/routes/jkai/intel/graph/+page.svelte`:

```svelte
<script lang="ts">
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

    // Clear previous SVG
    d3.select(container).selectAll('svg').remove();

    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Zoom
    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        }) as any
    );

    // Size scale based on connection count
    const maxConns = Math.max(1, ...nodes.map((n) => n.connectionCount));
    const radiusScale = d3.scaleSqrt().domain([0, maxConns]).range([8, 30]);

    // Force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => radiusScale(d.connectionCount) + 5));

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#4a4a6a')
      .attr('stroke-width', (d) => d.strength === 'strong' ? 2.5 : d.strength === 'moderate' ? 1.5 : 0.8)
      .attr('stroke-opacity', 0.6);

    // Edge labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .text((d) => d.type.replace(/_/g, ' '))
      .attr('font-size', '9px')
      .attr('fill', '#6b7280')
      .attr('text-anchor', 'middle')
      .attr('dy', -4);

    // Nodes
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

    // Node circles
    node.append('circle')
      .attr('r', (d) => radiusScale(d.connectionCount))
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.2)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', (d) => d.confirmed ? 2 : 1)
      .attr('stroke-dasharray', (d) => d.confirmed ? 'none' : '3,3');

    // Node icons
    node.append('text')
      .text((d) => d.icon)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', (d) => `${Math.max(12, radiusScale(d.connectionCount) * 0.8)}px`);

    // Node labels
    node.append('text')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => radiusScale(d.connectionCount) + 14)
      .attr('font-size', '11px')
      .attr('fill', '#e5e7eb')
      .attr('font-weight', '500');

    // Hover
    node.on('mouseover', (event, d) => {
      hoveredNode = d;
      tooltipX = event.pageX;
      tooltipY = event.pageY;
    }).on('mouseout', () => {
      hoveredNode = null;
    });

    // Click to navigate
    node.on('click', (_, d) => {
      window.location.href = `/jkai/intel/entities/${d.id}`;
    });

    // Tick
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

<div class="p-6 max-w-full mx-auto h-screen flex flex-col">
  <div class="flex items-center justify-between mb-4 flex-shrink-0">
    <div>
      <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300">&larr; Dashboard</a>
      <h1 class="text-2xl font-bold mt-1">Knowledge Graph</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        onclick={() => filterByType(null)}
        class="px-3 py-1.5 rounded-full text-xs {!activeTypeId ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
      >All</button>
      {#each types as type}
        <button
          onclick={() => filterByType(type.id)}
          class="px-3 py-1.5 rounded-full text-xs {activeTypeId === type.id ? 'bg-sky-600' : 'bg-gray-800 hover:bg-gray-700'}"
        >{type.icon} {type.name}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="flex-1 flex items-center justify-center text-gray-500">Loading graph...</div>
  {:else if nodes.length === 0}
    <div class="flex-1 flex items-center justify-center text-gray-500">
      <p>No entities yet. Add notes to build your knowledge graph.</p>
    </div>
  {:else}
    <div class="flex-1 bg-gray-900 rounded-lg overflow-hidden relative" bind:this={container}>
    </div>
    <div class="text-xs text-gray-500 mt-2 text-center flex-shrink-0">
      {nodes.length} entities &middot; {edges.length} relationships &middot; Drag to rearrange &middot; Scroll to zoom &middot; Click to view
    </div>
  {/if}

  <!-- Tooltip -->
  {#if hoveredNode}
    <div
      class="fixed bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm pointer-events-none z-50 max-w-xs"
      style="left: {tooltipX + 12}px; top: {tooltipY - 10}px;"
    >
      <div class="font-medium">{hoveredNode.icon} {hoveredNode.name}</div>
      <div class="text-xs text-gray-400">{hoveredNode.type} &middot; {hoveredNode.connectionCount} connections</div>
      {#if hoveredNode.summary}
        <div class="text-xs text-gray-300 mt-1 line-clamp-3">{hoveredNode.summary}</div>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/jkai/intel/graph/
git commit -m "feat(intel): add interactive force-directed graph visualisation"
```
