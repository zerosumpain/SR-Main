<script lang="ts">
  // Free-text feature search. Fuzzy-matches bridges, the lock, moorings and
  // POIs; a pick flies the map to the feature and opens its detail drawer.
  import { app } from '../lib/appState.svelte';
  import { buildSearchIndex, searchIndex, type SearchEntry } from '../lib/search';

  let { onPick }: { onPick: (e: SearchEntry) => void } = $props();

  let query = $state('');
  let open = $state(false);
  let active = $state(0); // highlighted result index
  let inputEl: HTMLInputElement | null = $state(null);

  // Built once per dataset; rebuilt only if the data reference changes.
  const index = $derived(app.data ? buildSearchIndex(app.data) : []);
  const results = $derived(query.trim() ? searchIndex(index, query, 12) : []);
  const show = $derived(open && results.length > 0);

  const ICON: Record<SearchEntry['kind'], string> = { bridge: '▲', lock: '⚿', mooring: '⚓', poi: '◍' };

  function pick(e: SearchEntry) {
    onPick(e);
    query = e.name;
    open = false;
    inputEl?.blur();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { open = false; inputEl?.blur(); return; }
    if (!show) { if (ev.key === 'ArrowDown') open = true; return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % results.length; }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + results.length) % results.length; }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (results[active]) pick(results[active]); }
  }

  // reset the highlight whenever the result set changes
  $effect(() => { results.length; active = 0; });
</script>

<div class="bp-search" class:open={show}>
  <span class="bp-search-ic" aria-hidden="true">⌕</span>
  <input
    bind:this={inputEl}
    bind:value={query}
    onfocus={() => (open = true)}
    onkeydown={onKey}
    type="search"
    role="combobox"
    aria-expanded={show}
    aria-controls="bp-search-list"
    aria-label="Search bridges, locks, moorings and places"
    placeholder="Search a bridge, lock, mooring…"
    autocomplete="off"
    spellcheck="false"
  />
  {#if query}
    <button class="bp-search-clear" aria-label="Clear search" onclick={() => { query = ''; open = true; inputEl?.focus(); }}>✕</button>
  {/if}

  {#if show}
    <ul class="bp-search-list" id="bp-search-list" role="listbox">
      {#each results as r, i (r.kind + r.id)}
        <li role="option" aria-selected={i === active}>
          <button
            class="bp-search-item"
            class:active={i === active}
            onmouseenter={() => (active = i)}
            onclick={() => pick(r)}
          >
            <span class="bp-search-glyph" data-kind={r.kind}>{ICON[r.kind]}</span>
            <span class="bp-search-text">
              <span class="bp-search-name">{r.name}</span>
              <span class="bp-search-sub">{r.sublabel}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- click-away to close -->
{#if open}
  <button class="bp-search-backdrop" aria-hidden="true" tabindex="-1" onclick={() => (open = false)}></button>
{/if}

<style>
  .bp-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.5rem;
    padding: 0 0.6rem;
    min-height: 44px;
    box-shadow: 0 2px 8px rgba(26, 16, 8, 0.15);
    z-index: 2; /* above the backdrop */
  }
  .bp-search.open { border-color: var(--accent); }
  .bp-search-ic { font-size: 1rem; color: var(--text-muted); }
  .bp-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    outline: none;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-primary);
    padding: 0.5rem 0;
  }
  .bp-search input::placeholder { color: var(--text-muted); }
  .bp-search input::-webkit-search-cancel-button { display: none; }
  .bp-search-clear {
    border: none; background: transparent; cursor: pointer;
    color: var(--text-muted); font-size: 0.8rem; padding: 0.2rem 0.3rem; line-height: 1;
  }
  .bp-search-clear:hover { color: var(--text-primary); }

  .bp-search-list {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.3rem;
    list-style: none;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 26px rgba(26, 16, 8, 0.28);
    max-height: min(60vh, 22rem);
    overflow-y: auto;
  }
  .bp-search-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0.5rem 0.55rem;
    border-radius: 0.4rem;
    color: var(--text-primary);
  }
  .bp-search-item.active { background: color-mix(in srgb, var(--accent) 16%, var(--surface-elevated)); }
  .bp-search-glyph {
    flex: none;
    width: 1.5rem; height: 1.5rem;
    display: grid; place-items: center;
    border-radius: 0.35rem;
    font-size: 0.8rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
  }
  .bp-search-glyph[data-kind='bridge'] { color: #2e7d32; }
  .bp-search-glyph[data-kind='lock'] { color: #4527a0; }
  .bp-search-glyph[data-kind='mooring'] { color: #c4570a; }
  .bp-search-glyph[data-kind='poi'] { color: #b8860b; }
  .bp-search-text { display: flex; flex-direction: column; min-width: 0; gap: 0.05rem; }
  .bp-search-name {
    font-family: var(--font-body); font-weight: 600; font-size: 0.86rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bp-search-sub {
    font-family: var(--font-mono); font-size: 0.62rem; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--text-muted);
  }
  .bp-search-backdrop {
    position: fixed; inset: 0; z-index: 1;
    background: transparent; border: none; cursor: default;
  }
</style>
