<script lang="ts">
  // DataEstateMap — the NEET data estate as three life-stage columns of triaged nodes
  // (proven / underused / missing), with the age-18 dark zone drawn literally and a
  // detail card on click. CSS-grid layout (responsive); linkage listed in the card.
  import { app } from '../lib/appState.svelte';
  import { ESTATE, ESTATE_BY_ID, STAGE_META, TIER_META, type EstateStage } from '../lib/dataestate';
  import { estateSel } from '../lib/estateSel.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let selectedId = $state<string | null>('attendance');
  // consume external selections (the opportunity ladder's "needs" chips)
  $effect(() => {
    const id = estateSel.id;
    if (id && ESTATE_BY_ID[id]) { selectedId = id; estateSel.id = null; }
  });
  const selected = $derived(selectedId ? ESTATE_BY_ID[selectedId] : null);
  const STAGES: EstateStage[] = ['pre16', 'transition', 'post18'];
  const inStage = (s: EstateStage) => ESTATE.filter((n) => n.stage === s);
  // nodes that link TO a node (either direction shown in the card)
  const linkedNames = (id: string) => {
    const fwd = ESTATE_BY_ID[id].links;
    const back = ESTATE.filter((n) => n.links.includes(id)).map((n) => n.id);
    return [...new Set([...fwd, ...back])].map((x) => ESTATE_BY_ID[x].name);
  };
</script>

<div class="dem" id="estate-map">
  <div class="dem-legend">
    {#each Object.entries(TIER_META) as [k, t] (k)}
      <span class="lg"><i class="lg-dot {k}" style="--c:{t.colour}"></i>{eli ? t.eli5 : t.label}</span>
    {/each}
  </div>

  <div class="dem-grid">
    {#each STAGES as st (st)}
      <div class="col" class:dark={st === 'post18'}>
        <span class="col-h">{eli ? STAGE_META[st].eli5 : STAGE_META[st].label}</span>
        {#if st === 'post18'}<span class="dark-lab">⚠ {eli ? 'tracking stops here' : 'the age-18 dark zone'}</span>{/if}
        {#each inStage(st) as n (n.id)}
          <button class="node {n.tier}" class:sel={selectedId === n.id} style="--c:{TIER_META[n.tier].colour}"
                  onclick={() => (selectedId = selectedId === n.id ? null : n.id)}>
            <span class="n-name">{n.name}</span>
            <span class="n-tier">{eli ? TIER_META[n.tier].eli5 : TIER_META[n.tier].label}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if selected}
    <div class="card" style="--c:{TIER_META[selected.tier].colour}">
      <div class="c-head">
        <span class="c-name">{selected.name}</span>
        <span class="c-tier" style="background:{TIER_META[selected.tier].colour}">{eli ? TIER_META[selected.tier].eli5 : TIER_META[selected.tier].label}</span>
      </div>
      <p class="c-blurb">{eli ? selected.blurbEli5 : selected.blurb}</p>
      {#if selected.gap}<p class="c-gap">▸ {selected.gap}</p>{/if}
      <div class="c-meta">
        {#if selected.latency !== '—'}<span><b>{eli ? 'How fresh:' : 'Latency:'}</b> {selected.latency}</span>{/if}
        {#if selected.access !== '—'}<span><b>{eli ? 'Who can use it:' : 'Access:'}</b> {selected.access}</span>{/if}
        {#if linkedNames(selected.id).length}<span><b>{eli ? 'Joined to:' : 'Linked today:'}</b> {linkedNames(selected.id).join(' · ')}</span>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .dem { display: flex; flex-direction: column; gap: 12px; }
  .dem-legend { display: flex; gap: 14px; flex-wrap: wrap; }
  .lg { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.65); }
  .lg-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--c); display: inline-block; }
  .lg-dot.missing { background: transparent; border: 2px dashed var(--c); width: 7px; height: 7px; }

  .dem-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 7px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.3); border: 1px solid rgba(28,22,17,0.1); }
  .col.dark { background: repeating-linear-gradient(45deg, rgba(177,69,94,0.05), rgba(177,69,94,0.05) 8px, rgba(177,69,94,0.11) 8px, rgba(177,69,94,0.11) 16px); border-color: rgba(177,69,94,0.3); }
  .col-h { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.55); font-weight: 600; }
  .dark-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #8a2d3a; letter-spacing: 0.05em; }

  .node { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; cursor: pointer;
    padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.14);
    border-left: 3px solid var(--c); }
  .node.missing { border-style: dashed; background: rgba(255,255,255,0.25); }
  .node:hover { background: rgba(255,255,255,0.9); }
  .node.sel { outline: 2px solid var(--c); background: rgba(255,255,255,0.92); }
  .n-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12.5px; color: var(--ink, #1c1611); line-height: 1.25; }
  .n-tier { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c); }

  .card { border: 1px solid rgba(28,22,17,0.16); border-left: 4px solid var(--c); border-radius: 10px; background: rgba(255,255,255,0.55); padding: 12px 15px; }
  .c-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .c-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); }
  .c-tier { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; padding: 2px 7px; border-radius: 4px; }
  .c-blurb { margin: 0 0 6px; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.76); }
  .c-gap { margin: 0 0 8px; font-size: 12.5px; line-height: 1.5; font-weight: 600; color: #8a2d3a; }
  .c-meta { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: rgba(28,22,17,0.62); }
  .c-meta b { color: var(--ink, #1c1611); font-weight: 600; }
  @media (max-width: 820px) { .dem-grid { grid-template-columns: 1fr; } }
</style>
