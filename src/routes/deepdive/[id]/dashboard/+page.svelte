<svelte:head>
  <title>{data.session.topic} — Deep Dive</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
</svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Readonly mode (for share pages that reuse this component)
  const readonly = data.readonly ?? false;

  type TabId = 'overview' | 'entities' | 'timeline' | 'counterfactuals' | 'reports';
  let activeTab = $state<TabId>('overview');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'entities', label: 'Entities' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'counterfactuals', label: 'Counterfactuals' },
    { id: 'reports', label: 'Reports' },
  ];

  // Precompute data
  const factMap = new Map(data.facts.map((f) => [f.id, f]));
  const sourceMap = new Map(data.sources.map((s) => [s.id, s]));
  const nonCounterfactualFacts = data.facts.filter((f) => !f.isCounterfactual);
  const counterfactualFacts = data.facts.filter((f) => f.isCounterfactual);

  // Build fact→entities mapping from mentions
  const factEntityMap = new Map<string, typeof data.entities>();
  for (const m of data.mentions) {
    const entity = data.entities.find((e) => e.id === m.entityId);
    if (!entity) continue;
    if (!factEntityMap.has(m.factId)) factEntityMap.set(m.factId, []);
    factEntityMap.get(m.factId)!.push(entity);
  }

  // Top 10 facts — use chronological order if available, else confidence
  const topFacts = (() => {
    const chronoIds = data.report.chronological_fact_ids;
    if (chronoIds?.length) {
      return chronoIds
        .map((id: string) => factMap.get(id))
        .filter((f: any): f is NonNullable<typeof f> => !!f && !f.isCounterfactual)
        .slice(0, 10);
    }
    return [...nonCounterfactualFacts]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  })();

  // Source count per fact
  function getFactSources(factId: string): typeof data.sources {
    const fact = factMap.get(factId);
    if (!fact) return [];
    return [sourceMap.get(fact.sourceId)].filter(Boolean) as typeof data.sources;
  }

  function getFactEntities(factId: string): typeof data.entities {
    return factEntityMap.get(factId) ?? [];
  }

  function hasCounterfactual(factId: string): boolean {
    return counterfactualFacts.some((f) => f.refutesFactId === factId);
  }

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

  function formatElapsed(ms: number): string {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    if (min > 60) {
      const h = Math.floor(min / 60);
      return `${h}h ${min % 60}m`;
    }
    return `${min}m ${sec}s`;
  }

  // Entity tab
  let entitySearch = $state('');
  let entityTypeFilter = $state('');
  let selectedEntityId = $state<string | null>(null);

  const filteredEntities = $derived(
    data.entities
      .filter((e) => {
        if (entitySearch && !e.name.toLowerCase().includes(entitySearch.toLowerCase())) return false;
        if (entityTypeFilter && e.type !== entityTypeFilter) return false;
        return true;
      })
      .sort((a, b) => b.centrality - a.centrality),
  );

  const entityTypes = $derived([...new Set(data.entities.map((e) => e.type))]);

  const selectedEntity = $derived(
    selectedEntityId ? data.entities.find((e) => e.id === selectedEntityId) : null,
  );

  const selectedEntityFacts = $derived(
    selectedEntityId
      ? data.mentions
          .filter((m) => m.entityId === selectedEntityId)
          .map((m) => factMap.get(m.factId))
          .filter(Boolean)
      : [],
  );

  const selectedEntitySources = $derived(() => {
    if (!selectedEntityId) return [];
    const sourceIds = new Set<string>();
    for (const m of data.mentions.filter((m) => m.entityId === selectedEntityId)) {
      const fact = factMap.get(m.factId);
      if (fact) sourceIds.add(fact.sourceId);
    }
    return [...sourceIds].map((id) => sourceMap.get(id)).filter(Boolean) as typeof data.sources;
  });

  const selectedEntityRelationships = $derived(
    selectedEntityId
      ? data.relationships.filter(
          (r) => r.fromEntityId === selectedEntityId || r.toEntityId === selectedEntityId,
        )
      : [],
  );

  // Cytoscape graph
  let graphContainer: HTMLDivElement;
  let cy: any = null;

  // Graph modal
  let graphModalOpen = $state(false);
  let modalGraphContainer: HTMLDivElement;
  let modalCy: any = null;

  function getGraphElements() {
    const nodes = data.entities.slice(0, 50).map((e) => ({
      data: {
        id: e.id,
        label: e.name,
        type: e.type,
        centrality: e.centrality,
      },
    }));

    const nodeIds = new Set(nodes.map((n) => n.data.id));
    const edges = data.relationships
      .filter((r) => r.fromEntityId && r.toEntityId && nodeIds.has(r.fromEntityId) && nodeIds.has(r.toEntityId))
      .map((r) => ({
        data: {
          id: r.id,
          source: r.fromEntityId,
          target: r.toEntityId,
          label: r.relationshipType,
          sentiment: r.sentiment,
        },
      }));

    return [...nodes, ...edges];
  }

  const typeColors: Record<string, string> = {
    person: '#c4570a',
    organisation: '#2d7d46',
    location: '#3a6b8b',
    event: '#7b3a8b',
    concept: '#8b7a3a',
    product: '#3a8b7b',
    other: '#666666',
  };

  const sentimentColors: Record<string, string> = {
    positive: '#2d7d46',
    negative: '#8b3a1a',
    neutral: '#999999',
    contested: '#c4570a',
  };

  function getGraphStyle() {
    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'font-size': 10,
          'font-family': 'JetBrains Mono, monospace',
          'text-valign': 'bottom',
          'text-margin-y': 5,
          'background-color': (ele: any) => typeColors[ele.data('type')] ?? '#666',
          width: (ele: any) => 15 + ele.data('centrality') * 30,
          height: (ele: any) => 15 + ele.data('centrality') * 30,
          color: '#3d2e1a',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.5,
          'line-color': (ele: any) => sentimentColors[ele.data('sentiment')] ?? '#999',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': (ele: any) => sentimentColors[ele.data('sentiment')] ?? '#999',
          'arrow-scale': 0.8,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#c4570a',
        },
      },
    ];
  }

  function renderGraph() {
    if (!graphContainer || typeof (window as any).cytoscape === 'undefined') return;

    if (cy) cy.destroy();

    cy = (window as any).cytoscape({
      container: graphContainer,
      elements: getGraphElements(),
      style: getGraphStyle(),
      layout: {
        name: 'cose',
        padding: 30,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 120,
        animate: false,
      },
    });

    cy.on('tap', 'node', (evt: any) => {
      selectedEntityId = evt.target.id();
    });
  }

  function renderModalGraph() {
    if (!modalGraphContainer || typeof (window as any).cytoscape === 'undefined') return;

    if (modalCy) modalCy.destroy();

    modalCy = (window as any).cytoscape({
      container: modalGraphContainer,
      elements: getGraphElements(),
      style: getGraphStyle(),
      layout: {
        name: 'cose',
        padding: 50,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 180,
        animate: false,
      },
    });

    modalCy.on('tap', 'node', (evt: any) => {
      selectedEntityId = evt.target.id();
    });
  }

  function openGraphModal() {
    graphModalOpen = true;
    setTimeout(renderModalGraph, 100);
  }

  function closeGraphModal() {
    graphModalOpen = false;
    if (modalCy) {
      modalCy.destroy();
      modalCy = null;
    }
  }

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && graphModalOpen) closeGraphModal();
  }

  $effect(() => {
    if (activeTab === 'entities' && graphContainer) {
      setTimeout(renderGraph, 100);
    }
  });

  // Timeline tab
  let timelineMinConfidence = $state(0);
  let timelineEntityFilter = $state('');

  const timelineFacts = $derived(
    data.facts
      .filter(
        (f) =>
          f.eventDate &&
          !f.isCounterfactual &&
          f.confidence >= timelineMinConfidence,
      )
      .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime()),
  );

  // Counterfactuals tab
  const counterfactualGroups = $derived(() => {
    const groups = new Map<string, { original: typeof data.facts[0]; counters: typeof data.facts }>();
    for (const cf of counterfactualFacts) {
      const origId = cf.refutesFactId ?? '';
      if (!groups.has(origId)) {
        const original = factMap.get(origId);
        if (!original) continue;
        groups.set(origId, { original, counters: [] });
      }
      groups.get(origId)!.counters.push(cf);
    }
    return Array.from(groups.values());
  });

  function resolutionBadge(counters: typeof data.facts): { label: string; color: string } {
    const hasStrong = counters.some((c) => c.confidence >= 0.6);
    if (hasStrong) return { label: 'REFUTED', color: '#8b3a1a' };
    if (counters.length > 0) return { label: 'NUANCED', color: 'var(--accent)' };
    return { label: 'UNRESOLVED', color: 'var(--text-ghost)' };
  }

  // Expanded fact rows
  let expandedFacts = $state(new Set<string>());

  function toggleExpand(factId: string) {
    const next = new Set(expandedFacts);
    if (next.has(factId)) next.delete(factId);
    else next.add(factId);
    expandedFacts = next;
  }

  // Re-run state
  let showRerunModal = $state(false);
  let rerunGoals = $state<string[]>([...(data.session.goals as string[])]);
  let rerunning = $state(false);

  async function rerunResearch() {
    rerunning = true;
    try {
      const res = await fetch(`/api/deepdive/${data.session.id}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: rerunGoals.filter((g) => g.trim()) }),
      });
      if (res.ok) {
        goto(`/deepdive/${data.session.id}/progress`);
      }
    } finally {
      rerunning = false;
    }
  }

  // Share state
  let shareUrl = $state(data.session.shareToken ? `${location?.origin ?? ''}/deepdive/share/${data.session.shareToken}` : '');
  let sharing = $state(false);
  let copied = $state(false);

  async function toggleShare() {
    sharing = true;
    try {
      if (shareUrl) {
        await fetch(`/api/deepdive/${data.session.id}/share`, { method: 'DELETE' });
        shareUrl = '';
      } else {
        const res = await fetch(`/api/deepdive/${data.session.id}/share`, { method: 'POST' });
        const result = await res.json();
        shareUrl = `${location.origin}/deepdive/share/${result.token}`;
      }
    } finally {
      sharing = false;
    }
  }

  async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<svelte:window on:keydown={handleModalKeydown} />

<div class="max-w-4xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-2">
    <a
      href="/deepdive"
      class="text-[13px] uppercase tracking-[0.3em]"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      &larr; Deep Dive
    </a>
    {#if !readonly}
      <div class="flex gap-2">
        <button
          onclick={() => (showRerunModal = true)}
          class="text-[13px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
        >
          Re-run
        </button>
        <button
          onclick={toggleShare}
          disabled={sharing}
          class="text-[13px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg"
          style="background: {shareUrl ? 'var(--accent)' : 'var(--card-bg)'}; border: 1px solid {shareUrl ? 'var(--accent)' : 'var(--card-border)'}; color: {shareUrl ? 'white' : 'var(--text-muted)'}; font-family: var(--font-mono);"
        >
          {sharing ? '...' : shareUrl ? 'Shared' : 'Share'}
        </button>
      </div>
    {/if}
  </div>

  {#if shareUrl && !readonly}
    <div
      class="mb-4 p-3 rounded-lg flex items-center gap-2"
      style="background: var(--card-bg); border: 1px solid var(--card-border);"
    >
      <input
        type="text"
        readonly
        value={shareUrl}
        class="flex-1 text-[11px] bg-transparent outline-none"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      />
      <button
        onclick={copyShareUrl}
        class="text-[13px] uppercase tracking-[0.15em] px-2 py-1 rounded"
        style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        onclick={toggleShare}
        class="text-[13px] uppercase tracking-[0.15em] px-2 py-1 rounded"
        style="color: #8b3a1a; font-family: var(--font-mono);"
      >
        Unshare
      </button>
    </div>
  {/if}

  <h1
    class="text-2xl font-bold mb-1"
    style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;"
  >
    {data.session.topic}
  </h1>

  <p class="text-xs mb-8" style="color: var(--text-muted); font-family: var(--font-mono);">
    {(data.session.goals as string[]).join(' / ')}
  </p>

  <!-- Tab bar -->
  <div class="flex gap-1 mb-6 overflow-x-auto">
    {#each tabs as tab}
      <button
        onclick={() => (activeTab = tab.id)}
        class="text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg whitespace-nowrap"
        style="font-family: var(--font-mono); background: {activeTab === tab.id ? 'var(--accent)' : 'var(--card-bg)'}; color: {activeTab === tab.id ? 'white' : 'var(--text-muted)'}; border: 1px solid {activeTab === tab.id ? 'var(--accent)' : 'var(--card-border)'};"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- ==================== OVERVIEW TAB ==================== -->
  {#if activeTab === 'overview'}
    <!-- Stats bar -->
    <div
      class="grid grid-cols-5 gap-3 mb-8 p-4 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      {#each [
        { label: 'Facts', value: data.stats.facts },
        { label: 'Entities', value: data.stats.entities },
        { label: 'Sources', value: data.stats.sources },
        { label: 'Counters', value: data.stats.counterfactuals },
        { label: 'Time', value: formatElapsed(data.session.elapsedMs) },
      ] as stat}
        <div class="text-center">
          <p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">
            {stat.value}
          </p>
          <p class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-muted); font-family: var(--font-mono);">
            {stat.label}
          </p>
        </div>
      {/each}
    </div>

    <!-- Identity disambiguation notice -->
    {#if data.report.identity_clusters?.length}
      <div
        class="mb-6 p-4 rounded-xl border"
        style="background: rgba(196, 87, 10, 0.06); border-color: var(--accent);"
      >
        <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--accent); font-family: var(--font-mono);">
          Identity Disambiguation
        </p>
        <p class="text-sm mb-3" style="color: var(--text-secondary);">
          Multiple distinct identities were detected for similar names:
        </p>
        {#each data.report.identity_clusters as cluster}
          <div class="mb-2 pl-3" style="border-left: 2px solid var(--accent);">
            <p class="text-sm font-bold" style="color: var(--text-primary);">{cluster.name}</p>
            <p class="text-xs" style="color: var(--text-muted);">{cluster.identifier} — {cluster.fact_ids.length} facts</p>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Executive summary -->
    {#if data.report.executive_summary}
      <div class="mb-8">
        <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
          Executive Summary
        </p>
        <div
          class="p-5 rounded-xl border"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          {#each data.report.executive_summary.split('\n\n') as para}
            {#if para.trim()}
              <p class="text-base leading-relaxed mb-3" style="color: var(--text-secondary);">
                {para.trim()}
              </p>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <!-- Top facts -->
    <div>
      <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
        Top Facts {#if data.report.chronological_fact_ids?.length}(chronological){/if}
      </p>
      <div class="space-y-2">
        {#each topFacts as fact}
          <div
            class="p-4 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1">
                <p class="text-[15px]" style="color: var(--text-primary);">
                  {fact.content}
                </p>
                <div class="flex items-center gap-2 mt-2">
                  <span
                    class="text-[11px] px-2 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: {confidenceColor(fact.confidence)}; background: {confidenceColor(fact.confidence)}15;"
                  >
                    {fact.confidence.toFixed(2)}
                  </span>
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: {confidenceColor(fact.confidence)}; background: {confidenceColor(fact.confidence)}10;"
                  >
                    {confidenceLabel(fact.confidence)}
                  </span>
                  {#if hasCounterfactual(fact.id)}
                    <span class="text-[11px]" style="color: #8b3a1a;" title="Has counterfactual evidence">!</span>
                  {/if}
                </div>
              </div>
              <button
                onclick={() => toggleExpand(fact.id)}
                class="text-[11px] shrink-0"
                style="color: var(--text-muted); font-family: var(--font-mono);"
              >
                {expandedFacts.has(fact.id) ? '-' : '+'}
              </button>
            </div>

            {#if expandedFacts.has(fact.id)}
              <div class="mt-3 pt-3 space-y-2" style="border-top: 1px solid var(--card-border);">
                {#each getFactSources(fact.id) as source}
                  <div>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[11px] block"
                      style="color: var(--accent); font-family: var(--font-mono);"
                    >
                      {source.title ?? source.url}
                    </a>
                    <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                      {source.domain}
                    </span>
                  </div>
                {/each}
                {#if getFactEntities(fact.id).length > 0}
                  <div class="flex flex-wrap gap-1 mt-1">
                    {#each getFactEntities(fact.id) as entity}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded"
                        style="background: {typeColors[entity.type] ?? '#666'}15; color: {typeColors[entity.type] ?? '#666'}; font-family: var(--font-mono);"
                      >
                        {entity.name}
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ==================== ENTITIES TAB ==================== -->
  {#if activeTab === 'entities'}
    <div class="flex gap-3 mb-4">
      <input
        type="text"
        bind:value={entitySearch}
        placeholder="Search entities..."
        class="flex-1 px-3 py-2 rounded-lg text-sm"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      />
      <select
        bind:value={entityTypeFilter}
        class="px-3 py-2 rounded-lg text-sm"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      >
        <option value="">All types</option>
        {#each entityTypes as type}
          <option value={type}>{type}</option>
        {/each}
      </select>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Entity list -->
      <div class="space-y-1 max-h-96 overflow-y-auto">
        {#each filteredEntities as entity}
          <button
            onclick={() => (selectedEntityId = entity.id)}
            class="w-full text-left p-3 rounded-lg transition-colors"
            style="background: {selectedEntityId === entity.id ? 'var(--accent)' : 'var(--card-bg)'}; color: {selectedEntityId === entity.id ? 'white' : 'var(--text-primary)'};"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm">{entity.name}</span>
              <span class="text-[11px]" style="font-family: var(--font-mono); opacity: 0.7;">
                {entity.type} &middot; {entity.centrality.toFixed(2)}
              </span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Entity detail panel -->
      {#if selectedEntity}
        <div
          class="p-5 rounded-xl border"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <p class="text-sm font-bold mb-1" style="color: var(--text-primary);">
            {selectedEntity.name}
          </p>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
            {selectedEntity.type} &middot; Centrality: {selectedEntity.centrality.toFixed(2)}
          </p>
          {#if selectedEntity.description}
            <p class="text-xs mb-4" style="color: var(--text-muted);">
              {selectedEntity.description}
            </p>
          {/if}

          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Facts ({selectedEntityFacts.length})
          </p>
          <div class="space-y-2 mb-4 max-h-40 overflow-y-auto">
            {#each selectedEntityFacts as fact}
              {#if fact}
                {@const source = sourceMap.get(fact.sourceId)}
                <div>
                  <p class="text-xs" style="color: var(--text-secondary);">{fact.content}</p>
                  {#if source}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[10px]"
                      style="color: var(--accent); font-family: var(--font-mono);"
                    >
                      {source.title ?? source.domain}
                    </a>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>

          <!-- Sources section -->
          {#if selectedEntitySources().length > 0}
            <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
              Sources ({selectedEntitySources().length})
            </p>
            <div class="space-y-1 mb-4 max-h-32 overflow-y-auto">
              {#each selectedEntitySources() as source}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[10px] block"
                  style="color: var(--accent); font-family: var(--font-mono);"
                >
                  {source.title ?? source.url} ({source.domain})
                </a>
              {/each}
            </div>
          {/if}

          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Relationships ({selectedEntityRelationships.length})
          </p>
          <div class="space-y-1 max-h-40 overflow-y-auto">
            {#each selectedEntityRelationships as rel}
              {@const otherEntityId = rel.fromEntityId === selectedEntityId ? rel.toEntityId : rel.fromEntityId}
              {@const otherEntity = data.entities.find((e) => e.id === otherEntityId)}
              <p class="text-xs" style="color: var(--text-secondary);">
                <span style="color: {rel.sentiment === 'positive' ? '#2d7d46' : rel.sentiment === 'negative' ? '#8b3a1a' : 'var(--text-muted)'};">
                  {rel.relationshipType}
                </span>
                &rarr; {otherEntity?.name ?? 'Unknown'}
              </p>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Graph -->
    <div class="mt-6">
      <div class="flex items-center justify-between mb-3">
        <p class="text-[13px] uppercase tracking-[0.25em]" style="color: var(--text-muted); font-family: var(--font-mono);">
          Relationship Graph
        </p>
        <button
          onclick={openGraphModal}
          class="text-[13px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
        >
          Expand
        </button>
      </div>
      <div
        bind:this={graphContainer}
        class="h-96 rounded-xl border"
        style="background: var(--bg); border-color: var(--card-border);"
      ></div>
    </div>
  {/if}

  <!-- ==================== TIMELINE TAB ==================== -->
  {#if activeTab === 'timeline'}
    <div class="flex gap-3 mb-4">
      <div>
        <label class="text-[13px] uppercase tracking-[0.2em] block mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
          Min confidence
        </label>
        <input
          type="range"
          bind:value={timelineMinConfidence}
          min="0"
          max="1"
          step="0.1"
          class="w-32"
        />
        <span class="text-xs ml-2" style="color: var(--text-muted); font-family: var(--font-mono);">
          {timelineMinConfidence.toFixed(1)}
        </span>
      </div>
    </div>

    {#if timelineFacts.length === 0}
      <div
        class="p-8 rounded-xl border text-center"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
          No facts with dates found
        </p>
      </div>
    {:else}
      <div class="relative pl-6">
        <!-- Timeline line -->
        <div
          class="absolute left-2 top-0 bottom-0 w-px"
          style="background: var(--card-border);"
        ></div>

        {#each timelineFacts as fact}
          {@const source = sourceMap.get(fact.sourceId)}
          <div class="relative mb-4">
            <!-- Dot -->
            <div
              class="absolute -left-4 top-1 w-3 h-3 rounded-full"
              style="background: {confidenceColor(fact.confidence)};"
            ></div>

            <div
              class="p-4 rounded-xl border"
              style="background: var(--card-bg); border-color: var(--card-border);"
            >
              <p class="text-[11px] mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
                {new Date(fact.eventDate!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              <p class="text-sm" style="color: var(--text-primary);">
                {fact.content}
              </p>
              <div class="flex items-center gap-2 mt-1">
                <span
                  class="text-[11px] inline-block px-2 py-0.5 rounded"
                  style="font-family: var(--font-mono); color: {confidenceColor(fact.confidence)};"
                >
                  {fact.confidence.toFixed(2)}
                </span>
                {#if source}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-[10px]"
                    style="color: var(--accent); font-family: var(--font-mono);"
                  >
                    {source.title ?? source.domain}
                  </a>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ==================== COUNTERFACTUALS TAB ==================== -->
  {#if activeTab === 'counterfactuals'}
    {#if counterfactualGroups().length === 0}
      <div
        class="p-8 rounded-xl border text-center"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
          No counterfactuals found
        </p>
      </div>
    {:else}
      <div class="space-y-4">
        {#each counterfactualGroups() as group}
          {@const badge = resolutionBadge(group.counters)}
          <div
            class="p-5 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start justify-between mb-3">
              <p class="text-sm flex-1" style="color: var(--text-primary);">
                {group.original.content}
              </p>
              <span
                class="text-[13px] uppercase tracking-[0.15em] px-2 py-0.5 rounded ml-3 shrink-0"
                style="font-family: var(--font-mono); color: {badge.color}; border: 1px solid {badge.color};"
              >
                {badge.label}
              </span>
            </div>

            <p class="text-[11px] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
              Confidence: {group.original.confidence.toFixed(2)}
            </p>

            <div class="space-y-2">
              {#each group.counters as counter}
                {@const source = sourceMap.get(counter.sourceId)}
                <div
                  class="p-3 rounded-lg"
                  style="background: var(--bg);"
                >
                  <p class="text-xs" style="color: var(--text-secondary);">
                    {counter.content}
                  </p>
                  {#if source}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[11px] mt-1 block"
                      style="color: var(--accent); font-family: var(--font-mono);"
                    >
                      {source.domain}
                    </a>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ==================== REPORTS TAB ==================== -->
  {#if activeTab === 'reports'}
    <!-- Download button -->
    <div class="mb-6">
      <a
        href="/api/deepdive/{data.session.id}/export/docx"
        class="inline-block text-[13px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg"
        style="background: var(--accent); color: white; font-family: var(--font-mono);"
      >
        Download full report (.docx)
      </a>
    </div>

    <!-- Topic clusters -->
    {#if data.report.clusters}
      <div class="space-y-4">
        {#each data.report.clusters as cluster}
          <div
            class="p-5 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <p class="text-sm font-bold mb-2" style="color: var(--text-primary);">
              {cluster.title}
            </p>
            <p class="text-xs mb-3" style="color: var(--text-muted);">
              {cluster.summary}
            </p>

            <button
              onclick={() => toggleExpand(`cluster-${cluster.title}`)}
              class="text-[13px] uppercase tracking-[0.2em]"
              style="color: var(--accent); font-family: var(--font-mono);"
            >
              {expandedFacts.has(`cluster-${cluster.title}`) ? 'Hide' : 'Show'} facts ({cluster.fact_ids?.length ?? 0})
            </button>

            {#if expandedFacts.has(`cluster-${cluster.title}`)}
              <div class="mt-3 space-y-1">
                {#each (cluster.fact_ids ?? []) as factId}
                  {@const fact = factMap.get(factId)}
                  {#if fact}
                    <div class="flex items-start gap-2">
                      <span
                        class="text-[11px] shrink-0 mt-0.5"
                        style="color: {confidenceColor(fact.confidence)}; font-family: var(--font-mono);"
                      >
                        [{fact.confidence.toFixed(2)}]
                      </span>
                      <p class="text-xs" style="color: var(--text-secondary);">
                        {fact.content}
                      </p>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Graph Modal -->
{#if graphModalOpen}
  <div
    class="fixed inset-0 z-50 flex flex-col"
    style="background: var(--bg);"
  >
    <div class="flex items-center justify-between p-4">
      <p class="text-[13px] uppercase tracking-[0.25em]" style="color: var(--text-muted); font-family: var(--font-mono);">
        Relationship Graph — {data.session.topic}
      </p>
      <button
        onclick={closeGraphModal}
        class="text-sm px-3 py-1.5 rounded-lg"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      >
        Close (Esc)
      </button>
    </div>
    <div
      bind:this={modalGraphContainer}
      class="flex-1 m-4 mt-0 rounded-xl border"
      style="background: var(--bg); border-color: var(--card-border);"
    ></div>
  </div>
{/if}

<!-- Re-run Modal -->
{#if showRerunModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center"
    style="background: rgba(0,0,0,0.4);"
  >
    <div
      class="w-full max-w-md p-6 rounded-xl"
      style="background: var(--bg); border: 2px solid var(--card-border);"
    >
      <p class="text-sm font-bold mb-4" style="color: var(--text-primary); font-family: var(--font-display); text-transform: uppercase;">
        Re-run Research
      </p>
      <p class="text-xs mb-4" style="color: var(--text-muted);">
        Existing facts and entities will be kept. New research builds on top.
      </p>

      <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
        Goals
      </p>
      <div class="space-y-2 mb-4">
        {#each rerunGoals as goal, i}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={rerunGoals[i]}
              class="flex-1 px-3 py-2 rounded-lg text-sm"
              style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
            />
            <button
              onclick={() => (rerunGoals = rerunGoals.filter((_, j) => j !== i))}
              class="text-xs px-2"
              style="color: var(--text-ghost);"
            >
              x
            </button>
          </div>
        {/each}
        <button
          onclick={() => (rerunGoals = [...rerunGoals, ''])}
          class="text-[13px] uppercase tracking-[0.15em]"
          style="color: var(--text-muted); font-family: var(--font-mono);"
        >
          + Add goal
        </button>
      </div>

      <div class="flex justify-end gap-2">
        <button
          onclick={() => (showRerunModal = false)}
          class="text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg"
          style="color: var(--text-muted); font-family: var(--font-mono);"
        >
          Cancel
        </button>
        <button
          onclick={rerunResearch}
          disabled={rerunning}
          class="text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg disabled:opacity-50"
          style="background: var(--accent); color: white; font-family: var(--font-mono);"
        >
          {rerunning ? 'Starting...' : 'Re-run'}
        </button>
      </div>
    </div>
  </div>
{/if}
