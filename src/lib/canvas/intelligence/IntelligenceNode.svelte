<script lang="ts">
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
    { value: 'list', label: 'list' },
    { value: 'detailed', label: 'detailed' },
    { value: 'map', label: 'map' },
    { value: 'graph', label: 'graph' },
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
    viewMode = mode;
    onsave({ viewMode: mode });
  }

  function openExploreMenu() {
    exploreOpen = !exploreOpen;
  }

  $effect(() => {
    fetchPreview();
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

  <!-- View mode + facets row -->
  <div class="controls-row">
    <select
      class="view-select"
      value={viewMode}
      onchange={(e) => onViewModeChange((e.currentTarget as HTMLSelectElement).value as ViewMode)}
    >
      {#each VIEW_MODES as vm}
        <option value={vm.value}>{vm.label}</option>
      {/each}
    </select>
    <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
      time · {facets.timeRange ? 'filtered' : 'all'}
    </button>
    <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
      order · {facets.ordering}
    </button>
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
    <div class="placeholder-pane">
      <span class="placeholder-icon">🗺</span>
      <span>Map view — coming soon</span>
    </div>
  {:else if viewMode === 'graph'}
    <div class="placeholder-pane">
      <span class="placeholder-icon">🕸</span>
      <span>Graph view — coming soon</span>
    </div>
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
    background: var(--card-bg, #0c0e12);
    border: 1.5px solid #5dbea3;
    border-radius: 8px;
    color: var(--text-primary, #ddd);
    font-family: var(--font-mono, ui-monospace, monospace);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .kind-bar {
    width: 3px;
    align-self: stretch;
    background: #5dbea3;
  }
  .query-wrap { padding: 6px 8px; }
  .query {
    width: 100%;
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--card-border, #2a2e37);
    border-radius: 6px;
    padding: 6px;
    font: inherit;
    font-size: 11px;
    resize: none;
  }
  /* Category pills */
  .category-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 6px;
  }
  .cat-pill {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border, #2a2e37);
    border-radius: 10px;
    padding: 2px 7px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .cat-pill.active {
    background: rgba(93, 190, 163, 0.18);
    color: #5dbea3;
    border-color: #5dbea3;
  }
  /* View mode + facets */
  .controls-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 6px;
  }
  .view-select {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border, #2a2e37);
    border-radius: 6px;
    padding: 2px 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .facet-chip {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 2px 8px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .meta {
    font-size: 10px;
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
    font-size: 11px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 6px;
  }
  .badge {
    grid-row: span 2;
    align-self: start;
    color: var(--text-muted);
    font-size: 9px;
    letter-spacing: 0.08em;
  }
  .item-title { color: var(--text-primary); }
  .item-snippet {
    color: var(--text-muted);
    font-size: 10px;
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
    font-size: 11px;
  }
  .item-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .item-score {
    margin-left: auto;
    color: var(--text-ghost);
    font-size: 9px;
  }
  .item-snippet-full {
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.4;
  }
  .item-meta-row {
    display: flex;
    gap: 8px;
    font-size: 9px;
    color: var(--text-ghost);
  }
  .item-tag {
    background: rgba(93, 190, 163, 0.1);
    color: #5dbea3;
    border-radius: 4px;
    padding: 0 4px;
  }
  .item-date { color: var(--text-ghost); }
  /* Placeholder panes */
  .placeholder-pane {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--text-ghost);
    font-size: 11px;
  }
  .placeholder-icon { font-size: 22px; }
  .empty { color: var(--text-ghost); padding: 8px; font-size: 11px; }
  .footer {
    position: relative;
    padding: 6px 8px;
    border-top: 1px solid var(--divider);
  }
  .explore-btn {
    background: transparent;
    color: #5dbea3;
    border: 1px solid #5dbea3;
    border-radius: 6px;
    padding: 4px 10px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .explore-menu {
    position: absolute;
    bottom: 38px;
    left: 8px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
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
    font-size: 11px;
    cursor: pointer;
  }
  .explore-menu button:hover { background: rgba(93, 190, 163, 0.08); }
</style>
