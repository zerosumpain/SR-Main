<script lang="ts">
  import { untrack } from 'svelte';
  import type { ModelContext } from '$lib/server/models/types';

  // Local body-portal. NOT the shared $lib/canvas/portal — that one restores the
  // node to its original parent on destroy, which *resurrects* the overlay back
  // into the chat after Svelte has already detached it (leaving it stuck open).
  // Here destroy() just removes the node, so unmount is final.
  function bodyPortal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  interface ModelRow {
    id: string;
    name: string;
    modality: string | null;
    promptPrice: string | null;
    completionPrice: string | null;
    throughput: string | null;
  }

  type SortKey = 'name' | 'modality' | 'promptPrice' | 'completionPrice' | 'throughput';

  // The parent mounts/unmounts this component (so the portaled overlay's
  // lifecycle matches the component's — see the portal note in the template).
  let {
    current,
    defaultModelId = null,
    altModel = null,
    onselect,
    onclose,
  }: {
    current: ModelContext;
    defaultModelId?: string | null;
    altModel?: ModelContext | null;
    onselect: (ctx: ModelContext) => void;
    onclose: () => void;
  } = $props();

  let q = $state('');
  let sortBy = $state<SortKey>('throughput');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let page = $state(1);
  const pageSize = 25;

  let rows = $state<ModelRow[]>([]);
  let total = $state(0);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      // The orchestrator is an agent — only models that support tool use can run
      // the chat. (Apply/edit models like morph 404 otherwise.)
      params.set('toolsOnly', '1');
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        rows = data.rows;
        total = data.total;
      }
    } finally {
      loading = false;
    }
  }

  // Mounted only while open; (re)load on any query/sort/page change.
  $effect(() => {
    q;
    sortBy;
    sortDir;
    page;
    untrack(() => load());
  });

  function sortByColumn(col: SortKey) {
    if (sortBy === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = col;
      // Default to descending for the numeric "more is better/bigger" columns.
      sortDir = col === 'name' || col === 'modality' ? 'asc' : 'desc';
    }
    page = 1;
  }

  function indicator(col: SortKey): string {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function ariaDir(col: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortBy !== col) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function perMillion(pricePerToken: string | null): string {
    if (!pricePerToken) return '—';
    const perM = Number(pricePerToken) * 1_000_000;
    if (!Number.isFinite(perM)) return '—';
    return perM === 0 ? 'free' : `$${perM.toFixed(2)}`;
  }

  function tps(v: string | null): string {
    if (!v) return '—';
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(0)} t/s` : '—';
  }

  function shortName(id: string): string {
    return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  }

  function close() {
    onclose();
  }

  function pick(ctx: ModelContext) {
    onselect(ctx);
    onclose();
  }

  // One-tap picks for the two site-configured models (admin default + alt).
  // Deduped — when the alt IS the default only one chip renders.
  const quickPicks = $derived.by(() => {
    const picks: Array<{ id: string; tag: string }> = [];
    if (defaultModelId) picks.push({ id: defaultModelId, tag: 'default' });
    if (altModel && altModel.modelId !== defaultModelId) {
      picks.push({ id: altModel.modelId, tag: 'alt' });
    }
    return picks;
  });

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  const SORT_CHIPS: Array<{ key: SortKey; label: string }> = [
    { key: 'throughput', label: 't/s' },
    { key: 'promptPrice', label: 'in $' },
    { key: 'completionPrice', label: 'out $' },
    { key: 'name', label: 'a–z' },
  ];
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') close(); }} />

<!-- Portaled to <body> so position:fixed anchors to the viewport and the overlay
     escapes any transformed / stacking-context ancestor in the chat. The PARENT
     conditionally mounts this component, so the portaled node is torn down with
     the component (a portaled node inside an internal {#if} can't be cleanly
     removed by Svelte, which leaves the overlay stuck open). -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-overlay" use:bodyPortal onclick={close}>
  <div
    class="picker-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Choose a model"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-handle" aria-hidden="true"></div>
    <header class="picker-head">
      <h2 class="picker-title">Choose a model</h2>
      <button type="button" class="picker-close" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if quickPicks.length > 0}
      <div class="quick-row" role="group" aria-label="Quick picks">
        <span class="quick-label">quick pick</span>
        {#each quickPicks as p (p.id)}
          <button
            type="button"
            class="quick-chip"
            class:active={current.provider === 'openrouter' && current.modelId === p.id}
            title={p.id}
            onclick={() => pick({ provider: 'openrouter', modelId: p.id })}
          >
            <span class="quick-chip-name">{shortName(p.id)}</span>
            <span class="quick-chip-tag">{p.tag}</span>
          </button>
        {/each}
      </div>
    {/if}

    <input
      class="picker-search"
      placeholder="Filter models by name or id…"
      aria-label="Filter models"
      bind:value={q}
      oninput={() => { page = 1; }}
    />
    <p class="picker-hint">Only models that support tool use are shown — required for the chat agent.</p>

    <!-- Mobile-only sort control (the sortable column headers are hidden there). -->
    <div class="sort-chips" role="group" aria-label="Sort models">
      <span class="quick-label">sort</span>
      {#each SORT_CHIPS as c (c.key)}
        <button
          type="button"
          class="sort-chip"
          class:active={sortBy === c.key}
          onclick={() => sortByColumn(c.key)}
        >{c.label}{indicator(c.key)}</button>
      {/each}
    </div>

    <div class="picker-table-wrap">
      <table class="picker-table">
        <colgroup>
          <col class="col-name" />
          <col class="col-mod" />
          <col class="col-num" />
          <col class="col-num" />
          <col class="col-num" />
        </colgroup>
        <thead>
          <tr>
            <th class="ta-left" aria-sort={ariaDir('name')}>
              <button class="sort-btn" onclick={() => sortByColumn('name')}>Model{indicator('name')}</button>
            </th>
            <th class="ta-left" aria-sort={ariaDir('modality')}>
              <button class="sort-btn" onclick={() => sortByColumn('modality')}>Modality{indicator('modality')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('promptPrice')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('promptPrice')}>In $/1M{indicator('promptPrice')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('completionPrice')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('completionPrice')}>Out $/1M{indicator('completionPrice')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('throughput')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('throughput')}>Tokens/s{indicator('throughput')}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each rows as m (m.id)}
            {@const active = current.provider === 'openrouter' && current.modelId === m.id}
            <tr
              class="model-row"
              class:active={active}
              tabindex="0"
              role="button"
              onclick={() => pick({ provider: 'openrouter', modelId: m.id })}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick({ provider: 'openrouter', modelId: m.id }); } }}
            >
              <td class="cell-name" title={m.id}>
                <span class="name-main">{shortName(m.id)}</span>
                <span class="name-id">{m.id}</span>
              </td>
              <td class="cell-muted cell-trunc cell-mod" title={m.modality ?? ''}>{m.modality ?? '—'}</td>
              <td class="ta-right cell-muted cell-in-price">{perMillion(m.promptPrice)}</td>
              <td class="ta-right cell-muted cell-out-price">{perMillion(m.completionPrice)}</td>
              <td class="ta-right cell-muted cell-tps">{tps(m.throughput)}</td>
            </tr>
          {/each}
          {#if rows.length === 0 && !loading}
            <tr><td colspan="5" class="empty">No models match “{q}”.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>

    <footer class="picker-foot">
      <span class="foot-info">
        {total} models · page {page}/{totalPages}{#if loading} · loading…{/if}
      </span>
      <span class="foot-pager">
        <button type="button" class="pager-btn" disabled={page <= 1} onclick={() => page--}>Prev</button>
        <button type="button" class="pager-btn" disabled={page >= totalPages} onclick={() => page++}>Next</button>
      </span>
    </footer>
  </div>
</div>

<style>
  .picker-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .picker-modal {
    position: relative;
    z-index: 9001;
    width: min(720px, 94vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    /* Opaque surface — the shared --card-bg token is a 7%-opacity tint meant
       to sit on the page, so it reads as transparent over the dark overlay. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    overflow: hidden;
    animation: picker-in 160ms ease-out;
  }
  @keyframes picker-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* Bottom-sheet drag handle — mobile only. */
  .sheet-handle { display: none; }
  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--divider);
  }
  .picker-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    font-family: var(--font-mono);
  }
  .picker-close {
    color: var(--text-ghost);
    font-size: 14px;
    line-height: 1;
    padding: 4px 6px;
    border-radius: var(--radius-round);
  }
  .picker-close:hover { color: var(--text-primary); background: var(--surface-overlay); }

  .quick-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 12px 16px 0;
  }
  .quick-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .quick-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--card-border);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    max-width: 100%;
  }
  .quick-chip:hover { color: var(--text-primary); border-color: var(--text-ghost); }
  .quick-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .quick-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .quick-chip-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .picker-search {
    margin: 12px 16px 4px;
    padding: 9px 12px;
    font-size: 13px;
    border-radius: var(--radius-round);
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
  }
  .picker-hint {
    margin: 0 16px 8px;
    font-size: 11px;
    color: var(--text-ghost);
    font-family: var(--font-mono);
  }

  /* Mobile-only sort chips (column headers do this job on desktop). */
  .sort-chips { display: none; }

  .picker-table-wrap {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 16px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
  }
  .picker-table {
    width: 100%;
    /* Fixed layout so the name column absorbs slack and long values truncate
       instead of widening the table into a horizontal scrollbar. */
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 13px;
  }
  /* col-name (first) takes the remaining width. */
  .col-mod { width: 24%; }
  .col-num { width: 84px; }
  .picker-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    /* Opaque so scrolled rows don't show through the pinned header. */
    background: var(--bg);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.08em;
    padding: 8px 10px;
    border-bottom: 1px solid var(--divider);
  }
  .ta-left { text-align: left; }
  .ta-right { text-align: right; }
  .sort-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
    width: 100%;
    text-align: left;
    white-space: nowrap;
  }
  .sort-btn--right { text-align: right; }
  .sort-btn:hover { color: var(--text-secondary); }

  .model-row {
    cursor: pointer;
    border-bottom: 1px solid var(--divider);
    color: var(--text-primary);
  }
  .model-row:hover { background: var(--surface-overlay); }
  .model-row.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .model-row td { padding: 8px 10px; vertical-align: middle; }
  /* Plain table-cell (no flex — flex would break table-layout:fixed sizing).
     Block children truncate to the fixed column width. */
  .cell-name { min-width: 0; }
  .name-main {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name-id {
    display: block;
    margin-top: 1px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-muted { color: var(--text-secondary); white-space: nowrap; }
  /* Truncate long modality strings to the column width with an ellipsis. */
  .cell-trunc { overflow: hidden; text-overflow: ellipsis; }
  .empty { text-align: center; padding: 28px 0; color: var(--text-ghost); }

  .picker-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    font-size: 12px;
    color: var(--text-ghost);
  }
  .foot-pager { display: flex; gap: 8px; }
  .pager-btn {
    border-radius: var(--radius-round);
    padding: 5px 12px;
    font-size: 12px;
    border: 1px solid var(--card-border);
    background: var(--surface-overlay);
    color: var(--text-secondary);
  }
  .pager-btn:hover:not(:disabled) { color: var(--text-primary); }
  .pager-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ============ Mobile: full-width bottom sheet, card rows ============ */
  @media (max-width: 640px) {
    .picker-overlay {
      align-items: flex-end;
      padding: 0;
    }
    .picker-modal {
      width: 100%;
      max-height: 88dvh;
      border-radius: 4px 4px 0 0;
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      animation: sheet-in 200ms ease-out;
    }
    @keyframes sheet-in {
      from { opacity: 0; transform: translateY(24px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sheet-handle {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--card-border);
      margin: 8px auto 0;
      flex-shrink: 0;
    }
    .picker-head { padding: 10px 16px; }
    /* 16px stops iOS Safari auto-zooming the input on focus. */
    .picker-search { font-size: 16px; padding: 10px 12px; }
    .picker-hint { display: none; }
    .sort-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0 16px 10px;
    }
    .sort-chip {
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--card-border);
      background: var(--surface-overlay);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 11px;
      white-space: nowrap;
    }
    .sort-chip.active {
      border-color: var(--accent);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }

    /* Collapse the table into stacked cards: header row hidden (sort-chips
       replace it), each row becomes a block with name on top and the numeric
       cells inlined as labelled mono chips underneath. */
    .picker-table thead, .picker-table colgroup { display: none; }
    .picker-table, .picker-table tbody, .picker-table tr { display: block; width: 100%; }
    .model-row { padding: 10px 12px; }
    .model-row td { display: block; padding: 0; }
    .model-row td.cell-name { margin-bottom: 4px; }
    .name-main { white-space: normal; }
    /* Modality is noise at this width. (td-qualified: .model-row td's
       display:block outranks a bare class here.) */
    .model-row td.cell-mod { display: none; }
    .model-row td.cell-in-price, .model-row td.cell-out-price, .model-row td.cell-tps {
      display: inline-block;
      width: auto;
      text-align: left;
      margin-right: 12px;
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .cell-in-price::before { content: 'in '; color: var(--text-ghost); }
    .cell-out-price::before { content: 'out '; color: var(--text-ghost); }
    .picker-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
    .pager-btn { padding: 8px 16px; }
  }
</style>
