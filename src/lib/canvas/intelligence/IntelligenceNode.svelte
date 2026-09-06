<script lang="ts">
  import { loadMapbox, type MapView } from '$lib/maps/loader';
  import { onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import FacetPopover from './FacetPopover.svelte';

  type IntelItem = {
    id: string;
    kind: 'note' | 'entity';
    title: string;
    snippet: string;
    createdAt: string;
    score: number;
    metadata?: { entityType?: string; sourceTag?: string };
  };
  type Facets = {
    entityTypes: string[];
    tags: string[];
    timeRange: { from: string; to: string } | null;
    ordering: 'recent' | 'relevant';
    limit: number;
  };

  type CategoryOption = {
    label: string;
    value: string;
    entityType: string | null; // null = wildcard; 'note' handled specially
  };

  const CATEGORY_OPTIONS: CategoryOption[] = [
    { label: 'everything', value: 'entity', entityType: null },
    { label: 'people', value: 'people', entityType: 'person' },
    { label: 'place', value: 'place', entityType: 'place' },
    { label: 'technology', value: 'technology', entityType: 'technology' },
    { label: 'project', value: 'project', entityType: 'project' },
    { label: 'note', value: 'note', entityType: 'NOTE' }, // special case
    { label: 'event', value: 'event', entityType: 'event' },
  ];

  type ViewMode = 'list' | 'detailed' | 'map' | 'graph';
  const VIEW_MODES: { value: ViewMode; label: string }[] = [
    { value: 'list', label: 'List' },
    { value: 'detailed', label: 'Detailed' },
    { value: 'map', label: 'Map' },
    { value: 'graph', label: 'Graph' },
  ];

  let {
    slug,
    nodeId,
    config = $bindable(),
    onsave,
    onexplore,
  } = $props<{
    slug: string;
    nodeId: string;
    config: {
      query?: string;
      facets?: Partial<Facets>;
      viewMode?: ViewMode;
      size?: { w: number; h: number };
    };
    onsave: (patch: Record<string, unknown>) => void;
    onexplore: (engine: 'deep' | 'quick') => void;
  }>();

  let query = $state(config.query ?? '');
  let facets = $state<Facets>({
    entityTypes: config.facets?.entityTypes ?? [],
    tags: config.facets?.tags ?? [],
    timeRange: config.facets?.timeRange ?? null,
    ordering: config.facets?.ordering ?? 'relevant',
    limit: config.facets?.limit ?? 20,
  });

  // Default category selection: ['entity'] = wildcard
  let selectedCategories = $state<string[]>(
    config.facets?.entityTypes && config.facets.entityTypes.length > 0
      ? config.facets.entityTypes.includes('NOTE')
        ? ['note', ...config.facets.entityTypes.filter((e: string) => e !== 'NOTE')]
        : config.facets.entityTypes
      : ['entity'],
  );

  let viewMode = $state<ViewMode>((config.viewMode as ViewMode) ?? 'list');

  let items = $state<IntelItem[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let facetsOpen = $state(false);
  let exploreOpen = $state(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- Map state ----

  let mapContainer = $state<HTMLDivElement | undefined>();
  let mapboxMap: MapView | null = null;
  let mapLoading = $state(false);
  let mapGeneration = 0;
  let mapError = $state<string | null>(null);
  type GeoItem = { id: string; name: string; lat: number; lng: number; type: string };
  let geoItems = $state<GeoItem[]>([]);
  let mapInitialized = $state(false);

  // ---- Graph state ----
  type GraphNode = { id: string; name: string; type: string; icon: string; color: string; summary: string | null; connectionCount: number };
  type GraphEdge = { id: string; source: string; target: string; type: string; label: string | null; strength: string };
  let graphContainer = $state<HTMLDivElement | undefined>();
  let graphLoading = $state(false);
  let graphError = $state<string | null>(null);
  let graphNodes = $state<GraphNode[]>([]);
  let graphEdges = $state<GraphEdge[]>([]);
  let graphInitialized = $state(false);
  let d3Simulation: d3.Simulation<GraphNode & d3.SimulationNodeDatum, undefined> | null = null;

  /** Convert selectedCategories pill values → entityTypes for the API. */
  function categoriesToEntityTypes(cats: string[]): string[] {
    if (cats.includes('entity')) return []; // wildcard = no filter
    const types: string[] = [];
    for (const cat of cats) {
      const opt = CATEGORY_OPTIONS.find((o) => o.value === cat);
      if (opt && opt.entityType && opt.entityType !== 'NOTE') {
        types.push(opt.entityType);
      }
    }
    return types;
  }

  function categoriesToIncludeNotes(cats: string[]): boolean {
    return cats.includes('note');
  }

  async function fetchPreview() {
    loading = true;
    try {
      const params = new URLSearchParams();
      params.set('query', query);
      params.set('limit', String(facets.limit));
      params.set('ordering', facets.ordering);
      const entityTypes = categoriesToEntityTypes(selectedCategories);
      for (const e of entityTypes) params.append('entityType', e);
      for (const t of facets.tags) params.append('tag', t);
      if (facets.timeRange) {
        params.set('from', facets.timeRange.from);
        params.set('to', facets.timeRange.to);
      }
      if (categoriesToIncludeNotes(selectedCategories)) {
        params.set('includeNotes', 'true');
      }
      const res = await fetch(`/api/canvas/${slug}/intel/preview?${params}`);
      if (res.ok) {
        const data = await res.json();
        items = data.items ?? [];
        total = data.total ?? 0;
      }
    } finally {
      loading = false;
    }
  }

  function scheduleFetch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, 300);
  }

  function onQueryInput() {
    onsave({ query });
    scheduleFetch();
  }

  function onFacetsChange(next: Facets) {
    facets = next;
    onsave({ facets });
    scheduleFetch();
  }

  function toggleCategory(value: string) {
    if (value === 'entity') {
      // Selecting wildcard clears all others
      selectedCategories = ['entity'];
    } else {
      const without = selectedCategories.filter((c) => c !== value && c !== 'entity');
      if (selectedCategories.includes(value)) {
        // Deselect
        const next = without;
        selectedCategories = next.length > 0 ? next : ['entity'];
      } else {
        selectedCategories = [...without, value];
      }
    }
    const entityTypes = categoriesToEntityTypes(selectedCategories);
    const includeNotes = categoriesToIncludeNotes(selectedCategories);
    const updatedFacets = { ...facets, entityTypes };
    facets = updatedFacets;
    onsave({ facets: updatedFacets, ...(includeNotes ? { includeNotes: true } : {}) });
    scheduleFetch();
  }

  function onViewModeChange(mode: ViewMode) {
    destroyMap();
    destroyGraph();
    viewMode = mode;
    onsave({ viewMode: mode });
  }

  function openExploreMenu() {
    exploreOpen = !exploreOpen;
  }

  // ---- Mapbox helpers ----

  function destroyMap() {
    mapGeneration++;
    mapLoading = false;
    if (mapboxMap) {
      mapboxMap.remove();
      mapboxMap = null;
    }
    mapInitialized = false;
    mapError = null;
    geoItems = [];
  }

  async function initMap() {
    if (mapInitialized || mapLoading) return;
    const generation = mapGeneration;
    mapLoading = true;
    mapError = null;
    try {
      const entityIds = items.filter((i) => i.kind === 'entity').map((i) => i.id);
      const res = await fetch(`/api/canvas/${slug}/intel/geo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityIds }),
      });
      if (!res.ok) throw new Error(`Geo API error: ${res.status}`);
      const data = await res.json();
      if (generation !== mapGeneration) return;
      geoItems = data.items ?? [];

      if (geoItems.length === 0) {
        mapLoading = false;
        mapInitialized = true;
        return;
      }

      // Wait for container to be in the DOM
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (generation !== mapGeneration || !mapContainer) {
        mapLoading = false;
        return;
      }

      const M = await loadMapbox();
      if (generation !== mapGeneration || !mapContainer) {
        mapLoading = false;
        return;
      }

      const map = M.map(mapContainer, {
        scrollWheelZoom: false,
        zoomControl: true,
        touchZoom: true,
        doubleClickZoom: true,
        dragging: true,
      });
      mapboxMap = map;

      map.on('focus', () => map.scrollWheelZoom.enable());
      map.on('blur', () => map.scrollWheelZoom.disable());

      const allPoints: Array<[number, number]> = [];
      for (const item of geoItems) {
        const m = M.marker([item.lat, item.lng]).addTo(map);
        m.bindTooltip(item.name);
        allPoints.push([item.lat, item.lng]);
      }

      if (allPoints.length === 1) {
        map.setView(allPoints[0], 12);
      } else if (allPoints.length > 1) {
        const [head, ...rest] = allPoints;
        const bounds = M.latLngBounds([head, head]);
        for (const p of rest) bounds.extend(p);
        map.fitBounds(bounds, { padding: [20, 20] });
      }

      mapInitialized = true;
    } catch (err) {
      if (generation === mapGeneration) mapError = err instanceof Error ? err.message : String(err);
    } finally {
      if (generation === mapGeneration) mapLoading = false;
    }
  }

  // ---- D3 graph helpers ----

  function destroyGraph() {
    if (d3Simulation) {
      d3Simulation.stop();
      d3Simulation = null;
    }
    if (graphContainer) {
      graphContainer.innerHTML = '';
    }
    graphInitialized = false;
    graphError = null;
    graphNodes = [];
    graphEdges = [];
  }

  async function initGraph() {
    if (graphInitialized || graphLoading) return;
    graphLoading = true;
    graphError = null;
    try {
      const entityIds = items.filter((i) => i.kind === 'entity').map((i) => i.id);
      const res = await fetch(`/api/canvas/${slug}/intel/graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityIds }),
      });
      if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
      const data = await res.json();
      graphNodes = data.nodes ?? [];
      graphEdges = data.edges ?? [];

      if (graphNodes.length === 0) {
        graphLoading = false;
        graphInitialized = true;
        return;
      }

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (!graphContainer) {
        graphLoading = false;
        return;
      }

      renderD3Graph(graphContainer, graphNodes, graphEdges);
      graphInitialized = true;
    } catch (err) {
      graphError = err instanceof Error ? err.message : String(err);
    } finally {
      graphLoading = false;
    }
  }

  function renderD3Graph(container: HTMLDivElement, nodes: GraphNode[], edges: GraphEdge[]) {
    const width = container.clientWidth || 340;
    const height = container.clientHeight || 280;

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('display', 'block');

    const g = svg.append('g');

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom);

    // Simulation nodes need x/y
    type SimNode = GraphNode & d3.SimulationNodeDatum;
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    type SimEdge = d3.SimulationLinkDatum<SimNode> & { id: string; label: string | null; strength: string };
    const simEdges: SimEdge[] = edges.map((e) => ({
      ...e,
      source: nodeById.get(e.source) ?? e.source,
      target: nodeById.get(e.target) ?? e.target,
    }));

    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', 'var(--text-muted, #888)')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    const nodeGroup = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'grab');

    nodeGroup
      .append('circle')
      .attr('r', (d) => 4 + Math.log(d.connectionCount + 1) * 2)
      .attr('fill', (d) => d.color || '#5dbea3')
      .attr('stroke', 'var(--bg, #0d1117)')
      .attr('stroke-width', 1.5);

    nodeGroup
      .append('text')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => (4 + Math.log(d.connectionCount + 1) * 2) + 10)
      .attr('fill', 'var(--text-muted, #888)')
      // 12px == --fs-label-xs, the floor. Literal, not a token: var() is not
      // substituted inside an SVG presentation attribute.
      .attr('font-size', '12px')
      .attr('font-family', 'var(--font-mono, monospace)');

    // Drag behaviour
    nodeGroup.call(
      d3
        .drag<SVGGElement, SimNode>()
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
        }),
    );

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .on('tick', () => {
        link
          .attr('x1', (d) => (d.source as SimNode).x ?? 0)
          .attr('y1', (d) => (d.source as SimNode).y ?? 0)
          .attr('x2', (d) => (d.target as SimNode).x ?? 0)
          .attr('y2', (d) => (d.target as SimNode).y ?? 0);

        nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    d3Simulation = simulation as unknown as d3.Simulation<GraphNode & d3.SimulationNodeDatum, undefined>;
  }

  // ---- Reactive triggers for map and graph ----

  $effect(() => {
    if (viewMode === 'map' && !mapInitialized && !mapLoading) {
      initMap();
    }
  });

  $effect(() => {
    if (viewMode === 'graph' && !graphInitialized && !graphLoading) {
      initGraph();
    }
  });

  $effect(() => {
    fetchPreview();
  });

  onDestroy(() => {
    destroyMap();
    destroyGraph();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="intelligence-node"
  style:width={`${config.size?.w ?? 360}px`}
  style:height={`${config.size?.h ?? 440}px`}
  ondblclick={(e) => {
    // Only open explore menu when double-clicking the body (not header)
    const target = e.target as HTMLElement;
    if (!target.closest('.header')) {
      openExploreMenu();
    }
  }}
>
  <div class="header">
    <span class="kind-bar"></span>
    <span class="title">Intelligence</span>
  </div>

  <div class="query-wrap">
    <textarea
      class="query"
      bind:value={query}
      oninput={onQueryInput}
      placeholder="Query the intel graph…"
      rows="2"
    ></textarea>
  </div>

  <!-- Category pills -->
  <div class="category-row">
    {#each CATEGORY_OPTIONS as opt}
      <button
        type="button"
        class="cat-pill"
        class:active={selectedCategories.includes(opt.value)}
        onclick={() => toggleCategory(opt.value)}
      >{opt.label}</button>
    {/each}
  </div>

  <!-- View mode pill group + facets row -->
  <div class="controls-row">
    <div class="view-pill-group">
      <span class="view-label">VIEW</span>
      {#each VIEW_MODES as vm}
        <button
          type="button"
          class="view-pill"
          class:active={viewMode === vm.value}
          onclick={() => onViewModeChange(vm.value)}
        >{vm.label}</button>
      {/each}
    </div>
    <div class="facet-chips">
      <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
        time · {facets.timeRange ? 'filtered' : 'all'}
      </button>
      <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
        order · {facets.ordering}
      </button>
    </div>
    {#if facetsOpen}
      <FacetPopover
        facets={facets}
        onchange={onFacetsChange}
        onclose={() => (facetsOpen = false)}
      />
    {/if}
  </div>

  <div class="meta">{loading ? 'Loading…' : `${total} matches`}</div>

  {#if viewMode === 'list'}
    <ul class="results">
      {#each items as item (item.id)}
        <li class="item" data-kind={item.kind}>
          <span class="badge">{item.kind === 'note' ? 'note' : item.metadata?.entityType ?? 'entity'}</span>
          <span class="item-title">{item.title}</span>
          <span class="item-snippet">{item.snippet}</span>
        </li>
      {:else}
        <li class="empty">No matches</li>
      {/each}
    </ul>
  {:else if viewMode === 'detailed'}
    <ul class="results results-detailed">
      {#each items as item (item.id)}
        <li class="item item-detailed" data-kind={item.kind}>
          <div class="item-row">
            <span class="badge">{item.kind === 'note' ? 'note' : item.metadata?.entityType ?? 'entity'}</span>
            <span class="item-title">{item.title}</span>
            <span class="item-score">{item.score.toFixed(2)}</span>
          </div>
          <div class="item-snippet-full">{item.snippet}</div>
          <div class="item-meta-row">
            {#if item.metadata?.sourceTag}
              <span class="item-tag">{item.metadata.sourceTag}</span>
            {/if}
            <span class="item-date">{new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
        </li>
      {:else}
        <li class="empty">No matches</li>
      {/each}
    </ul>
  {:else if viewMode === 'map'}
    {#if mapLoading}
      <div class="pane-loading">Loading map data…</div>
    {:else if mapError}
      <div class="pane-error">{mapError}</div>
    {:else if mapInitialized && geoItems.length === 0}
      <div class="empty pane-center">No geocoded places in this selection. Tag an entity's properties with lat/lng to see it on the map.</div>
    {:else}
      <div class="map-pane" bind:this={mapContainer}></div>
    {/if}
  {:else if viewMode === 'graph'}
    {#if graphLoading}
      <div class="pane-loading">Loading graph data…</div>
    {:else if graphError}
      <div class="pane-error">{graphError}</div>
    {:else if graphInitialized && graphNodes.length === 0}
      <div class="empty pane-center">No connected entities in this selection.</div>
    {:else}
      <div class="graph-pane" bind:this={graphContainer}></div>
    {/if}
  {/if}

  <div class="footer">
    <button
      type="button"
      class="explore-btn"
      onclick={openExploreMenu}
    >
      Explore further ▾
    </button>
    {#if exploreOpen}
      <div class="explore-menu">
        <button
          type="button"
          onclick={() => {
            exploreOpen = false;
            onexplore('deep');
          }}
        >Deep research from here</button>
        <button
          type="button"
          onclick={() => {
            exploreOpen = false;
            onexplore('quick');
          }}
        >Quick research</button>
        <button
          type="button"
          onclick={() => {
            exploreOpen = false;
            console.info('[intelligence] custom follow-on requested — not yet implemented');
          }}
        >Custom follow-on</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .intelligence-node {
    position: relative;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    color: var(--text-primary);
    font-family: var(--font-mono);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider);
    font-size: var(--fs-label);
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .kind-bar {
    width: 3px;
    align-self: stretch;
    background: var(--accent);
  }
  .query-wrap { padding: 6px 8px; }
  .query {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--divider);
    border-radius: var(--radius-round);
    padding: 6px;
    font: inherit;
    font-size: var(--fs-body);
    resize: none;
  }
  .query:focus { outline: none; border-color: var(--text-muted); }
  /* Category pills */
  .category-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 6px;
  }
  .cat-pill {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: var(--radius-pill);
    padding: 2px 7px;
    font: inherit;
    font-size: var(--fs-label-xs);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .cat-pill:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .cat-pill.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  /* View mode pill group + facets */
  .controls-row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 8px 6px;
  }
  .view-pill-group {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .view-label {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-right: 2px;
  }
  .view-pill {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: var(--radius-pill);
    padding: 3px 10px;
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .view-pill:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .view-pill.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .facet-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .facet-chip {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
    font: inherit;
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .facet-chip:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .meta {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    padding: 0 8px 4px;
  }
  /* List view */
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1 1 auto;
    overflow: auto;
  }
  .item {
    padding: 4px 8px;
    border-top: 1px solid var(--divider);
    font-size: var(--fs-label);
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 6px;
  }
  .badge {
    grid-row: span 2;
    align-self: start;
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
  }
  .item-title { color: var(--text-primary); }
  .item-snippet {
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  /* Detailed view */
  .results-detailed .item-detailed {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    border-top: 1px solid var(--divider);
    font-size: var(--fs-label);
  }
  .item-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .item-score {
    margin-left: auto;
    color: var(--text-ghost);
    font-size: var(--fs-label-xs);
  }
  .item-snippet-full {
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
  }
  .item-meta-row {
    display: flex;
    gap: 8px;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .item-tag {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-radius: var(--radius-round);
    padding: 0 4px;
  }
  .item-date { color: var(--text-ghost); }
  /* Map and graph panes */
  .map-pane {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .graph-pane {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
  .pane-loading {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
  .pane-error {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-label);
    color: var(--error);
    padding: 8px;
    text-align: center;
  }
  .pane-center {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 12px 16px;
    line-height: 1.5;
  }
  .empty { color: var(--text-ghost); padding: 8px; font-size: var(--fs-label); }
  .footer {
    position: relative;
    padding: 6px 8px;
    border-top: 1px solid var(--divider);
  }
  .explore-btn {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-round);
    padding: 4px 10px;
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
  }
  .explore-menu {
    position: absolute;
    bottom: 38px;
    left: 8px;
    background: var(--bg);
    border: 1px solid var(--text-primary);
    border-radius: var(--radius-round);
    display: flex;
    flex-direction: column;
    min-width: 200px;
    z-index: 15;
  }
  .explore-menu button {
    background: transparent;
    color: var(--text-primary);
    border: 0;
    padding: 6px 10px;
    text-align: left;
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
  }
  .explore-menu button:hover { background: rgba(93, 190, 163, 0.08); }
</style>
