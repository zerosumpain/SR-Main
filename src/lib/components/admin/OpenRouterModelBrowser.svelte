<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';

  interface ModelRow {
    id: string;
    name: string;
    provider: string;
    modality: string | null;
    contextLength: number | null;
    promptPrice: string | null;
    completionPrice: string | null;
    throughput: string | null;
    toolsSupported: boolean;
    blendedPerM: number | null;
    agenticIndex: number | null;
    codingIndex: number | null;
    intelligenceIndex: number | null;
    score: number | null;
  }

  type SortKey =
    | 'score'
    | 'id'
    | 'name'
    | 'agenticIndex'
    | 'promptPrice'
    | 'completionPrice'
    | 'blendedPerM'
    | 'throughput'
    | 'contextLength'
    | 'toolsSupported';

  let {
    defaultModelId = null,
    chatAltOpenRouterModelId = null,
  }: {
    defaultModelId?: string | null;
    chatAltOpenRouterModelId?: string | null;
  } = $props();

  let q = $state('');
  let selectedProviders = $state<Set<string>>(new Set());
  let selectedModalities = $state<Set<string>>(new Set());
  let minContext = $state<number | null>(null);
  let maxCostPerM = $state<number | null>(null);
  let toolsOnly = $state(true);
  let sortBy = $state<SortKey>('score');
  let sortDir = $state<'asc' | 'desc'>('desc');
  // Hybrid score weights: tool-use quality / price / token speed.
  let wq = $state(0.5);
  let wp = $state(0.3);
  let wt = $state(0.2);
  let page = $state(1);
  const pageSize = 50;

  let rows = $state<ModelRow[]>([]);
  let total = $state(0);
  let facetProviders = $state<string[]>([]);
  let facetModalities = $state<string[]>([]);
  let lastRefreshed = $state<string | null>(null);
  let loading = $state(false);
  let refreshing = $state(false);
  let actionBusy = $state<string | null>(null);
  let flash = $state<{ text: string; tone: 'ok' | 'err' } | null>(null);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      for (const p of selectedProviders) params.append('provider', p);
      for (const m of selectedModalities) params.append('modality', m);
      if (minContext != null) params.set('minContext', String(minContext));
      if (maxCostPerM != null) params.set('maxCostPerM', String(maxCostPerM));
      if (toolsOnly) params.set('toolsOnly', '1');
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      params.set('wq', String(wq));
      params.set('wp', String(wp));
      params.set('wt', String(wt));
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        rows = data.rows;
        total = data.total;
        lastRefreshed = data.lastRefreshed ?? null;
        if (data.facets) {
          facetProviders = data.facets.providers;
          facetModalities = data.facets.modalities;
        }
      }
    } finally {
      loading = false;
    }
  }

  // Reload whenever any dependency changes. Explicit list so dataset reads
  // don't create phantom dependencies.
  $effect(() => {
    // referenced state
    q;
    selectedProviders;
    selectedModalities;
    minContext;
    maxCostPerM;
    toolsOnly;
    sortBy;
    sortDir;
    wq;
    wp;
    wt;
    page;
    untrack(() => load());
  });

  /** Re-pull the catalogue from OpenRouter (prices, benchmarks, new models),
   *  then reload — scores recalculate against the fresh data. */
  async function refreshCatalogue() {
    refreshing = true;
    flash = null;
    try {
      const res = await fetch('/api/admin/models/openrouter/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      flash = { text: `Catalogue refreshed — ${data.count} models`, tone: 'ok' };
      await load();
    } catch (e: any) {
      flash = { text: e.message ?? String(e), tone: 'err' };
    } finally {
      refreshing = false;
      setTimeout(() => { flash = null; }, 4000);
    }
  }

  function toggleSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function toggleProvider(p: string) {
    selectedProviders = toggleSet(selectedProviders, p);
    page = 1;
  }
  function toggleModality(m: string) {
    selectedModalities = toggleSet(selectedModalities, m);
    page = 1;
  }
  function clearProviders() {
    selectedProviders = new Set();
    page = 1;
  }
  function clearModalities() {
    selectedModalities = new Set();
    page = 1;
  }

  // Best-first default per column (mirrors the API's defaultDir).
  const DESC_FIRST: SortKey[] = ['score', 'agenticIndex', 'throughput', 'contextLength', 'toolsSupported'];

  function sortByColumn(col: SortKey) {
    if (sortBy === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = col;
      sortDir = DESC_FIRST.includes(col) ? 'desc' : 'asc';
    }
    page = 1;
  }

  function sortIndicator(col: SortKey): string {
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
    return `$${perM.toFixed(2)}`;
  }

  function blended(v: number | null): string {
    return v == null ? '—' : `$${v.toFixed(2)}`;
  }

  function tokSpeed(v: string | null): string {
    if (v == null) return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(0) : '—';
  }

  function scoreLabel(v: number | null): string {
    return v == null ? 'unrated' : (v * 100).toFixed(0);
  }

  function fmtRefreshed(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  async function postSettings(body: Record<string, unknown>, label: string, rowKey: string) {
    actionBusy = rowKey;
    flash = null;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      flash = { text: label, tone: 'ok' };
      await invalidateAll();
    } catch (e: any) {
      flash = { text: e.message ?? String(e), tone: 'err' };
    } finally {
      actionBusy = null;
      setTimeout(() => { flash = null; }, 3000);
    }
  }

  async function setAsDefault(id: string) {
    await postSettings({ chatDefaultModelId: id }, `Set ${id} as SITE DEFAULT`, `default:${id}`);
  }

  /** Toggle: clicking on the current alt clears it (the alternate is optional). */
  async function setAsChatAlt(id: string) {
    if (chatAltOpenRouterModelId === id) {
      await postSettings({ chatAltOpenRouterModelId: null }, 'Cleared chat alternate', `chat:${id}`);
    } else {
      await postSettings({ chatAltOpenRouterModelId: id }, `Set ${id} as chat alternate`, `chat:${id}`);
    }
  }

  async function clearChatAlt() {
    await postSettings({ chatAltOpenRouterModelId: null }, 'Cleared chat alternate', 'chat:clear');
  }
</script>

<section
  class="p-5"
  style="background: var(--card-bg); border: 1px solid var(--line-strong); border-radius: var(--radius-round);"
>
  <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
    <h2
      class="text-sm uppercase tracking-wider"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      OpenRouter models
    </h2>
    <div class="flex items-center gap-2">
      <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        refreshed {fmtRefreshed(lastRefreshed)}
      </span>
      <button
        class="rounded px-3 py-1.5 text-xs border"
        style="border-color: var(--line-strong); color: var(--text-secondary); background: var(--surface-overlay); {refreshing ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
        onclick={refreshCatalogue}
        disabled={refreshing}
        title="Re-pull the catalogue from OpenRouter (prices, benchmarks, new models) and recalculate scores"
      >
        {refreshing ? 'Refreshing…' : 'Refresh + recalculate'}
      </button>
    </div>
  </div>

  <!-- Current selections — set via the row actions in the table below -->
  <div class="flex flex-wrap items-center gap-2 mb-4">
    <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Current</span>
    <span
      class="px-2 py-0.5 rounded text-[11px]"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
      title="Site default — used by every chat/workflow/one-shot unless overridden"
    >
      default · {defaultModelId ?? '—'}
    </span>
    <span
      class="px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1"
      style="background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--line-strong); font-family: var(--font-mono);"
      title="Optional alternate the in-chat toggle flips to"
    >
      chat alt · {chatAltOpenRouterModelId ?? 'none'}
      {#if chatAltOpenRouterModelId}
        <button
          class="clear-x"
          onclick={clearChatAlt}
          disabled={actionBusy === 'chat:clear'}
          title="Clear the chat alternate"
          aria-label="Clear the chat alternate"
        >×</button>
      {/if}
    </span>
  </div>

  <!-- Top-row filters: search + numeric ranges + tools toggle -->
  <div class="flex flex-wrap gap-2 mb-3 items-center">
    <input
      class="rounded px-3 py-2 text-base flex-1 min-w-[200px]"
      style="background: var(--surface-elevated); border: 1px solid var(--line-strong); color: var(--text-primary);"
      placeholder="Search name or id…"
      aria-label="Search models"
      bind:value={q}
      oninput={() => { page = 1; }}
    />
    <input
      class="rounded px-3 py-2 text-base w-[150px]"
      style="background: var(--surface-elevated); border: 1px solid var(--line-strong); color: var(--text-primary);"
      type="number"
      placeholder="Min context"
      aria-label="Min context"
      bind:value={minContext}
      oninput={() => { page = 1; }}
    />
    <input
      class="rounded px-3 py-2 text-base w-[190px]"
      style="background: var(--surface-elevated); border: 1px solid var(--line-strong); color: var(--text-primary);"
      type="number"
      step="0.01"
      placeholder="Max $/1M completion"
      aria-label="Max cost per million completion tokens"
      bind:value={maxCostPerM}
      oninput={() => { page = 1; }}
    />
    <label
      class="flex items-center gap-2 px-3 py-2 text-xs rounded cursor-pointer select-none"
      style="background: var(--surface-elevated); border: 1px solid var(--line-strong); color: var(--text-secondary);"
      title="Only models supporting tool/function calling — required for jkai agent use"
    >
      <input type="checkbox" bind:checked={toolsOnly} onchange={() => { page = 1; }} />
      Tool-capable only
    </label>
  </div>

  <!-- Hybrid score weights — the "best combo" tuner -->
  {#if sortBy === 'score'}
    <div
      class="flex flex-wrap items-center gap-4 mb-3 px-3 py-2 rounded"
      style="background: var(--surface-overlay); border: 1px solid var(--line-strong);"
    >
      <span
        class="text-[10px] uppercase tracking-wider"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
        title="Hybrid score = weighted blend of tool-use quality (Artificial Analysis agentic index), price (blended $/1M, log-scaled) and token speed (median tok/s). Models without a quality rating sit in the unrated bucket at the bottom — they are never fake-ranked."
      >
        Best-combo weights
      </span>
      <label class="flex items-center gap-2 text-xs" style="color: var(--text-secondary);">
        Tool-use quality
        <input type="range" min="0" max="1" step="0.05" bind:value={wq} onchange={() => { page = 1; }} />
        <span class="w-8 text-right" style="font-family: var(--font-mono);">{wq.toFixed(2)}</span>
      </label>
      <label class="flex items-center gap-2 text-xs" style="color: var(--text-secondary);">
        Price
        <input type="range" min="0" max="1" step="0.05" bind:value={wp} onchange={() => { page = 1; }} />
        <span class="w-8 text-right" style="font-family: var(--font-mono);">{wp.toFixed(2)}</span>
      </label>
      <label class="flex items-center gap-2 text-xs" style="color: var(--text-secondary);">
        Token speed
        <input type="range" min="0" max="1" step="0.05" bind:value={wt} onchange={() => { page = 1; }} />
        <span class="w-8 text-right" style="font-family: var(--font-mono);">{wt.toFixed(2)}</span>
      </label>
    </div>
  {/if}

  <!-- Multi-select pill rows -->
  <div class="flex flex-col gap-2 mb-3">
    {#if facetProviders.length > 0}
      <div class="flex items-start gap-2 flex-wrap">
        <div class="flex items-center gap-1 shrink-0" style="min-width: 84px;">
          <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Provider</span>
          {#if selectedProviders.size > 0}
            <button
              type="button"
              class="text-[10px] underline"
              style="color: var(--text-ghost);"
              onclick={clearProviders}
              title="Clear provider filters"
            >clear</button>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#each facetProviders as p}
            {@const active = selectedProviders.has(p)}
            <button
              type="button"
              class="px-2.5 py-0.5 text-[11px] transition-colors"
              style={active
                ? 'border-radius: var(--radius-pill); background: var(--accent); color: white; border: 1px solid var(--accent);'
                : 'border-radius: var(--radius-pill); background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--line-strong);'}
              aria-pressed={active}
              onclick={() => toggleProvider(p)}
            >
              {p}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if facetModalities.length > 0}
      <div class="flex items-start gap-2 flex-wrap">
        <div class="flex items-center gap-1 shrink-0" style="min-width: 84px;">
          <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Modality</span>
          {#if selectedModalities.size > 0}
            <button
              type="button"
              class="text-[10px] underline"
              style="color: var(--text-ghost);"
              onclick={clearModalities}
              title="Clear modality filters"
            >clear</button>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#each facetModalities as m}
            {@const active = selectedModalities.has(m)}
            <button
              type="button"
              class="px-2.5 py-0.5 text-[11px] transition-colors"
              style={active
                ? 'border-radius: var(--radius-pill); background: var(--accent); color: white; border: 1px solid var(--accent);'
                : 'border-radius: var(--radius-pill); background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--line-strong);'}
              aria-pressed={active}
              onclick={() => toggleModality(m)}
            >
              {m}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="flex items-center justify-between text-xs mb-2" style="color: var(--text-ghost);">
    <span>
      {total} models · page {page} of {Math.max(1, Math.ceil(total / pageSize))}
      {#if loading}<span class="ml-2">· loading…</span>{/if}
    </span>
    {#if flash}
      <span style="color: {flash.tone === 'ok' ? 'var(--accent)' : 'var(--error)'};">{flash.text}</span>
    {/if}
  </div>

  <!-- Table -->
  <div class="overflow-x-auto rounded" style="border: 1px solid var(--line-strong);">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr
          style="background: var(--surface-sunken); color: var(--text-ghost); font-family: var(--font-mono); text-transform: uppercase; font-size: var(--fs-label-xs); letter-spacing: 0.1em;"
        >
          <th class="text-left px-2 py-2" aria-sort={ariaDir('id')}>
            <button class="sort-btn" onclick={() => sortByColumn('id')}>
              ID{sortIndicator('id')}
            </button>
          </th>
          <th class="text-left px-2 py-2" aria-sort={ariaDir('name')}>
            <button class="sort-btn" onclick={() => sortByColumn('name')}>
              Name{sortIndicator('name')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('score')}>
            <button
              class="sort-btn sort-btn--right"
              onclick={() => sortByColumn('score')}
              title="Hybrid best-combo score (tool-use quality × price × speed)"
            >
              Score{sortIndicator('score')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('agenticIndex')}>
            <button
              class="sort-btn sort-btn--right"
              onclick={() => sortByColumn('agenticIndex')}
              title="Artificial Analysis agentic index — tool-use quality"
            >
              Agentic{sortIndicator('agenticIndex')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('promptPrice')}>
            <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('promptPrice')}>
              In $/1M{sortIndicator('promptPrice')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('completionPrice')}>
            <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('completionPrice')}>
              Out $/1M{sortIndicator('completionPrice')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('blendedPerM')}>
            <button
              class="sort-btn sort-btn--right"
              onclick={() => sortByColumn('blendedPerM')}
              title="Blended $/1M at a 3:1 input:output ratio"
            >
              Blend $/1M{sortIndicator('blendedPerM')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('throughput')}>
            <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('throughput')} title="Median tokens/sec across provider endpoints">
              Tok/s{sortIndicator('throughput')}
            </button>
          </th>
          <th class="text-right px-2 py-2" aria-sort={ariaDir('contextLength')}>
            <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('contextLength')}>
              Context{sortIndicator('contextLength')}
            </button>
          </th>
          <th class="text-center px-2 py-2" aria-sort={ariaDir('toolsSupported')}>
            <button
              class="sort-btn sort-btn--center"
              onclick={() => sortByColumn('toolsSupported')}
              title="Supports tool/function calling"
            >
              Tools{sortIndicator('toolsSupported')}
            </button>
          </th>
          <th class="text-right px-2 py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as m (m.id)}
          {@const isDefault = defaultModelId === m.id}
          {@const isChatAlt = chatAltOpenRouterModelId === m.id}
          {@const isCurrent = isDefault || isChatAlt}
          <tr
            class="model-row"
            style="border-bottom: 1px solid var(--line-hair); color: var(--text-primary); {isCurrent ? 'background: color-mix(in srgb, var(--accent) 8%, transparent);' : ''}"
          >
            <td class="px-2 py-2" style="font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary);">
              <code>{m.id}</code>
              {#if isDefault}
                <span
                  class="ml-1 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider"
                  style="background: var(--accent); color: white; font-family: var(--font-mono);"
                  title="Current site default"
                >default</span>
              {/if}
              {#if isChatAlt}
                <span
                  class="ml-1 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider"
                  style="background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); font-family: var(--font-mono);"
                  title="Currently set as chat alternate"
                >chat alt</span>
              {/if}
            </td>
            <td class="px-2 py-2">{m.name}</td>
            <td class="px-2 py-2 text-right" style="font-family: var(--font-mono); color: {m.score == null ? 'var(--text-ghost)' : 'var(--text-primary)'};">
              {scoreLabel(m.score)}
            </td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">
              {m.agenticIndex != null ? m.agenticIndex.toFixed(1) : '—'}
            </td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">{perMillion(m.promptPrice)}</td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">{perMillion(m.completionPrice)}</td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">{blended(m.blendedPerM)}</td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">{tokSpeed(m.throughput)}</td>
            <td class="px-2 py-2 text-right" style="color: var(--text-secondary);">{m.contextLength ?? '—'}</td>
            <td class="px-2 py-2 text-center" style="color: {m.toolsSupported ? 'var(--success)' : 'var(--text-ghost)'};">
              {m.toolsSupported ? '✓' : '—'}
            </td>
            <td class="px-2 py-2 text-right whitespace-nowrap">
              <button
                class="rounded px-2 py-1 text-[10px] border"
                style="border-color: {isDefault ? 'var(--accent)' : 'var(--card-border)'}; color: {isDefault ? 'white' : 'var(--text-secondary)'}; background: {isDefault ? 'var(--accent)' : 'var(--surface-overlay)'}; {actionBusy === `default:${m.id}` ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                onclick={() => setAsDefault(m.id)}
                disabled={actionBusy === `default:${m.id}` || isDefault}
                title="Make this the site-wide default model"
              >
                {actionBusy === `default:${m.id}` ? '…' : 'Set default'}
              </button>
              <button
                class="rounded px-2 py-1 text-[10px] border ml-1"
                style="border-color: {isChatAlt ? 'var(--accent)' : 'var(--card-border)'}; color: {isChatAlt ? 'var(--accent)' : 'var(--text-secondary)'}; background: var(--surface-overlay); {actionBusy === `chat:${m.id}` ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                onclick={() => setAsChatAlt(m.id)}
                disabled={actionBusy === `chat:${m.id}`}
                title={isChatAlt ? 'Clear the chat alternate' : 'Use this model as the chat alternate'}
              >
                {actionBusy === `chat:${m.id}` ? '…' : isChatAlt ? 'Clear alt' : 'Chat alt'}
              </button>
            </td>
          </tr>
        {/each}
        {#if rows.length === 0 && !loading}
          <tr>
            <td colspan="11" class="text-center py-8" style="color: var(--text-ghost);">
              No models match these filters.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <div class="flex gap-2 mt-3">
    <button
      class="rounded px-3 py-1.5 text-xs border"
      style="border-color: var(--line-strong); color: var(--text-secondary); background: var(--surface-overlay); {page <= 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
      disabled={page <= 1}
      onclick={() => page--}
    >
      Prev
    </button>
    <button
      class="rounded px-3 py-1.5 text-xs border"
      style="border-color: var(--line-strong); color: var(--text-secondary); background: var(--surface-overlay); {page * pageSize >= total ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
      disabled={page * pageSize >= total}
      onclick={() => page++}
    >
      Next
    </button>
  </div>
</section>

<style>
  .model-row:hover {
    background: var(--surface-overlay) !important;
  }
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
  }
  .sort-btn--right {
    text-align: right;
  }
  .sort-btn--center {
    text-align: center;
  }
  .sort-btn:hover {
    color: var(--text-secondary);
  }
  .clear-x {
    background: none;
    border: 0;
    padding: 0 0 0 2px;
    color: var(--text-ghost);
    cursor: pointer;
    font-size: var(--fs-label);
    line-height: 1;
  }
  .clear-x:hover {
    color: var(--error);
  }
  input[type='range'] {
    accent-color: var(--accent);
    width: 110px;
  }
</style>
