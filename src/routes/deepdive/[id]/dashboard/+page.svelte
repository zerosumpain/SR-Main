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

  type TabId = 'overview' | 'entities' | 'timeline' | 'counterfactuals' | 'gaps' | 'hypotheses' | 'explore' | 'reports';
  let activeTab = $state<TabId>('overview');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'entities', label: 'Entities' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'counterfactuals', label: 'Counterfactuals' },
    { id: 'gaps', label: 'Gaps' },
    { id: 'hypotheses', label: 'Hypotheses' },
    { id: 'explore', label: 'Explore' },
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

  // Facts grouped by source category
  const factsByCategory = (() => {
    const groups = new Map<string, typeof data.facts>();
    for (const fact of nonCounterfactualFacts) {
      const source = sourceMap.get(fact.sourceId);
      const cat = source?.category ?? 'Uncategorised';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(fact);
    }
    // Sort categories by fact count descending, then sort facts within by confidence
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, catFacts]) => ({
        category,
        facts: catFacts.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
        total: catFacts.length,
      }));
  })();

  let overviewView = $state<'top' | 'category'>('top');

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
        padding: 40,
        nodeRepulsion: () => 15000,
        idealEdgeLength: () => 150,
        edgeElasticity: () => 100,
        gravity: 0.3,
        numIter: 1500,
        nodeDimensionsIncludeLabels: true,
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
        padding: 60,
        nodeRepulsion: () => 20000,
        idealEdgeLength: () => 200,
        edgeElasticity: () => 100,
        gravity: 0.25,
        numIter: 2000,
        nodeDimensionsIncludeLabels: true,
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

  // Narrative builder state
  let narrativeMode = $state(false);
  let narrativeItems_state = $state<{ factId: string | null; annotation: string | null; sortOrder: number }[]>([]);
  let savingNarrative = $state(false);
  let narrativeLoaded = $state(false);

  async function loadNarrative() {
    if (narrativeLoaded) return;
    try {
      const res = await fetch(`/api/deepdive/${data.session.id}/narrative`);
      if (res.ok) {
        const items = await res.json();
        narrativeItems_state = items.map((item: any) => ({
          factId: item.factId,
          annotation: item.annotation,
          sortOrder: item.sortOrder,
        }));
        narrativeLoaded = true;
      }
    } catch { /* ignore */ }
  }

  function addToNarrative(factId: string) {
    if (narrativeItems_state.some((i) => i.factId === factId)) return;
    narrativeItems_state = [
      ...narrativeItems_state,
      { factId, annotation: null, sortOrder: narrativeItems_state.length },
    ];
  }

  function removeFromNarrative(index: number) {
    narrativeItems_state = narrativeItems_state.filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i }));
  }

  function addAnnotation(index: number) {
    const newItems = [...narrativeItems_state];
    newItems.splice(index, 0, { factId: null, annotation: '', sortOrder: 0 });
    narrativeItems_state = newItems.map((item, i) => ({ ...item, sortOrder: i }));
  }

  function moveNarrativeItem(from: number, to: number) {
    const newItems = [...narrativeItems_state];
    const [removed] = newItems.splice(from, 1);
    newItems.splice(to, 0, removed);
    narrativeItems_state = newItems.map((item, i) => ({ ...item, sortOrder: i }));
  }

  let dragIndex = $state<number | null>(null);

  async function saveNarrative() {
    savingNarrative = true;
    try {
      await fetch(`/api/deepdive/${data.session.id}/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: narrativeItems_state }),
      });
    } finally {
      savingNarrative = false;
    }
  }

  $effect(() => {
    if (narrativeMode && !narrativeLoaded) {
      loadNarrative();
    }
  });

  // Share state
  let shareUrl = $state(data.session.shareToken ? `${location?.origin ?? ''}/deepdive/share/${data.session.shareToken}` : '');
  let sharing = $state(false);
  let copied = $state(false);

  // Explore state
  let exploring = $state(false);
  let exploreError = $state('');
  let globalSearchQuery = $state('');
  let globalSearchResults = $state<any>(null);
  let searchingGlobal = $state(false);
  let relatedSessions = $state<any[]>([]);
  let loadingRelated = $state(false);

  // Surprise state
  let surpriseFact = $state<any>(null);
  let loadingSurprise = $state(false);

  // Filter state
  let filterConfMin = $state(0);
  let filterConfMax = $state(1);
  let filterCategory = $state('');
  let filterCredType = $state('');

  const allTags = $derived([...new Set(nonCounterfactualFacts.flatMap((f) => (f.tags as string[]) ?? []))].sort());
  const allCategories = $derived([...new Set(data.sources.map((s) => s.category).filter(Boolean))].sort());
  const allCredTypes = $derived([...new Set(data.sources.map((s) => s.credibilityType).filter(Boolean))].sort());

  const filteredFacts = $derived(
    nonCounterfactualFacts.filter((f) => {
      if (f.confidence < filterConfMin || f.confidence > filterConfMax) return false;
      if (filterCategory) {
        const source = sourceMap.get(f.sourceId);
        if (source?.category !== filterCategory) return false;
      }
      if (filterCredType) {
        const source = sourceMap.get(f.sourceId);
        if (source?.credibilityType !== filterCredType) return false;
      }
      return true;
    }),
  );

  async function exploreItem(type: string, itemId: string) {
    exploring = true;
    exploreError = '';
    try {
      const res = await fetch(`/api/deepdive/${data.session.id}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, itemId }),
      });
      if (res.ok) {
        const child = await res.json();
        goto(`/deepdive/${child.id}/progress`);
      } else {
        const body = await res.json();
        exploreError = body.error ?? 'Failed to start exploration';
      }
    } catch (e: any) {
      exploreError = e.message ?? 'Network error';
    } finally {
      exploring = false;
    }
  }

  async function loadRelatedSessions() {
    loadingRelated = true;
    try {
      const res = await fetch(`/api/deepdive/${data.session.id}/related`);
      if (res.ok) relatedSessions = await res.json();
    } finally {
      loadingRelated = false;
    }
  }

  async function searchGlobal() {
    if (!globalSearchQuery.trim()) return;
    searchingGlobal = true;
    try {
      const res = await fetch(`/api/deepdive/search?q=${encodeURIComponent(globalSearchQuery)}`);
      if (res.ok) globalSearchResults = await res.json();
    } finally {
      searchingGlobal = false;
    }
  }

  async function loadSurprise() {
    loadingSurprise = true;
    try {
      const res = await fetch(`/api/deepdive/${data.session.id}/surprise`);
      if (res.ok) {
        const results = await res.json();
        if (results.length > 0) {
          surpriseFact = results[Math.floor(Math.random() * Math.min(results.length, 5))];
        }
      }
    } finally {
      loadingSurprise = false;
    }
  }

  function credibilityBadge(type: string | null | undefined): { label: string; color: string } {
    switch (type) {
      case 'academic': return { label: 'ACADEMIC', color: '#2d7d46' };
      case 'government': return { label: 'GOV', color: '#2d7d46' };
      case 'major_news': return { label: 'MAJOR NEWS', color: '#3a6b8b' };
      case 'news': return { label: 'NEWS', color: '#3a6b8b' };
      case 'wiki': return { label: 'WIKI', color: '#8b7a3a' };
      case 'blog': return { label: 'BLOG', color: 'var(--accent)' };
      case 'social': return { label: 'SOCIAL', color: '#8b3a1a' };
      default: return { label: 'OTHER', color: 'var(--text-muted)' };
    }
  }

  function severityColor(severity: string): string {
    if (severity === 'high') return '#8b3a1a';
    if (severity === 'medium') return 'var(--accent)';
    return 'var(--text-muted)';
  }

  $effect(() => {
    if (activeTab === 'explore' && relatedSessions.length === 0 && !loadingRelated) {
      loadRelatedSessions();
    }
  });

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
    <a href="/deepdive" class="back-link">Deep Dive</a>
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

  {#if data.parentSession}
    <div class="mb-2">
      <a
        href="/deepdive/{data.parentSession.id}/dashboard"
        class="text-[11px] uppercase tracking-[0.2em]"
        style="color: var(--accent); font-family: var(--font-mono);"
      >
        Parent: {data.parentSession.topic}
      </a>
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

    <!-- Source diversity -->
    {#if data.report.source_diversity}
      {@const sd = data.report.source_diversity}
      <div
        class="mb-6 p-4 rounded-xl border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <div class="flex items-center justify-between mb-2">
          <p class="text-[13px] uppercase tracking-[0.2em]" style="color: var(--text-muted); font-family: var(--font-mono);">
            Source Diversity — {sd.total_domains} domains
          </p>
          <span
            class="text-[11px] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); color: {sd.concentration_index < 0.3 ? '#2d7d46' : sd.concentration_index < 0.5 ? 'var(--accent)' : '#8b3a1a'};"
          >
            {sd.concentration_index < 0.3 ? 'DIVERSE' : sd.concentration_index < 0.5 ? 'MODERATE' : 'CONCENTRATED'}
          </span>
        </div>
        <div class="flex gap-1 flex-wrap">
          {#each Object.entries(sd.by_type) as [type, count]}
            {@const badge = credibilityBadge(type)}
            <span
              class="text-[10px] px-2 py-0.5 rounded"
              style="font-family: var(--font-mono); color: {badge.color}; background: {badge.color}12;"
            >
              {badge.label}: {count}
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Surprise Me -->
    <div class="mb-6 flex items-center gap-3">
      <button
        onclick={loadSurprise}
        disabled={loadingSurprise}
        class="text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg disabled:opacity-50"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
      >
        {loadingSurprise ? 'Finding...' : 'Surprise me'}
      </button>
      {#if surpriseFact}
        <div
          class="flex-1 p-3 rounded-xl border"
          style="background: rgba(196, 87, 10, 0.06); border-color: var(--accent);"
        >
          <p class="text-[10px] uppercase tracking-[0.15em] mb-1" style="color: var(--accent); font-family: var(--font-mono);">
            High novelty ({surpriseFact.noveltyScore?.toFixed(2) ?? '?'}) / Low confidence ({surpriseFact.confidence.toFixed(2)})
          </p>
          <p class="text-sm" style="color: var(--text-primary);">{surpriseFact.content}</p>
        </div>
      {/if}
    </div>

    <!-- Filter bar -->
    <div
      class="mb-6 p-3 rounded-xl border flex flex-wrap gap-3 items-center"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-center gap-1">
        <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-muted); font-family: var(--font-mono);">Conf:</span>
        <input type="range" bind:value={filterConfMin} min="0" max="1" step="0.1" class="w-16" />
        <span class="text-[10px]" style="font-family: var(--font-mono); color: var(--text-muted);">{filterConfMin.toFixed(1)}-{filterConfMax.toFixed(1)}</span>
        <input type="range" bind:value={filterConfMax} min="0" max="1" step="0.1" class="w-16" />
      </div>
      {#if allCategories.length > 0}
        <select
          bind:value={filterCategory}
          class="text-[11px] px-2 py-1 rounded"
          style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        >
          <option value="">All categories</option>
          {#each allCategories as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
      {/if}
      {#if allCredTypes.length > 0}
        <select
          bind:value={filterCredType}
          class="text-[11px] px-2 py-1 rounded"
          style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        >
          <option value="">All source types</option>
          {#each allCredTypes as ct}
            <option value={ct}>{ct}</option>
          {/each}
        </select>
      {/if}
      {#if filterConfMin > 0 || filterConfMax < 1 || filterCategory || filterCredType}
        <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
          {filteredFacts.length} / {nonCounterfactualFacts.length} facts
        </span>
      {/if}
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

    <!-- Facts section -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <p class="text-[13px] uppercase tracking-[0.25em]" style="color: var(--text-muted); font-family: var(--font-mono);">
          {overviewView === 'top' ? 'Top Facts' : 'Facts by Category'}
          {#if overviewView === 'top' && data.report.chronological_fact_ids?.length}(chronological){/if}
        </p>
        <div class="flex gap-1">
          <button
            onclick={() => (overviewView = 'top')}
            class="text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg"
            style="font-family: var(--font-mono); background: {overviewView === 'top' ? 'var(--accent)' : 'var(--card-bg)'}; color: {overviewView === 'top' ? 'white' : 'var(--text-muted)'}; border: 1px solid {overviewView === 'top' ? 'var(--accent)' : 'var(--card-border)'};"
          >
            Top
          </button>
          <button
            onclick={() => (overviewView = 'category')}
            class="text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg"
            style="font-family: var(--font-mono); background: {overviewView === 'category' ? 'var(--accent)' : 'var(--card-bg)'}; color: {overviewView === 'category' ? 'white' : 'var(--text-muted)'}; border: 1px solid {overviewView === 'category' ? 'var(--accent)' : 'var(--card-border)'};"
          >
            By Category
          </button>
        </div>
      </div>

      {#if overviewView === 'top'}
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
                  class="text-xl w-8 h-8 flex items-center justify-center shrink-0 rounded-lg hover:bg-black/5 transition-colors"
                  style="color: var(--text-secondary); font-family: var(--font-mono); line-height: 1;"
                >
                  {expandedFacts.has(fact.id) ? '\u2212' : '+'}
                </button>
              </div>

              {#if expandedFacts.has(fact.id)}
                <div class="mt-3 pt-3 space-y-2" style="border-top: 1px solid var(--card-border);">
                  {#each getFactSources(fact.id) as source}
                    <div class="flex items-center gap-2">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[11px]"
                        style="color: var(--accent); font-family: var(--font-mono);"
                      >
                        {source.title ?? source.url}
                      </a>
                      <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                        {source.domain}
                      </span>
                      {#if source.credibilityType}
                        {@const cb = credibilityBadge(source.credibilityType)}
                        <span
                          class="text-[9px] px-1.5 py-0.5 rounded"
                          style="font-family: var(--font-mono); color: {cb.color}; background: {cb.color}12;"
                        >
                          {cb.label}
                        </span>
                      {/if}
                    </div>
                  {/each}
                  {#if fact.sourceAgreement}
                    <span class="text-[10px] px-1.5 py-0.5 rounded" style="color: #2d7d46; background: #2d7d4612; font-family: var(--font-mono);">
                      Corroborated by {fact.sourceAgreement} other source{fact.sourceAgreement > 1 ? 's' : ''}
                    </span>
                  {/if}
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
                  {#if (fact.tags as string[])?.length > 0}
                    <div class="flex flex-wrap gap-1 mt-1">
                      {#each (fact.tags as string[]) as tag}
                        <span
                          class="text-[9px] px-1.5 py-0.5 rounded"
                          style="background: var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
                        >
                          {tag}
                        </span>
                      {/each}
                    </div>
                  {/if}
                  {#if !readonly}
                    <div class="flex gap-2 mt-1">
                      <button
                        onclick={() => exploreItem('fact', fact.id)}
                        disabled={exploring}
                        class="text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg disabled:opacity-50"
                        style="background: var(--accent); color: white; font-family: var(--font-mono);"
                      >
                        {exploring ? '...' : 'Explore further'}
                      </button>
                      {#if narrativeMode}
                        <button
                          onclick={() => addToNarrative(fact.id)}
                          class="text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg"
                          style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
                        >
                          + Narrative
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="space-y-4">
          {#each factsByCategory as group}
            <div
              class="p-4 rounded-xl border"
              style="background: var(--card-bg); border-color: var(--card-border);"
            >
              <div class="flex items-center justify-between mb-3">
                <p class="text-sm font-bold" style="color: var(--text-primary);">
                  {group.category}
                </p>
                <span class="text-[11px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                  {group.total} facts
                </span>
              </div>
              <div class="space-y-2">
                {#each group.facts as fact}
                  <div class="flex items-start gap-3">
                    <span
                      class="text-[11px] shrink-0 mt-1 px-1.5 py-0.5 rounded"
                      style="font-family: var(--font-mono); color: {confidenceColor(fact.confidence)}; background: {confidenceColor(fact.confidence)}10;"
                    >
                      {fact.confidence.toFixed(2)}
                    </span>
                    <p class="text-sm" style="color: var(--text-secondary);">
                      {fact.content}
                    </p>
                  </div>
                {/each}
                {#if group.total > 5}
                  <p class="text-[11px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                    + {group.total - 5} more
                  </p>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
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
            <p class="text-sm mb-4" style="color: var(--text-muted);">
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
                  <p class="text-sm" style="color: var(--text-secondary);">{fact.content}</p>
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
              <p class="text-sm" style="color: var(--text-secondary);">
                <span style="color: {rel.sentiment === 'positive' ? '#2d7d46' : rel.sentiment === 'negative' ? '#8b3a1a' : 'var(--text-muted)'};">
                  {rel.relationshipType}
                </span>
                &rarr; {otherEntity?.name ?? 'Unknown'}
              </p>
            {/each}
          </div>

          {#if !readonly && selectedEntityId}
            <button
              onclick={() => exploreItem('entity', selectedEntityId!)}
              disabled={exploring}
              class="mt-4 text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg disabled:opacity-50"
              style="background: var(--accent); color: white; font-family: var(--font-mono);"
            >
              {exploring ? '...' : 'Explore this entity'}
            </button>
          {/if}
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
              <p class="text-[15px]" style="color: var(--text-primary);">
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
              <p class="text-[15px] flex-1" style="color: var(--text-primary);">
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
                  <p class="text-sm" style="color: var(--text-secondary);">
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

  <!-- ==================== GAPS TAB ==================== -->
  {#if activeTab === 'gaps'}
    {#if !data.report.knowledge_gaps?.length}
      <div
        class="p-8 rounded-xl border text-center"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
          No knowledge gaps identified
        </p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each data.report.knowledge_gaps as gap, i}
          <div
            class="p-4 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="text-[11px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: {severityColor(gap.severity)}; border: 1px solid {severityColor(gap.severity)};"
                  >
                    {gap.severity}
                  </span>
                  <span
                    class="text-[11px] px-2 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: var(--text-muted); background: var(--bg);"
                  >
                    {gap.type.replace('_', ' ')}
                  </span>
                  {#if gap.goal_index != null}
                    <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                      Goal #{gap.goal_index + 1}
                    </span>
                  {/if}
                </div>
                <p class="text-[15px]" style="color: var(--text-primary);">
                  {gap.gap}
                </p>
              </div>
              {#if !readonly}
                <button
                  onclick={() => exploreItem('gap', String(i))}
                  disabled={exploring}
                  class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg ml-3 shrink-0 disabled:opacity-50"
                  style="background: var(--accent); color: white; font-family: var(--font-mono);"
                >
                  {exploring ? '...' : 'Investigate'}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ==================== HYPOTHESES TAB ==================== -->
  {#if activeTab === 'hypotheses'}
    {#if !data.report.hypotheses?.length}
      <div
        class="p-8 rounded-xl border text-center"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
          No hypotheses generated
        </p>
      </div>
    {:else}
      <div class="space-y-4">
        {#each data.report.hypotheses as hypo, i}
          <div
            class="p-5 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start justify-between mb-3">
              <p class="text-[15px] flex-1" style="color: var(--text-primary);">
                {hypo.hypothesis}
              </p>
              <div class="flex items-center gap-2 ml-3 shrink-0">
                <span
                  class="text-[11px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
                  style="font-family: var(--font-mono); color: {hypo.testability === 'high' ? '#2d7d46' : hypo.testability === 'medium' ? 'var(--accent)' : 'var(--text-muted)'}; border: 1px solid currentColor;"
                >
                  {hypo.testability} testability
                </span>
                {#if !readonly}
                  <button
                    onclick={() => exploreItem('hypothesis', String(i))}
                    disabled={exploring}
                    class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style="background: var(--accent); color: white; font-family: var(--font-mono);"
                  >
                    {exploring ? '...' : 'Test this'}
                  </button>
                {/if}
              </div>
            </div>

            {#if hypo.supporting_fact_ids?.length}
              <div class="mb-2">
                <p class="text-[10px] uppercase tracking-[0.15em] mb-1" style="color: #2d7d46; font-family: var(--font-mono);">Supporting ({hypo.supporting_fact_ids.length})</p>
                {#each hypo.supporting_fact_ids.slice(0, 3) as fid}
                  {@const f = factMap.get(fid)}
                  {#if f}
                    <p class="text-[13px] pl-2 mb-0.5" style="color: var(--text-secondary); border-left: 2px solid #2d7d46;">{f.content.slice(0, 120)}{f.content.length > 120 ? '...' : ''}</p>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if hypo.tension_fact_ids?.length}
              <div class="mb-2">
                <p class="text-[10px] uppercase tracking-[0.15em] mb-1" style="color: #8b3a1a; font-family: var(--font-mono);">In tension ({hypo.tension_fact_ids.length})</p>
                {#each hypo.tension_fact_ids.slice(0, 3) as fid}
                  {@const f = factMap.get(fid)}
                  {#if f}
                    <p class="text-[13px] pl-2 mb-0.5" style="color: var(--text-secondary); border-left: 2px solid #8b3a1a;">{f.content.slice(0, 120)}{f.content.length > 120 ? '...' : ''}</p>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if hypo.suggested_queries?.length}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each hypo.suggested_queries as q}
                  <span
                    class="text-[10px] px-2 py-0.5 rounded"
                    style="background: var(--bg); color: var(--text-muted); font-family: var(--font-mono);"
                  >
                    {q}
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Contradictions map -->
      {#if data.report.contradictions_map?.length}
        <div class="mt-8">
          <p class="text-[13px] uppercase tracking-[0.25em] mb-4" style="color: var(--text-muted); font-family: var(--font-mono);">
            Internal Contradictions
          </p>
          <div class="space-y-3">
            {#each data.report.contradictions_map as contradiction}
              {@const factA = factMap.get(contradiction.fact_a_id)}
              {@const factB = factMap.get(contradiction.fact_b_id)}
              <div
                class="p-4 rounded-xl border"
                style="background: var(--card-bg); border-color: var(--card-border);"
              >
                <p class="text-[11px] uppercase tracking-[0.15em] mb-2" style="color: #8b3a1a; font-family: var(--font-mono);">
                  {contradiction.tension}
                </p>
                <div class="grid grid-cols-2 gap-3">
                  <div class="p-2 rounded" style="background: var(--bg);">
                    <p class="text-sm" style="color: var(--text-secondary);">{factA?.content ?? 'Unknown fact'}</p>
                  </div>
                  <div class="p-2 rounded" style="background: var(--bg);">
                    <p class="text-sm" style="color: var(--text-secondary);">{factB?.content ?? 'Unknown fact'}</p>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  {/if}

  <!-- ==================== EXPLORE TAB ==================== -->
  {#if activeTab === 'explore'}
    {#if exploreError}
      <div class="mb-4 p-3 rounded-lg" style="background: #8b3a1a15; color: #8b3a1a; font-family: var(--font-mono); font-size: 13px;">
        {exploreError}
      </div>
    {/if}

    <!-- Research tree -->
    <div class="mb-6">
      <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
        Research Tree
      </p>
      <div
        class="p-4 rounded-xl border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        {#if data.parentSession}
          <a
            href="/deepdive/{data.parentSession.id}/dashboard"
            class="text-sm block mb-2"
            style="color: var(--accent); font-family: var(--font-mono);"
          >
            &larr; {data.parentSession.topic}
          </a>
        {/if}
        <p class="text-sm font-bold" style="color: var(--text-primary);">
          {data.session.topic}
        </p>
        {#if data.childSessions.length > 0}
          <div class="mt-3 pl-4 space-y-2" style="border-left: 2px solid var(--card-border);">
            {#each data.childSessions as child}
              <a
                href={child.status === 'complete' ? `/deepdive/${child.id}/dashboard` : `/deepdive/${child.id}/progress`}
                class="block text-sm"
                style="color: var(--text-secondary);"
              >
                {child.topic}
                <span
                  class="text-[10px] ml-1"
                  style="color: {child.status === 'complete' ? '#2d7d46' : child.status === 'failed' ? '#8b3a1a' : 'var(--accent)'}; font-family: var(--font-mono);"
                >
                  {child.status}
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="text-xs mt-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            No child investigations yet. Use "Explore further" on facts, gaps, or hypotheses.
          </p>
        {/if}
      </div>
    </div>

    <!-- Follow-up suggestions -->
    {#if data.report.suggested_followups?.length}
      <div class="mb-6">
        <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
          Suggested Follow-ups
        </p>
        <div class="space-y-3">
          {#each data.report.suggested_followups as followup, i}
            <div
              class="p-4 rounded-xl border"
              style="background: var(--card-bg); border-color: var(--card-border);"
            >
              <p class="text-[15px] mb-1" style="color: var(--text-primary);">
                {followup.question}
              </p>
              <p class="text-sm mb-2" style="color: var(--text-muted);">
                {followup.context}
              </p>
              {#if !readonly}
                <button
                  onclick={() => {
                    // Create a child session from the followup question
                    exploring = true;
                    fetch(`/api/deepdive`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        topic: followup.question,
                        goals: [followup.context],
                        parentSessionId: data.session.id,
                        seedContext: {
                          type: 'fact',
                          parentTopic: data.session.topic,
                          parentGoals: data.session.goals,
                          factContents: followup.seed_fact_ids?.map((id: string) => factMap.get(id)?.content).filter(Boolean),
                        },
                      }),
                    })
                      .then((res) => res.json())
                      .then((child) => goto(`/deepdive/${child.id}/progress`))
                      .catch((e) => (exploreError = e.message))
                      .finally(() => (exploring = false));
                  }}
                  disabled={exploring}
                  class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg disabled:opacity-50"
                  style="background: var(--accent); color: white; font-family: var(--font-mono);"
                >
                  {exploring ? '...' : 'Investigate'}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Related sessions -->
    <div class="mb-6">
      <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
        Related Sessions
      </p>
      {#if loadingRelated}
        <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">Loading...</p>
      {:else if relatedSessions.length === 0}
        <div
          class="p-4 rounded-xl border text-center"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
            No related sessions found
          </p>
        </div>
      {:else}
        <div class="space-y-2">
          {#each relatedSessions as related}
            <a
              href="/deepdive/{related.sessionId}/dashboard"
              class="block p-3 rounded-xl border transition-colors hover:bg-black/5"
              style="background: var(--card-bg); border-color: var(--card-border);"
            >
              <p class="text-sm" style="color: var(--text-primary);">{related.topic}</p>
              <div class="flex gap-1 mt-1 flex-wrap">
                {#each related.sharedEntities.slice(0, 5) as entity}
                  <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: var(--bg); color: var(--text-muted); font-family: var(--font-mono);">
                    {entity}
                  </span>
                {/each}
                <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                  ({Math.round(related.overlapScore * 100)}% overlap)
                </span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Global search -->
    <div>
      <p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
        Cross-Session Search
      </p>
      <div class="flex gap-2 mb-4">
        <input
          type="text"
          bind:value={globalSearchQuery}
          placeholder="Search across all sessions..."
          class="flex-1 px-3 py-2 rounded-lg text-sm"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          onkeydown={(e) => e.key === 'Enter' && searchGlobal()}
        />
        <button
          onclick={searchGlobal}
          disabled={searchingGlobal}
          class="text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg disabled:opacity-50"
          style="background: var(--accent); color: white; font-family: var(--font-mono);"
        >
          {searchingGlobal ? '...' : 'Search'}
        </button>
      </div>

      {#if globalSearchResults}
        {#if globalSearchResults.entities.length > 0}
          <p class="text-[11px] uppercase tracking-[0.15em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Entities ({globalSearchResults.entities.length})
          </p>
          <div class="space-y-2 mb-4">
            {#each globalSearchResults.entities as entity}
              <div
                class="p-3 rounded-lg"
                style="background: var(--card-bg); border: 1px solid var(--card-border);"
              >
                <p class="text-sm font-bold" style="color: var(--text-primary);">
                  {entity.name} <span class="text-[10px] font-normal" style="color: var(--text-muted);">({entity.type})</span>
                </p>
                <div class="flex gap-1 mt-1 flex-wrap">
                  {#each entity.sessions as s}
                    <a
                      href="/deepdive/{s.id}/dashboard"
                      class="text-[10px] px-1.5 py-0.5 rounded"
                      style="background: var(--bg); color: var(--accent); font-family: var(--font-mono);"
                    >
                      {s.topic.slice(0, 30)}
                    </a>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if globalSearchResults.facts.length > 0}
          <p class="text-[11px] uppercase tracking-[0.15em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Facts ({globalSearchResults.facts.length})
          </p>
          <div class="space-y-2">
            {#each globalSearchResults.facts as fact}
              <div
                class="p-3 rounded-lg"
                style="background: var(--card-bg); border: 1px solid var(--card-border);"
              >
                <p class="text-sm" style="color: var(--text-primary);">{fact.content}</p>
                <a
                  href="/deepdive/{fact.sessionId}/dashboard"
                  class="text-[10px] mt-1 block"
                  style="color: var(--accent); font-family: var(--font-mono);"
                >
                  from: {fact.sessionTopic}
                </a>
              </div>
            {/each}
          </div>
        {/if}

        {#if globalSearchResults.entities.length === 0 && globalSearchResults.facts.length === 0}
          <p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">No results found</p>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- ==================== REPORTS TAB ==================== -->
  {#if activeTab === 'reports'}
    <!-- Download buttons -->
    <div class="mb-6 flex flex-wrap gap-3">
      <a
        href="/api/deepdive/{data.session.id}/export/docx"
        class="inline-block text-[13px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg"
        style="background: var(--accent); color: white; font-family: var(--font-mono);"
      >
        Download full report (.docx)
      </a>
      {#if !readonly}
        <button
          onclick={() => (narrativeMode = !narrativeMode)}
          class="text-[13px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg"
          style="background: {narrativeMode ? 'var(--accent)' : 'var(--card-bg)'}; color: {narrativeMode ? 'white' : 'var(--text-muted)'}; border: 1px solid {narrativeMode ? 'var(--accent)' : 'var(--card-border)'}; font-family: var(--font-mono);"
        >
          {narrativeMode ? 'Exit narrative mode' : 'Build custom narrative'}
        </button>
      {/if}
    </div>

    <!-- Narrative builder -->
    {#if narrativeMode}
      <div
        class="mb-8 p-5 rounded-xl border"
        style="background: rgba(196, 87, 10, 0.04); border-color: var(--accent);"
      >
        <div class="flex items-center justify-between mb-4">
          <p class="text-[13px] uppercase tracking-[0.25em]" style="color: var(--accent); font-family: var(--font-mono);">
            Custom Narrative ({narrativeItems_state.length} items)
          </p>
          <div class="flex gap-2">
            <button
              onclick={saveNarrative}
              disabled={savingNarrative}
              class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg disabled:opacity-50"
              style="background: var(--accent); color: white; font-family: var(--font-mono);"
            >
              {savingNarrative ? 'Saving...' : 'Save'}
            </button>
            {#if narrativeItems_state.length > 0}
              <a
                href="/api/deepdive/{data.session.id}/export/narrative-md"
                class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg"
                style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              >
                Export MD
              </a>
              <a
                href="/api/deepdive/{data.session.id}/export/narrative-docx"
                class="text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg"
                style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              >
                Export DOCX
              </a>
            {/if}
          </div>
        </div>

        {#if narrativeItems_state.length === 0}
          <p class="text-sm" style="color: var(--text-muted);">
            Expand facts in other tabs and click "+ Narrative" to add them here.
            You can also add text annotations between facts.
          </p>
        {:else}
          <div class="space-y-1">
            {#each narrativeItems_state as item, i}
              <!-- Add annotation button -->
              <button
                onclick={() => addAnnotation(i)}
                class="w-full text-center text-[10px] py-0.5 rounded opacity-30 hover:opacity-100 transition-opacity"
                style="color: var(--text-muted); font-family: var(--font-mono);"
              >
                + add note
              </button>

              <div
                class="p-3 rounded-lg flex items-start gap-2 cursor-move"
                style="background: var(--card-bg); border: 1px solid var(--card-border);"
                draggable="true"
                ondragstart={(e) => { dragIndex = i; e.dataTransfer?.setData('text/plain', String(i)); }}
                ondragover={(e) => e.preventDefault()}
                ondrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== i) {
                    moveNarrativeItem(dragIndex, i);
                  }
                  dragIndex = null;
                }}
              >
                <span class="text-[10px] shrink-0 mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
                  {i + 1}.
                </span>
                <div class="flex-1 min-w-0">
                  {#if item.factId}
                    {@const fact = factMap.get(item.factId)}
                    {#if fact}
                      <p class="text-sm" style="color: var(--text-primary);">{fact.content}</p>
                      <span class="text-[10px]" style="color: var(--text-muted); font-family: var(--font-mono);">
                        Confidence: {fact.confidence.toFixed(2)}
                      </span>
                    {:else}
                      <p class="text-sm italic" style="color: var(--text-muted);">Fact not found</p>
                    {/if}
                  {:else}
                    <textarea
                      bind:value={narrativeItems_state[i].annotation}
                      placeholder="Write a note..."
                      rows="2"
                      class="w-full px-2 py-1 rounded text-sm resize-y"
                      style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
                    ></textarea>
                  {/if}
                </div>
                <button
                  onclick={() => removeFromNarrative(i)}
                  class="text-[10px] shrink-0 px-1 opacity-40 hover:opacity-100"
                  style="color: #8b3a1a; font-family: var(--font-mono);"
                >
                  x
                </button>
              </div>
            {/each}
            <!-- Trailing add annotation button -->
            <button
              onclick={() => addAnnotation(narrativeItems_state.length)}
              class="w-full text-center text-[10px] py-0.5 rounded opacity-30 hover:opacity-100 transition-opacity"
              style="color: var(--text-muted); font-family: var(--font-mono);"
            >
              + add note
            </button>
          </div>
        {/if}
      </div>
    {/if}

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
            <p class="text-sm mb-3" style="color: var(--text-muted);">
              {cluster.summary}
            </p>

            <div class="flex items-center gap-3">
              <button
                onclick={() => toggleExpand(`cluster-${cluster.title}`)}
                class="text-[13px] uppercase tracking-[0.2em]"
                style="color: var(--accent); font-family: var(--font-mono);"
              >
                {expandedFacts.has(`cluster-${cluster.title}`) ? 'Hide' : 'Show'} facts ({cluster.fact_ids?.length ?? 0})
              </button>
              {#if !readonly}
                <button
                  onclick={() => {
                    const idx = data.report.clusters?.indexOf(cluster);
                    if (idx != null && idx >= 0) exploreItem('cluster', String(idx));
                  }}
                  disabled={exploring}
                  class="text-[11px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-lg disabled:opacity-50"
                  style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
                >
                  Explore
                </button>
              {/if}
            </div>

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
                      <p class="text-sm" style="color: var(--text-secondary);">
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
