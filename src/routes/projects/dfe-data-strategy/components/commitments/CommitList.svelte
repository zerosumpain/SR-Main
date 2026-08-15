<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { DOCUMENTS_BY_ID, THEME_META, STATUS_META } from '../../lib/commitments';
  import { app } from '../../lib/appState.svelte';
  import type { Commitment } from '../../lib/types';

  let { items, dense = false }: { items: Commitment[]; dense?: boolean } = $props();
  const eli = $derived(app.narrative === 'eli5');
</script>

<ul class="cl" class:dense>
  {#each items as c (c.id)}
    <li>
      <button class="row" class:on={ledger.selectedId === c.id} onclick={() => ledger.select(c.id)}>
        <i class="dot" style="--c:{THEME_META[c.theme].color}" title={THEME_META[c.theme].label}></i>
        <span class="body">
          <span class="t">{c.title}</span>
          {#if !dense}<span class="w">{eli && c.eli5 ? c.eli5 : c.what}</span>{/if}
        </span>
        <span class="meta">
          <span class="doc">{DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}</span>
          <span class="st" class:hard={c.status === 'statutory-duty' || c.status === 'legislated-not-commenced'}>{STATUS_META[c.status].short}</span>
          {#if c.timeframe}<span class="tf">{c.timeframe}</span>{/if}
        </span>
      </button>
    </li>
  {/each}
  {#if !items.length}
    <li class="none">Nothing matches the current filters.</li>
  {/if}
</ul>

<style>
  .cl {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    padding: 10px 13px;
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .row:hover {
    border-color: rgba(28, 22, 17, 0.35);
    background: rgba(255, 255, 255, 0.75);
  }
  .row.on {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .dense .row {
    padding: 7px 11px;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: var(--radius-pill);
    background: var(--c);
    margin-top: 4px;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .t {
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--ink);
    line-height: 1.35;
  }
  .w {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.65);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    max-width: 150px;
  }
  .doc {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.5);
    text-align: right;
  }
  .st {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: var(--radius-sharp);
    border: 1px solid rgba(28, 22, 17, 0.25);
    color: rgba(28, 22, 17, 0.6);
  }
  .st.hard {
    border-color: #b04a2f;
    color: #b04a2f;
    font-weight: 600;
  }
  .tf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.45);
  }
  .none {
    font-size: var(--fs-label);
    color: rgba(28, 22, 17, 0.55);
    padding: 14px;
    text-align: center;
    border: 1px dashed rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
  }
  @media (max-width: 640px) {
    .meta {
      display: none;
    }
  }
</style>
