<script lang="ts">
  import * as d3 from 'd3';
  import { onDestroy } from 'svelte';

  // ──── Types ────────────────────────────────────────────────────────────────
  type Fact = {
    id: string;
    content: string;
    confidence: number;
    category?: string | null;
    isCounterfactual: boolean;
    refutesFactId?: string | null;
    tags?: string[];
    eventDate?: string | null;
    sourceId?: string | null;
    supportingUrls?: string[];
  };

  type Entity = {
    id: string;
    name: string;
    type: string;
    description?: string | null;
    centrality?: number;
  };

  type Source = {
    id: string;
    url: string;
    title?: string | null;
    domain?: string | null;
    credibilityScore?: number | null;
    credibilityType?: string | null;
    category?: string | null;
  };

  type Relationship = {
    id: string;
    fromEntityId: string;
    toEntityId: string;
    relationshipType?: string | null;
    sentiment?: string | null;
  };

  type NarrativeItem = {
    id: string;
    factId?: string | null;
    annotation?: string | null;
    sortOrder: number;
  };

  type Report = {
    executive_summary?: string;
    key_findings?: string[];
    themes?: string[];
    risks?: Array<{ title?: string; description?: string } | string>;
    opportunities?: Array<{ title?: string; description?: string } | string>;
    methodology?: string;
    limitations?: string;
    [key: string]: unknown;
  };

  type TabId = 'summary' | 'facts' | 'entities' | 'sources' | 'graph' | 'timeline';

  // ──── Props ─────────────────────────────────────────────────────────────────
  let { sessionId, reportData }: {
    sessionId: string;
    reportData?: Report | null;
  } = $props();

  // ──── State ─────────────────────────────────────────────────────────────────
  let activeTab = $state<TabId>('summary');

  // Per-tab cache flags
  let relatedLoaded = $state(false);
  let narrativeLoaded = $state(false);

  // Tab data
  let facts = $state<Fact[]>([]);
  let entities = $state<Entity[]>([]);
  let sources = $state<Source[]>([]);
  let relationships = $state<Relationship[]>([]);
  let narrativeItems = $state<NarrativeItem[]>([]);

  // Per-tab error
  let relatedError = $state<string | null>(null);
  let narrativeError = $state<string | null>(null);

  // UI state
  let selectedEntityId = $state<string | null>(null);
  let factCategoryFilter = $state('');
  let showCounterfactuals = $state(false);
  let entityTimelineItems = $state<Fact[]>([]);
  let entityTimelineLoading = $state(false);
  let entityTimelineError = $state<string | null>(null);
  let entityTimelineLoaded = $state<string | null>(null); // entity id

  // Graph
  let graphContainer = $state<HTMLDivElement | null>(null);
  let graphRendered = $state(false);
  let graphSim: d3.Simulation<d3.SimulationNodeDatum & Entity, undefined> | null = null;

  // ──── Derived ───────────────────────────────────────────────────────────────
  const report = $derived(reportData ?? null);

  const nonCounterFacts = $derived(facts.filter((f) => !f.isCounterfactual));
  const counterFacts = $derived(facts.filter((f) => f.isCounterfactual));

  const categories = $derived([...new Set(nonCounterFacts.map((f) => f.category ?? 'Uncategorised'))].sort());

  const filteredFacts = $derived(
    nonCounterFacts.filter((f) =>
      !factCategoryFilter || (f.category ?? 'Uncategorised') === factCategoryFilter,
    ),
  );

  const entityTypes = $derived([...new Set(entities.map((e) => e.type))].sort());
  const selectedEntity = $derived(selectedEntityId ? entities.find((e) => e.id === selectedEntityId) : null);

  // ──── Tab data loading ───────────────────────────────────────────────────────
  $effect(() => {
    const tab = activeTab;
    const sid = sessionId;
    if (!sid) return;

    if ((tab === 'facts' || tab === 'entities' || tab === 'sources' || tab === 'graph') && !relatedLoaded) {
      loadRelated(sid);
    }
    if (tab === 'timeline' && !narrativeLoaded) {
      loadNarrative(sid);
    }
  });

  async function loadRelated(sid: string) {
    relatedError = null;
    try {
      const res = await fetch(`/api/deepdive/${sid}/data`);
      if (!res.ok) {
        relatedError = `Fetch failed (${res.status})`;
        return;
      }
      const body = await res.json();
      facts = body.facts ?? [];
      entities = body.entities ?? [];
      sources = body.sources ?? [];
      relationships = body.relationships ?? [];
    } catch (err) {
      relatedError = err instanceof Error ? err.message : 'Load failed';
    } finally {
      relatedLoaded = true;
    }
  }

  async function loadNarrative(sid: string) {
    narrativeError = null;
    try {
      const res = await fetch(`/api/deepdive/${sid}/narrative`);
      if (!res.ok) {
        narrativeError = `Fetch failed (${res.status})`;
        return;
      }
      narrativeItems = await res.json();
    } catch (err) {
      narrativeError = err instanceof Error ? err.message : 'Load failed';
    } finally {
      narrativeLoaded = true;
    }
  }

  async function loadEntityTimeline(entityId: string) {
    if (entityTimelineLoaded === entityId) return;
    entityTimelineLoading = true;
    entityTimelineError = null;
    entityTimelineItems = [];
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/entity-timeline?entityId=${entityId}`);
      if (!res.ok) {
        entityTimelineError = `Fetch failed (${res.status})`;
        return;
      }
      entityTimelineItems = await res.json();
      entityTimelineLoaded = entityId;
    } catch (err) {
      entityTimelineError = err instanceof Error ? err.message : 'Load failed';
    } finally {
      entityTimelineLoading = false;
    }
  }

  // ──── Graph rendering ────────────────────────────────────────────────────────
  $effect(() => {
    if (activeTab !== 'graph') return;
    if (!graphContainer) return;
    if (graphRendered && entities.length > 0) return;
    if (!relatedLoaded) return;
    renderGraph();
  });

  function renderGraph() {
    if (!graphContainer) return;
    graphRendered = false;
    // Clear previous
    const svg = graphContainer.querySelector('svg');
    if (svg) svg.remove();
    if (graphSim) {
      graphSim.stop();
      graphSim = null;
    }

    const nodeData = entities.slice(0, 40).map((e) => ({ ...e } as d3.SimulationNodeDatum & Entity));
    const nodeIndex = new Map(nodeData.map((n, i) => [n.id, i]));

    const linkData = relationships
      .filter((r) => nodeIndex.has(r.fromEntityId) && nodeIndex.has(r.toEntityId))
      .map((r) => ({
        source: r.fromEntityId,
        target: r.toEntityId,
        type: r.relationshipType ?? '',
        sentiment: r.sentiment ?? 'neutral',
      }));

    if (nodeData.length === 0) {
      // No graph data — show empty state
      graphRendered = true;
      return;
    }

    const w = graphContainer.clientWidth || 420;
    const h = graphContainer.clientHeight || 320;

    const svgEl = d3
      .select(graphContainer)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .style('background', 'var(--bg)');

    const g = svgEl.append('g');

    svgEl.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
          g.attr('transform', event.transform.toString());
        }) as any,
    );

    const sentimentColor: Record<string, string> = {
      positive: '#2d7d46',
      negative: '#8b3a1a',
      neutral: '#5dbea3',
      contested: '#c4570a',
    };

    const typeColor: Record<string, string> = {
      person: '#c4570a',
      organisation: '#2d7d46',
      location: '#3a6b8b',
      event: '#7b3a8b',
      concept: '#8b7a3a',
      product: '#3a8b7b',
      other: '#666',
    };

    const link = g
      .append('g')
      .selectAll('line')
      .data(linkData)
      .join('line')
      .attr('stroke', (d) => sentimentColor[d.sentiment] ?? '#5dbea3')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    const node = g
      .append('g')
      .selectAll<SVGCircleElement, typeof nodeData[0]>('circle')
      .data(nodeData)
      .join('circle')
      .attr('r', (d) => 6 + (d.centrality ?? 0) * 14)
      .attr('fill', (d) => typeColor[d.type] ?? '#666')
      .attr('stroke', '#1c1f27')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .on('click', (_evt, d) => {
        selectedEntityId = d.id;
        activeTab = 'entities';
      })
      .call(
        d3
          .drag<SVGCircleElement, typeof nodeData[0]>()
          .on('start', (event, d) => {
            if (!event.active) graphSim?.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) graphSim?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as any,
      );

    const label = g
      .append('g')
      .selectAll<SVGTextElement, typeof nodeData[0]>('text')
      .data(nodeData)
      .join('text')
      .text((d) => d.name)
      .attr('font-size', 9)
      .attr('font-family', 'var(--font-mono, monospace)')
      .attr('fill', 'var(--text-muted)')
      .attr('pointer-events', 'none')
      .attr('dy', (d) => -(8 + (d.centrality ?? 0) * 14));

    graphSim = d3
      .forceSimulation(nodeData)
      .force(
        'link',
        d3
          .forceLink(linkData)
          .id((d: any) => d.id)
          .distance(80),
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide(18))
      .on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);
        node.attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0);
        label.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0);
      });

    graphRendered = true;
  }

  $effect(() => {
    if (activeTab === 'entities' && selectedEntityId) {
      loadEntityTimeline(selectedEntityId);
    }
  });

  onDestroy(() => {
    if (graphSim) {
      graphSim.stop();
      graphSim = null;
    }
  });

  // ──── Helpers ───────────────────────────────────────────────────────────────
  function confidenceColor(c: number): string {
    if (c >= 0.8) return '#2d7d46';
    if (c >= 0.5) return 'var(--accent)';
    return '#8b3a1a';
  }

  function confidenceLabel(c: number): string {
    if (c >= 0.8) return 'HIGH';
    if (c >= 0.5) return 'MED';
    return 'LOW';
  }

  function credLabel(type: string | null | undefined): string {
    switch (type) {
      case 'academic': return 'ACADEMIC';
      case 'government': return 'GOV';
      case 'major_news': return 'MAJOR NEWS';
      case 'news': return 'NEWS';
      case 'wiki': return 'WIKI';
      case 'blog': return 'BLOG';
      case 'social': return 'SOCIAL';
      default: return 'OTHER';
    }
  }

  function credColor(type: string | null | undefined): string {
    switch (type) {
      case 'academic':
      case 'government': return '#2d7d46';
      case 'major_news':
      case 'news': return '#3a6b8b';
      case 'wiki': return '#8b7a3a';
      case 'blog': return 'var(--accent)';
      case 'social': return '#8b3a1a';
      default: return 'var(--text-muted)';
    }
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'facts', label: 'Facts' },
    { id: 'entities', label: 'Entities' },
    { id: 'sources', label: 'Sources' },
    { id: 'graph', label: 'Graph' },
    { id: 'timeline', label: 'Timeline' },
  ];

  function selectEntity(id: string) {
    selectedEntityId = id;
  }

  function clearEntity() {
    selectedEntityId = null;
    entityTimelineItems = [];
    entityTimelineLoaded = null;
  }

  function riskText(r: { title?: string; description?: string } | string): string {
    if (typeof r === 'string') return r;
    return r.title ? `${r.title}${r.description ? ': ' + r.description : ''}` : (r.description ?? '');
  }
</script>

<div class="drv">
  <!-- Tab bar -->
  <div class="drv-tabs">
    {#each TABS as tab}
      <button
        type="button"
        class="drv-tab"
        class:active={activeTab === tab.id}
        onclick={() => { activeTab = tab.id; }}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="drv-body">

    <!-- ── Summary ───────────────────────────────────────────── -->
    {#if activeTab === 'summary'}
      <div class="tab-pane">
        {#if report?.executive_summary}
          <section class="section">
            <div class="section-label">EXECUTIVE SUMMARY</div>
            <p class="exec-summary">{report.executive_summary}</p>
          </section>
        {/if}

        {#if report?.key_findings?.length}
          <section class="section">
            <div class="section-label">KEY FINDINGS</div>
            <ul class="bullet-list">
              {#each report.key_findings as f}
                <li>{f}</li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if report?.themes?.length}
          <section class="section">
            <div class="section-label">THEMES</div>
            <div class="chip-row">
              {#each report.themes as t}
                <span class="chip">{t}</span>
              {/each}
            </div>
          </section>
        {/if}

        {#if report?.risks?.length}
          <section class="section">
            <div class="section-label">RISKS</div>
            <ul class="bullet-list risk-list">
              {#each report.risks as r}
                <li>{riskText(r)}</li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if report?.opportunities?.length}
          <section class="section">
            <div class="section-label">OPPORTUNITIES</div>
            <ul class="bullet-list opp-list">
              {#each report.opportunities as o}
                <li>{riskText(o)}</li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if !report?.executive_summary && !report?.key_findings?.length}
          <div class="empty-state">No summary data available.</div>
        {/if}
      </div>

    <!-- ── Facts ─────────────────────────────────────────────── -->
    {:else if activeTab === 'facts'}
      <div class="tab-pane">
        {#if relatedError}
          <div class="error">{relatedError}</div>
        {:else if !relatedLoaded}
          <div class="loading">Loading facts…</div>
        {:else}
          {#if categories.length > 1}
            <div class="filter-row">
              <select class="filter-sel" bind:value={factCategoryFilter}>
                <option value="">All categories</option>
                {#each categories as cat}
                  <option value={cat}>{cat}</option>
                {/each}
              </select>
            </div>
          {/if}

          {#if filteredFacts.length === 0}
            <div class="empty-state">No facts found.</div>
          {:else}
            <div class="fact-list">
              {#each filteredFacts as fact}
                <div class="fact-row">
                  <div class="fact-content">{fact.content}</div>
                  <div class="fact-meta">
                    <span class="conf-badge" style:background={confidenceColor(fact.confidence)}>
                      {confidenceLabel(fact.confidence)}
                    </span>
                    {#if fact.category}
                      <span class="cat-chip">{fact.category}</span>
                    {/if}
                    {#if fact.eventDate}
                      <span class="date-chip">{new Date(fact.eventDate).toLocaleDateString()}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          {#if counterFacts.length > 0}
            <details class="counter-details">
              <summary class="counter-summary">
                {counterFacts.length} counterfactual{counterFacts.length === 1 ? '' : 's'}
              </summary>
              <div class="fact-list counter-list">
                {#each counterFacts as fact}
                  <div class="fact-row counter-row">
                    <div class="fact-content">{fact.content}</div>
                    <div class="fact-meta">
                      <span class="conf-badge" style:background={confidenceColor(fact.confidence)}>
                        {confidenceLabel(fact.confidence)}
                      </span>
                      <span class="counter-tag">COUNTER</span>
                    </div>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        {/if}
      </div>

    <!-- ── Entities ───────────────────────────────────────────── -->
    {:else if activeTab === 'entities'}
      <div class="tab-pane">
        {#if relatedError}
          <div class="error">{relatedError}</div>
        {:else if !relatedLoaded}
          <div class="loading">Loading entities…</div>
        {:else if selectedEntity}
          <div class="entity-detail">
            <button type="button" class="back-btn" onclick={clearEntity}>&larr; Back</button>
            <div class="entity-name">{selectedEntity.name}</div>
            <div class="entity-type-badge">{selectedEntity.type}</div>
            {#if selectedEntity.description}
              <p class="entity-desc">{selectedEntity.description}</p>
            {/if}
            {#if entityTimelineLoading}
              <div class="loading">Loading timeline…</div>
            {:else if entityTimelineError}
              <div class="error">{entityTimelineError}</div>
            {:else if entityTimelineItems.length > 0}
              <div class="section-label">TIMELINE</div>
              <div class="mini-timeline">
                {#each entityTimelineItems as tf}
                  <div class="mini-tl-item">
                    {#if tf.eventDate}
                      <span class="tl-date">{new Date(tf.eventDate).toLocaleDateString()}</span>
                    {/if}
                    <span class="tl-content">{tf.content}</span>
                  </div>
                {/each}
              </div>
            {:else if entityTimelineLoaded === selectedEntity.id}
              <div class="empty-state">No dated facts for this entity.</div>
            {/if}
          </div>
        {:else}
          {#if entities.length === 0}
            <div class="empty-state">No entities found.</div>
          {:else}
            <div class="entity-grid">
              {#each entities.slice(0, 60) as entity}
                <button
                  type="button"
                  class="entity-card"
                  onclick={() => selectEntity(entity.id)}
                >
                  <span class="ec-name">{entity.name}</span>
                  <span class="ec-type">{entity.type}</span>
                  {#if entity.description}
                    <span class="ec-desc">{entity.description.slice(0, 80)}{entity.description.length > 80 ? '…' : ''}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

    <!-- ── Sources ───────────────────────────────────────────── -->
    {:else if activeTab === 'sources'}
      <div class="tab-pane">
        {#if relatedError}
          <div class="error">{relatedError}</div>
        {:else if !relatedLoaded}
          <div class="loading">Loading sources…</div>
        {:else if sources.length === 0}
          <div class="empty-state">No sources found.</div>
        {:else}
          <div class="source-list">
            {#each sources as src}
              <div class="source-row">
                <div class="src-top">
                  <a href={src.url} target="_blank" rel="noreferrer" class="src-title">
                    {src.title ?? src.url}
                  </a>
                  <span class="cred-badge" style:color={credColor(src.credibilityType)}>
                    {credLabel(src.credibilityType)}
                  </span>
                </div>
                <div class="src-meta">
                  <span class="src-domain">{src.domain ?? ''}</span>
                  {#if src.credibilityScore != null}
                    <span class="src-score">{Math.round(src.credibilityScore * 100)}% cred</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    <!-- ── Graph ─────────────────────────────────────────────── -->
    {:else if activeTab === 'graph'}
      <div class="tab-pane graph-pane">
        {#if relatedError}
          <div class="error">{relatedError}</div>
        {:else if !relatedLoaded}
          <div class="loading">Loading graph…</div>
        {:else if entities.length === 0}
          <div class="empty-state">No entities to graph.</div>
        {:else}
          <div class="graph-hint">Click a node to explore entity · scroll/drag to navigate</div>
          <div
            class="graph-container"
            bind:this={graphContainer}
          ></div>
        {/if}
      </div>

    <!-- ── Timeline ──────────────────────────────────────────── -->
    {:else if activeTab === 'timeline'}
      <div class="tab-pane">
        {#if narrativeError}
          <div class="error">{narrativeError}</div>
        {:else if !narrativeLoaded}
          <div class="loading">Loading narrative…</div>
        {:else if narrativeItems.length === 0}
          <!-- Fall back to dated facts -->
          {@const datedFacts = facts.filter((f) => f.eventDate && !f.isCounterfactual).sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime())}
          {#if datedFacts.length === 0}
            <div class="empty-state">No narrative or dated facts found.</div>
          {:else}
            <div class="timeline">
              {#each datedFacts as fact}
                <div class="tl-item">
                  <div class="tl-dot"></div>
                  <div class="tl-body">
                    <div class="tl-date-label">{new Date(fact.eventDate!).toLocaleDateString()}</div>
                    <div class="tl-text">{fact.content}</div>
                    <span class="conf-badge" style:background={confidenceColor(fact.confidence)}>
                      {confidenceLabel(fact.confidence)}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="timeline">
            {#each narrativeItems as item}
              <div class="tl-item">
                <div class="tl-dot"></div>
                <div class="tl-body">
                  {#if item.annotation}
                    <div class="tl-annotation">{item.annotation}</div>
                  {/if}
                  {#if item.factId}
                    {@const fact = facts.find((f) => f.id === item.factId)}
                    {#if fact}
                      <div class="tl-text">{fact.content}</div>
                      {#if fact.eventDate}
                        <div class="tl-date-label">{new Date(fact.eventDate).toLocaleDateString()}</div>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

  </div>
</div>

<style>
  .drv {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    min-height: 0;
    min-width: 0;
  }

  /* ── Tab bar ── */
  .drv-tabs {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .drv-tabs::-webkit-scrollbar { display: none; }

  .drv-tab {
    padding: 3px 8px;
    border-radius: 10px;
    border: 1px solid var(--divider, #1c1f27);
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.05em;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .drv-tab:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .drv-tab.active {
    background: #5dbea3;
    color: #0f1117;
    border-color: #5dbea3;
  }

  /* ── Body ── */
  /* Absolute-positioned region below the tab bar. No flex dependency. */
  .drv-body {
    position: absolute;
    inset: 36px 0 0 0;
    overflow: hidden;
    display: block;
  }

  .tab-pane {
    position: absolute;
    inset: 0;
    overflow-y: scroll;
    overflow-x: hidden;
    padding: 8px 10px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
    scrollbar-color: #5dbea3 transparent;
  }
  .tab-pane::-webkit-scrollbar { width: 10px; }
  .tab-pane::-webkit-scrollbar-track { background: var(--bg); }
  .tab-pane::-webkit-scrollbar-thumb {
    background: #5dbea3;
    border-radius: 5px;
    border: 2px solid var(--bg);
  }
  .tab-pane::-webkit-scrollbar-thumb:hover { background: #7fd4be; }

  /* ── Graph pane override ── */
  .graph-pane {
    overflow: hidden;
    padding: 4px 6px 0;
    gap: 4px;
    display: flex !important;
    flex-direction: column !important;
  }
  .graph-hint {
    font-size: 9px;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .graph-container {
    flex: 1 1 0;
    min-height: 0;
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 3px;
    overflow: hidden;
  }

  /* ── Section ── */
  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-label {
    font-size: 9px;
    letter-spacing: 0.15em;
    color: #5dbea3;
    text-transform: uppercase;
  }
  .exec-summary {
    white-space: pre-wrap;
    line-height: 1.6;
    color: var(--text-primary);
    margin: 0;
  }
  .bullet-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bullet-list li {
    padding-left: 12px;
    position: relative;
    line-height: 1.5;
    color: var(--text-primary);
  }
  .bullet-list li::before { content: '·'; position: absolute; left: 0; color: #5dbea3; }
  .risk-list li::before { color: #8b3a1a; }
  .opp-list li::before { color: #2d7d46; }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid var(--divider, #1c1f27);
    font-size: 10px;
    color: var(--text-muted);
  }

  /* ── Facts ── */
  .filter-row { flex-shrink: 0; }
  .filter-sel {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .fact-list { display: flex; flex-direction: column; gap: 6px; }
  .fact-row {
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 4px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fact-content { line-height: 1.5; color: var(--text-primary); }
  .fact-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .conf-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    color: #fff;
    letter-spacing: 0.07em;
  }
  .cat-chip, .date-chip {
    font-size: 9px;
    color: var(--text-ghost);
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .counter-details { margin-top: 4px; }
  .counter-summary {
    cursor: pointer;
    font-size: 10px;
    color: var(--text-muted);
    padding: 4px 0;
  }
  .counter-list { margin-top: 6px; }
  .counter-row { border-color: #8b3a1a44; }
  .counter-tag {
    font-size: 9px;
    color: #8b3a1a;
    border: 1px solid #8b3a1a44;
    border-radius: 3px;
    padding: 1px 5px;
  }

  /* ── Entities ── */
  .entity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 6px;
  }
  .entity-card {
    background: var(--bg);
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 5px;
    padding: 7px 8px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: border-color 0.15s;
    font-family: inherit;
  }
  .entity-card:hover { border-color: #5dbea3; }
  .ec-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ec-type {
    font-size: 9px;
    color: #5dbea3;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .ec-desc { font-size: 9px; color: var(--text-ghost); line-height: 1.4; }

  .entity-detail { display: flex; flex-direction: column; gap: 8px; }
  .back-btn {
    background: none;
    border: 1px solid var(--divider, #1c1f27);
    color: var(--text-muted);
    border-radius: 4px;
    padding: 2px 8px;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
    align-self: flex-start;
  }
  .back-btn:hover { color: var(--text-primary); }
  .entity-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .entity-type-badge {
    display: inline-block;
    font-size: 9px;
    color: #5dbea3;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .entity-desc { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin: 0; }

  .mini-timeline { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .mini-tl-item {
    border-left: 2px solid #5dbea344;
    padding: 3px 0 3px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tl-date { font-size: 9px; color: #5dbea3; }
  .tl-content { font-size: 10px; color: var(--text-muted); line-height: 1.4; }

  /* ── Sources ── */
  .source-list { display: flex; flex-direction: column; gap: 6px; }
  .source-row {
    border: 1px solid var(--divider, #1c1f27);
    border-radius: 4px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .src-top { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .src-title {
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .src-title:hover { text-decoration: underline; }
  .cred-badge { font-size: 9px; font-weight: 600; letter-spacing: 0.07em; flex-shrink: 0; }
  .src-meta { display: flex; gap: 8px; align-items: center; }
  .src-domain { font-size: 9px; color: var(--text-ghost); }
  .src-score { font-size: 9px; color: var(--text-muted); }

  /* ── Timeline ── */
  .timeline { display: flex; flex-direction: column; gap: 0; position: relative; }
  .timeline::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 8px;
    bottom: 8px;
    width: 1px;
    background: var(--divider, #1c1f27);
  }
  .tl-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 4px 0;
    position: relative;
  }
  .tl-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #5dbea3;
    border: 2px solid var(--bg);
    flex-shrink: 0;
    margin-top: 3px;
    z-index: 1;
  }
  .tl-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .tl-date-label { font-size: 9px; color: #5dbea3; letter-spacing: 0.05em; }
  .tl-text { font-size: 10px; color: var(--text-primary); line-height: 1.5; }
  .tl-annotation { font-size: 10px; color: var(--text-muted); font-style: italic; }

  /* ── Shared ── */
  .empty-state { color: var(--text-ghost); font-size: 10px; padding: 12px 0; text-align: center; }
  .loading { color: var(--text-muted); font-size: 10px; padding: 12px 0; text-align: center; }
  .error { color: #c66; font-size: 10px; padding: 4px 0; }
</style>
