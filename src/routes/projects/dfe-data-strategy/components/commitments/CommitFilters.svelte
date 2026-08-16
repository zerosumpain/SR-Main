<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { DOCUMENTS_BY_ID, THEME_META, THEME_ORDER, STATUS_META, ROLE_META } from '../../lib/commitments';
</script>

<div class="cf" role="group" aria-label="Filter the ledger">
  <div class="cf-row">
    <input class="cf-q" type="search" placeholder="Search the ledger…" bind:value={ledger.q} />
    <select class="cf-s" bind:value={ledger.status} aria-label="Status">
      <option value="all">Any status</option>
      {#each Object.entries(STATUS_META) as [id, m]}<option value={id}>{m.label}</option>{/each}
    </select>
    <select class="cf-s" bind:value={ledger.role} aria-label="The department role">
      <option value="all">Any the department role</option>
      {#each Object.entries(ROLE_META) as [id, m]}<option value={id}>{m.label}</option>{/each}
    </select>
    {#if ledger.activeFilters > 0}
      <button class="cf-clear" onclick={() => ledger.clearFilters()}>✕ clear ({ledger.filtered.length} shown)</button>
    {/if}
  </div>
  <div class="cf-row themes" aria-label="Themes — pick one or several">
    <span class="cf-lab">Themes</span>
    {#each THEME_ORDER as t}
      {@const on = ledger.themes.includes(t)}
      <button class="th" class:on style="--c:{THEME_META[t].color}" aria-pressed={on} onclick={() => ledger.toggleTheme(t)}>
        <i></i>{THEME_META[t].label}
      </button>
    {/each}
  </div>
  {#if ledger.docIds.length && ledger.lens !== 'shelf'}
    <div class="cf-row docs">
      <span class="cf-lab">Documents</span>
      {#each ledger.docIds as id (id)}
        <button class="dchip" onclick={() => ledger.toggleDoc(id)} title="Remove {DOCUMENTS_BY_ID[id]?.title}">
          {DOCUMENTS_BY_ID[id]?.shortName ?? id} ✕
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cf {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0 0 14px;
    padding: 9px 12px;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-sharp);
    background: rgba(241, 234, 214, 0.55);
  }
  .cf-row {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }
  .cf-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin-right: 2px;
  }
  .cf-q {
    flex: 1 1 190px;
    min-width: 150px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    padding: 6px 11px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.75);
    color: var(--ink);
  }
  .cf-s {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    padding: 6px 8px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.75);
    color: var(--ink);
    max-width: 190px;
  }
  .cf-clear {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 5px 10px;
    background: var(--accent-ink-tint-06);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-sharp);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .th {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 9px 3px 7px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.6);
    color: rgba(28, 22, 17, 0.7);
    cursor: pointer;
  }
  .th i {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--c);
    opacity: 0.55;
  }
  .th:hover {
    border-color: rgba(28, 22, 17, 0.4);
  }
  .th.on {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 12%, #fff);
    color: var(--ink);
    font-weight: 600;
  }
  .th.on i {
    opacity: 1;
  }
  .dchip {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    padding: 3px 9px;
    border: 1px solid var(--accent-ink);
    border-radius: var(--radius-sharp);
    background: var(--accent-ink);
    color: #fff;
    cursor: pointer;
  }
</style>
