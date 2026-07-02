<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { DOCUMENTS, THEME_META, THEME_ORDER, STATUS_META, ROLE_META } from '../../lib/commitments';

  const docs = [...DOCUMENTS].sort((a, b) => (a.date < b.date ? 1 : -1));
</script>

<div class="cf" role="group" aria-label="Filter the ledger">
  <input class="cf-q" type="search" placeholder="Search the ledger…" bind:value={ledger.q} />
  <select class="cf-s" bind:value={ledger.theme} aria-label="Theme">
    <option value="all">Every theme</option>
    {#each THEME_ORDER as t}<option value={t}>{THEME_META[t].label}</option>{/each}
  </select>
  <select class="cf-s" bind:value={ledger.status} aria-label="Status">
    <option value="all">Any status</option>
    {#each Object.entries(STATUS_META) as [id, m]}<option value={id}>{m.label}</option>{/each}
  </select>
  <select class="cf-s" bind:value={ledger.role} aria-label="DfE role">
    <option value="all">Any DfE role</option>
    {#each Object.entries(ROLE_META) as [id, m]}<option value={id}>{m.label}</option>{/each}
  </select>
  <select class="cf-s doc" bind:value={ledger.docId} aria-label="Document">
    <option value="all">Every document</option>
    {#each docs as d}<option value={d.id}>{d.shortName}</option>{/each}
  </select>
  {#if ledger.activeFilters > 0}
    <button class="cf-clear" onclick={() => ledger.clearFilters()}>✕ clear ({ledger.filtered.length} shown)</button>
  {/if}
</div>

<style>
  .cf {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    margin: 0 0 14px;
    padding: 9px 12px;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(241, 234, 214, 0.55);
  }
  .cf-q {
    flex: 1 1 190px;
    min-width: 150px;
    font-family: 'DM Sans', sans-serif;
    font-size: 12.5px;
    padding: 6px 11px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.75);
    color: var(--ink);
  }
  .cf-s {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.75);
    color: var(--ink);
    max-width: 190px;
  }
  .cf-s.doc {
    max-width: 220px;
  }
  .cf-clear {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 5px 10px;
    background: var(--accent-ink-tint-06);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    color: var(--accent-ink);
    cursor: pointer;
  }
</style>
