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

  let {
    slug,
    nodeId,
    config = $bindable(),
    onsave,
    onexplore,
  } = $props<{
    slug: string;
    nodeId: string;
    config: { query?: string; facets?: Partial<Facets>; size?: { w: number; h: number } };
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

  let items = $state<IntelItem[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let facetsOpen = $state(false);
  let exploreOpen = $state(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchPreview() {
    loading = true;
    try {
      const params = new URLSearchParams();
      params.set('query', query);
      params.set('limit', String(facets.limit));
      params.set('ordering', facets.ordering);
      for (const e of facets.entityTypes) params.append('entityType', e);
      for (const t of facets.tags) params.append('tag', t);
      if (facets.timeRange) {
        params.set('from', facets.timeRange.from);
        params.set('to', facets.timeRange.to);
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

  $effect(() => {
    fetchPreview();
  });
</script>

<div class="intelligence-node" style:width={`${config.size?.w ?? 360}px`} style:height={`${config.size?.h ?? 440}px`}>
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

  <div class="facets-row">
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

  <div class="footer">
    <button
      type="button"
      class="explore-btn"
      onclick={() => (exploreOpen = !exploreOpen)}
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
  .facets-row {
    position: relative;
    display: flex;
    gap: 6px;
    padding: 0 8px 6px;
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
    min-width: 180px;
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
