<script lang="ts">
  // The entities index.
  //
  // What it replaced was a 100-row card grid with one type filter: fine at 80
  // entities, useless at 2,000 — no search, no ordering, no way to reach the
  // rest, and no way to act on more than one thing at a time. Every control
  // here writes to the URL and the server does the work; filtering in the
  // browser would mean shipping the whole table to the browser, and a view you
  // cannot link to is a view you cannot return to after a bulk action.

  import PageHeader from '$lib/components/PageHeader.svelte';
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import {
    entityQueryToSearch,
    activeFilterCount,
    toggleFacet,
    SORT_LABELS,
    SORT_DEFAULT_DIR,
    ENTITY_SORTS,
    CONFIDENCE_LEVELS,
    PAGE_SIZE_OPTIONS,
    type EntityQuery,
    type EntitySort,
  } from '$lib/jkai/intel/entity-query';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let searchText = $state(data.query.q);
  /** Ordered: with two selected, the order decides which survives a merge. */
  let selected = $state<string[]>([]);
  let busy = $state(false);
  let toast = $state<string | null>(null);
  let retypeTarget = $state('');

  // Plain handles, never $state — a timer that a helper both reads and clears
  // is the read-own-write loop the svelte5-pitfalls skill exists to prevent.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Only the loader's values are read reactively; the writes are untracked so
  // reassigning them cannot re-arm the effect that produced them.
  $effect(() => {
    const incomingQuery = data.query.q;
    const incomingIds = data.entities.map((e) => e.id);
    untrack(() => {
      if (incomingQuery !== searchText) searchText = incomingQuery;
      // Selection is per page: acting on rows you can no longer see is exactly
      // how a bulk delete surprises someone.
      if (selected.length && !selected.every((id) => incomingIds.includes(id))) selected = [];
    });
  });

  const filterCount = $derived(activeFilterCount(data.query));
  const allOnPageSelected = $derived(
    data.entities.length > 0 && data.entities.every((e) => selected.includes(e.id)),
  );

  function navigate(overrides: Partial<EntityQuery>) {
    // Any filter change resets to page 1 unless the caller is the pager itself.
    const search = entityQueryToSearch(data.query, { page: 1, ...overrides });
    goto(search ? `?${search}` : '?', { keepFocus: true, noScroll: true });
  }

  function onSearchInput(value: string) {
    searchText = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => navigate({ q: value.trim() }), 260);
  }

  function applySort(sort: EntitySort) {
    // Re-picking the active sort flips it; picking a new one uses its natural
    // direction, because nobody wants the least-connected entity first.
    const dir =
      data.query.sort === sort ? (data.query.dir === 'asc' ? 'desc' : 'asc') : SORT_DEFAULT_DIR[sort];
    navigate({ sort, dir });
  }

  function sortIndicator(sort: EntitySort): string {
    if (data.query.sort !== sort) return '';
    return data.query.dir === 'asc' ? '▲' : '▼';
  }

  function toggleRow(id: string) {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  }

  function toggleAllOnPage() {
    selected = allOnPageSelected ? [] : data.entities.map((e) => e.id);
  }

  function notify(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3200);
  }

  async function bulk(body: Record<string, unknown>, describe: (affected: number) => string) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch('/api/jkai/intel/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
      const result = await res.json();
      selected = [];
      retypeTarget = '';
      // Re-runs the loader against the SAME url, so the page number survives —
      // and `pageInfo` clamps it if the action emptied the last page.
      await invalidateAll();
      notify(describe(result.affected ?? 1));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed');
    } finally {
      busy = false;
    }
  }

  const confirmAll = () => bulk({ action: 'confirm', entityIds: selected }, (n) => `Confirmed ${n}`);
  const unconfirmAll = () => bulk({ action: 'unconfirm', entityIds: selected }, (n) => `Unconfirmed ${n}`);
  const watchAll = () => bulk({ action: 'watch', entityIds: selected }, (n) => `Watching ${n}`);
  const unwatchAll = () => bulk({ action: 'unwatch', entityIds: selected }, (n) => `Unwatched ${n}`);

  function retypeAll() {
    if (!retypeTarget) return;
    bulk({ action: 'retype', entityIds: selected, typeId: retypeTarget }, (n) => `Retyped ${n}`);
  }

  function deleteAll() {
    if (!confirm(`Delete ${selected.length} entities? Their relationships go too.`)) return;
    bulk({ action: 'delete', entityIds: selected }, (n) => `Deleted ${n}`);
  }

  function mergePair(keepIndex: 0 | 1) {
    const keepId = selected[keepIndex];
    const mergeId = selected[keepIndex === 0 ? 1 : 0];
    bulk({ action: 'merge', keepId, mergeId }, () => 'Merged');
  }

  function toggleWatchRow(id: string, watched: boolean) {
    bulk({ action: watched ? 'unwatch' : 'watch', entityIds: [id] }, () =>
      watched ? 'Stopped watching' : 'Watching',
    );
  }

  const nameOf = (id: string) => data.entities.find((e) => e.id === id)?.name ?? id;
</script>

<PageHeader title="INTEL / ENTITIES" titleHref="/jkai/intel" />

<div class="wrap">
  <div class="toolbar">
    <input
      class="search"
      type="search"
      placeholder="Search names and summaries"
      aria-label="Search entities"
      value={searchText}
      oninput={(e) => onSearchInput(e.currentTarget.value)}
    />
    <label class="ctl">
      Sort
      <select value={data.query.sort} onchange={(e) => applySort(e.currentTarget.value as EntitySort)}>
        {#each ENTITY_SORTS as sort (sort)}<option value={sort}>{SORT_LABELS[sort]}</option>{/each}
      </select>
    </label>
    <button
      type="button"
      class="ghost"
      title="Reverse order"
      onclick={() => navigate({ dir: data.query.dir === 'asc' ? 'desc' : 'asc' })}
    >{data.query.dir === 'asc' ? '▲ Asc' : '▼ Desc'}</button>
    <label class="ctl">
      Per page
      <select
        value={String(data.query.pageSize)}
        onchange={(e) => navigate({ pageSize: Number(e.currentTarget.value) })}
      >
        {#each PAGE_SIZE_OPTIONS as size (size)}<option value={String(size)}>{size}</option>{/each}
      </select>
    </label>
    {#if filterCount > 0}
      <button type="button" class="ghost" onclick={() => goto('?', { noScroll: true })}>
        Clear {filterCount} filter{filterCount === 1 ? '' : 's'}
      </button>
    {/if}
  </div>

  <div class="facets">
    <div class="facet">
      <span class="flabel">Type</span>
      {#each data.types as type (type.id)}
        <button
          type="button"
          class="chip"
          class:on={data.query.typeIds.includes(type.id)}
          onclick={() => navigate({ typeIds: toggleFacet(data.query.typeIds, type.id) })}
        >{type.icon} {type.name} <b>{data.typeCounts[type.id] ?? 0}</b></button>
      {/each}
    </div>

    <div class="facet">
      <span class="flabel">Confidence</span>
      {#each CONFIDENCE_LEVELS as level (level)}
        <button
          type="button"
          class="chip"
          class:on={data.query.confidence.includes(level)}
          onclick={() => navigate({ confidence: toggleFacet(data.query.confidence, level) })}
        >{level}</button>
      {/each}

      <span class="flabel">State</span>
      <button
        type="button"
        class="chip"
        class:on={data.query.confirmed === 'confirmed'}
        onclick={() => navigate({ confirmed: data.query.confirmed === 'confirmed' ? 'all' : 'confirmed' })}
      >confirmed</button>
      <button
        type="button"
        class="chip"
        class:on={data.query.confirmed === 'unconfirmed'}
        onclick={() => navigate({ confirmed: data.query.confirmed === 'unconfirmed' ? 'all' : 'unconfirmed' })}
      >unconfirmed</button>
      <button
        type="button"
        class="chip"
        class:on={data.query.watched === 'watched'}
        onclick={() => navigate({ watched: data.query.watched === 'watched' ? 'all' : 'watched' })}
      >★ watched</button>

      {#if data.lensValues.length}
        <span class="flabel">Lens</span>
        {#each data.lensValues as lens (lens)}
          <button
            type="button"
            class="chip"
            class:on={data.query.lens === lens}
            onclick={() => navigate({ lens: data.query.lens === lens ? null : lens })}
          >{lens}</button>
        {/each}
        <button
          type="button"
          class="chip"
          class:on={data.query.lens === 'none'}
          onclick={() => navigate({ lens: data.query.lens === 'none' ? null : 'none' })}
        >no lens</button>
      {/if}
    </div>
  </div>

  {#if selected.length}
    <div class="bulkbar">
      <span class="count">{selected.length} selected</span>
      <button type="button" disabled={busy} onclick={confirmAll}>Confirm</button>
      <button type="button" disabled={busy} onclick={unconfirmAll}>Unconfirm</button>
      <button type="button" disabled={busy} onclick={watchAll}>Watch</button>
      <button type="button" disabled={busy} onclick={unwatchAll}>Unwatch</button>
      <label class="ctl">
        Retype
        <select bind:value={retypeTarget} disabled={busy}>
          <option value="">choose…</option>
          {#each data.types as type (type.id)}<option value={type.id}>{type.icon} {type.name}</option>{/each}
        </select>
      </label>
      <button type="button" disabled={busy || !retypeTarget} onclick={retypeAll}>Apply</button>
      {#if selected.length === 2}
        <button type="button" disabled={busy} onclick={() => mergePair(0)}>
          Merge into “{nameOf(selected[0])}”
        </button>
        <button type="button" disabled={busy} onclick={() => mergePair(1)}>
          Merge into “{nameOf(selected[1])}”
        </button>
      {/if}
      <button type="button" class="danger" disabled={busy} onclick={deleteAll}>Delete</button>
      <button type="button" class="ghost" onclick={() => (selected = [])}>Clear</button>
    </div>
  {/if}

  {#if !data.entities.length}
    <p class="empty">
      {filterCount
        ? 'Nothing matches these filters.'
        : 'No entities yet — add notes to start building the graph.'}
    </p>
  {:else}
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th class="pick">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onchange={toggleAllOnPage}
                aria-label="Select every entity on this page"
              />
            </th>
            <th>
              <button type="button" onclick={() => applySort('name')}>Name {sortIndicator('name')}</button>
            </th>
            <th class="num">
              <button type="button" onclick={() => applySort('connections')}>Links {sortIndicator('connections')}</button>
            </th>
            <th class="num">
              <button type="button" onclick={() => applySort('corroboration')}>Corrob. {sortIndicator('corroboration')}</button>
            </th>
            <th class="num">
              <button type="button" onclick={() => applySort('recency')}>Updated {sortIndicator('recency')}</button>
            </th>
            <th class="state">State</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entities as entity (entity.id)}
            <tr class:picked={selected.includes(entity.id)}>
              <td class="pick">
                <input
                  type="checkbox"
                  checked={selected.includes(entity.id)}
                  onchange={() => toggleRow(entity.id)}
                  aria-label="Select {entity.name}"
                />
              </td>
              <td>
                <a class="row" href="/jkai/intel/entities/{entity.id}">
                  <span class="icon">{entity.typeIcon}</span>
                  <span class="who">
                    <span class="name">{entity.name}</span>
                    {#if entity.summary}<span class="sum">{entity.summary}</span>{/if}
                  </span>
                </a>
                <span class="type">{entity.typeName}</span>
              </td>
              <td class="num">{entity.relationshipCount}</td>
              <td class="num">{entity.corroboration}</td>
              <td class="num when">{new Date(entity.updatedAt).toLocaleDateString()}</td>
              <td class="state">
                {#if entity.confirmed}
                  <span class="badge ok" title="Confirmed">✓</span>
                {:else}
                  <span class="badge warn" title="Unconfirmed">?</span>
                {/if}
                <button
                  type="button"
                  class="star"
                  class:on={entity.watched}
                  disabled={busy}
                  title={entity.watched ? 'Watched — click to stop' : 'Not watched — click to watch'}
                  aria-label={entity.watched ? `Stop watching ${entity.name}` : `Watch ${entity.name}`}
                  onclick={() => toggleWatchRow(entity.id, entity.watched)}
                >{entity.watched ? '★' : '☆'}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="pager">
      <span class="range">{data.page.from}–{data.page.to} of {data.page.total}</span>
      <div class="pagebtns">
        <button type="button" disabled={!data.page.hasPrev} onclick={() => navigate({ page: 1 })}>First</button>
        <button type="button" disabled={!data.page.hasPrev} onclick={() => navigate({ page: data.page.page - 1 })}>Prev</button>
        <span class="pageno">Page {data.page.page} / {data.page.totalPages}</span>
        <button type="button" disabled={!data.page.hasNext} onclick={() => navigate({ page: data.page.page + 1 })}>Next</button>
        <button type="button" disabled={!data.page.hasNext} onclick={() => navigate({ page: data.page.totalPages })}>Last</button>
      </div>
    </div>
  {/if}
</div>

{#if toast}
  <div class="toast">{toast}</div>
{/if}

<style>
  .wrap {
    padding: 16px 20px 32px;
    max-width: 1280px;
    margin: 0 auto;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .search {
    flex: 1;
    min-width: 220px;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  input[type='search'],
  select {
    padding: 6px 8px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
  }
  select {
    font-size: var(--fs-label);
  }

  .facets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--divider);
  }
  .facet {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .flabel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin-right: 2px;
  }
  .flabel:not(:first-child) {
    margin-left: 10px;
  }
  .chip {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    text-transform: none;
    letter-spacing: 0;
    padding: 3px 10px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip b {
    font-weight: 500;
    color: var(--text-ghost);
    margin-left: 2px;
  }
  .chip.on {
    background: var(--accent-tint-14);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .chip.on b {
    color: var(--accent);
  }

  .bulkbar {
    position: sticky;
    top: var(--site-nav-height);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 9px 11px;
    margin-bottom: 10px;
    /* Sticky over scrolling rows — has to be opaque. */
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
  }
  .bulkbar .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    margin-right: 4px;
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
  }
  button.danger {
    border-color: var(--error-border);
    color: var(--error);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tablewrap {
    overflow-x: auto;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 640px;
  }
  th {
    text-align: left;
    padding: 0;
    border-bottom: 1px solid var(--card-border);
  }
  th button {
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 0;
    color: var(--text-ghost);
    padding: 8px 10px;
  }
  th.num button {
    text-align: right;
  }
  th.state,
  th.pick {
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    font-weight: 500;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--divider);
    vertical-align: middle;
  }
  tr.picked {
    background: var(--accent-tint-08);
  }
  tr:hover td {
    background: var(--surface-overlay);
  }
  .pick {
    width: 30px;
  }
  .num {
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .when {
    color: var(--text-ghost);
    font-size: var(--fs-label-xs);
  }

  a.row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  a.row:hover .name {
    color: var(--accent);
  }
  .icon {
    font-size: 14px;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-body-sm);
    font-weight: 500;
    transition: color var(--t-fast) var(--ease-out);
  }
  .sum {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .type {
    display: inline-block;
    margin-top: 2px;
    margin-left: 22px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }

  td.state {
    white-space: nowrap;
  }
  .badge {
    display: inline-block;
    width: 17px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    border-radius: var(--radius-sharp);
  }
  .badge.ok {
    color: var(--success);
  }
  .badge.warn {
    color: var(--warn);
  }
  .star {
    border-color: transparent;
    padding: 2px 5px;
    color: var(--text-ghost);
    font-size: 13px;
  }
  .star.on {
    color: var(--accent);
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .range,
  .pageno {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .pagebtns {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .empty {
    padding: 48px 0;
    text-align: center;
    font-size: var(--fs-body-sm);
    color: var(--text-ghost);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 140;
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
