<script lang="ts">
  import { FRAMEWORKS_BY_DATE } from '$lib/dfe-data-strategy/frameworks';
  import type { Framework, FrameworkType } from '$lib/dfe-data-strategy/types';

  // Master–detail explorer for the 12 frameworks: a sortable index on the left
  // (date order, newest first, by default), the full detail of the picked one on
  // the right — so reading a framework never means scanning a wall of cards.
  let sort = $state<'date' | 'weight'>('date');
  let typeFilter = $state<'all' | FrameworkType>('all');
  let selectedId = $state<string>(FRAMEWORKS_BY_DATE[0]?.id ?? '');

  const list = $derived.by(() => {
    let fs = FRAMEWORKS_BY_DATE.filter((f) => typeFilter === 'all' || f.type === typeFilter);
    if (sort === 'weight') fs = [...fs].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    return fs;
  });
  // keep the selection valid when the filter hides it
  $effect(() => {
    if (list.length && !list.some((f) => f.id === selectedId)) selectedId = list[0].id;
  });
  const sel = $derived(FRAMEWORKS_BY_DATE.find((f) => f.id === selectedId) ?? null);

  const TYPE_LABEL: Record<FrameworkType, string> = { 'uk-gov': 'UK government', corporate: 'Corporate & industry' };
  const ROLE_LABEL: Record<string, string> = { foundational: 'Foundational', core: 'Core', specialist: 'Specialist' };
  const ROLE_HINT: Record<string, string> = {
    foundational: 'shapes the strategy from page one',
    core: 'informs the big choices',
    specialist: 'reach for it when its narrow need arises',
  };
  const year = (f: Framework) => f.date.slice(0, 4);
</script>

{#snippet detail(f: Framework)}
  <div class="det-head">
    <span class="det-type" class:gov={f.type === 'uk-gov'}>{TYPE_LABEL[f.type]}</span>
    <span class="det-date">{f.dateLabel}</span>
  </div>
  <h3 class="det-name">{f.name}</h3>
  {#if f.role}
    <div class="det-role" title="How load-bearing this framework is for an education data strategy">
      <span class="dr-lab">{ROLE_LABEL[f.role]}</span>
      <span class="dr-bar"><i style="width:{Math.round((f.weight ?? 0) * 100)}%"></i></span>
      <span class="dr-hint">{ROLE_HINT[f.role]}</span>
    </div>
  {/if}
  <p class="det-sum">{f.summary}</p>
  <span class="det-lab">What it gives you</span>
  <ul class="det-el">
    {#each f.keyElements as el}<li>{el}</li>{/each}
  </ul>
  {#if f.sourceUrl}
    <a class="det-src" href={f.sourceUrl} target="_blank" rel="noopener">Read the source ↗</a>
  {/if}
{/snippet}

<div class="fx">
  <div class="fx-controls">
    <div class="ctl">
      <span class="ctl-lab">Order</span>
      <button class="ctl-btn" class:on={sort === 'date'} onclick={() => (sort = 'date')}>Newest first</button>
      <button class="ctl-btn" class:on={sort === 'weight'} onclick={() => (sort = 'weight')}>Most load-bearing</button>
    </div>
    <div class="ctl">
      <span class="ctl-lab">Show</span>
      <button class="ctl-btn" class:on={typeFilter === 'all'} onclick={() => (typeFilter = 'all')}>All</button>
      <button class="ctl-btn" class:on={typeFilter === 'uk-gov'} onclick={() => (typeFilter = 'uk-gov')}>UK government</button>
      <button class="ctl-btn" class:on={typeFilter === 'corporate'} onclick={() => (typeFilter = 'corporate')}>Corporate & industry</button>
    </div>
  </div>

  <div class="fx-body">
    <div class="fx-list" role="listbox" aria-label="Frameworks">
      {#each list as f (f.id)}
        {@const on = selectedId === f.id}
        <button class="row" class:on role="option" aria-selected={on} onclick={() => (selectedId = f.id)}>
          <span class="r-year">{year(f)}</span>
          <span class="r-body">
            <span class="r-name">{f.name}</span>
            <span class="r-meta">
              <i class="r-type" class:gov={f.type === 'uk-gov'}>{f.type === 'uk-gov' ? 'gov' : 'industry'}</i>
              {#if f.role}<i class="r-role r-{f.role}">{ROLE_LABEL[f.role]}</i>{/if}
            </span>
          </span>
          <span class="r-arrow" aria-hidden="true">→</span>
        </button>
        <div class="row-det" class:open={on}>
          {#if on && sel}{@render detail(sel)}{/if}
        </div>
      {/each}
    </div>
    <aside class="fx-det">
      {#if sel}{@render detail(sel)}{/if}
    </aside>
  </div>
</div>

<style>
  .fx-controls {
    display: flex;
    align-items: center;
    gap: 10px 22px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .ctl-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin-right: 3px;
  }
  .ctl-btn {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    padding: 4px 11px;
    border: 1px solid rgba(28, 22, 17, 0.22);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    color: var(--ink);
    cursor: pointer;
  }
  .ctl-btn:hover {
    background: rgba(28, 22, 17, 0.06);
  }
  .ctl-btn.on {
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border-color: var(--ink);
  }

  .fx-body {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .fx-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 9px 12px;
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .row:hover {
    border-color: rgba(28, 22, 17, 0.35);
    background: rgba(255, 255, 255, 0.8);
  }
  .row.on {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .r-year {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    color: rgba(28, 22, 17, 0.55);
    width: 34px;
  }
  .row.on .r-year {
    color: var(--accent-ink);
  }
  .r-body {
    flex: 1;
    min-width: 0;
  }
  .r-name {
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--ink);
    line-height: 1.3;
  }
  .r-meta {
    display: flex;
    gap: 5px;
    margin-top: 3px;
  }
  .r-meta i {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 7px;
    border-radius: var(--radius-sharp);
    border: 1px solid rgba(28, 22, 17, 0.2);
    color: rgba(28, 22, 17, 0.55);
  }
  .r-type.gov {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
  }
  .r-type:not(.gov) {
    border-color: rgba(180, 99, 46, 0.45);
    color: #b4632e;
  }
  .r-role.r-foundational {
    border-color: rgba(28, 22, 17, 0.55);
    color: var(--ink);
    font-weight: 600;
  }
  .r-arrow {
    flex: none;
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.3);
  }
  .row.on .r-arrow {
    color: var(--accent-ink);
  }

  .fx-det {
    position: sticky;
    top: calc(var(--topH, 90px) + 10px);
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-top: 3px solid var(--accent-ink);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    padding: 16px 19px 18px;
  }
  .row-det {
    display: none;
  }

  .fx :global(.det-head) {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .fx :global(.det-type) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-sharp);
    border: 1px solid rgba(180, 99, 46, 0.45);
    color: #b4632e;
  }
  .fx :global(.det-type.gov) {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
  }
  .fx :global(.det-date) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.55);
  }
  .fx :global(.det-name) {
    margin: 0 0 8px;
    font-family: var(--fs-serif);
    font-size: 20px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink);
  }
  .fx :global(.det-role) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0 0 10px;
  }
  .fx :global(.dr-lab) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--ink);
  }
  .fx :global(.dr-bar) {
    flex: none;
    width: 110px;
    height: 6px;
    border-radius: var(--radius-sharp);
    background: rgba(28, 22, 17, 0.1);
    overflow: hidden;
  }
  .fx :global(.dr-bar i) {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .fx :global(.dr-hint) {
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.55);
  }
  .fx :global(.det-sum) {
    margin: 0 0 12px;
    font-size: var(--fs-label);
    line-height: 1.6;
    color: rgba(28, 22, 17, 0.8);
  }
  .fx :global(.det-lab) {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin: 0 0 5px;
  }
  .fx :global(.det-el) {
    margin: 0 0 12px;
    padding-left: 17px;
  }
  .fx :global(.det-el li) {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.72);
    margin-bottom: 3px;
  }
  .fx :global(.det-src) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }

  @media (max-width: 880px) {
    .fx-body {
      grid-template-columns: 1fr;
    }
    .fx-det {
      display: none;
    }
    .row-det.open {
      display: block;
      border: 1px solid var(--accent-ink-tint-35);
      border-top: none;
      border-radius: 0 0 var(--radius-sharp) var(--radius-sharp);
      background: rgba(255, 255, 255, 0.55);
      padding: 13px 15px 15px;
      margin: -4px 4px 4px;
    }
  }
</style>
