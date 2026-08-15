<script lang="ts">
  import type { StandardEntry } from '../lib/types';
  import { identifierById } from '../lib/knowledge';
  import { app } from '../lib/appState.svelte';
  let { std, compact = false, explorable = true }: { std: StandardEntry; compact?: boolean; explorable?: boolean } = $props();
  function open() { if (explorable) app.openStandard(std.id); }
</script>

<div class="sc" class:compact class:clickable={explorable} onclick={open} role={explorable ? 'button' : undefined} tabindex={explorable ? 0 : undefined} onkeydown={(e) => { if (explorable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
  <div class="sc-head">
    <span class="sc-name">{std.name}</span>
    <span class="dsd-pill muted">{std.sector}</span>
  </div>
  <span class="sc-owner">{std.owner}</span>
  {#if !compact}<p class="sc-desc">{std.description}</p>{/if}
  <div class="sc-meta">
    {#if std.identifiers?.length}
      <div class="m"><span class="ml">Identifiers</span> {std.identifiers.map((i) => identifierById(i)?.name?.replace(/\s*\(.*\)/, '') || i).join(' · ')}</div>
    {/if}
    {#if std.formats?.length}<div class="m"><span class="ml">Formats</span> {std.formats.join(' · ').toUpperCase()}</div>{/if}
    {#if std.cadence}<div class="m"><span class="ml">Cadence</span> {std.cadence}</div>{/if}
  </div>
  <div class="sc-foot">
    {#if explorable}<span class="sc-explore">Explore →</span>{/if}
    {#if std.urls?.length}<a class="sc-link" href={std.urls[0]} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>Source ↗</a>{/if}
  </div>
</div>

<style>
  .sc { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 13px 15px; background: var(--surface-elevated); display: flex; flex-direction: column; gap: 5px; }
  .sc.compact { padding: 9px 12px; gap: 3px; }
  .sc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sc-name { font-weight: 700; font-size: var(--fs-nav); color: var(--text-primary); line-height: 1.2; }
  .sc-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .sc-desc { font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); margin: 4px 0 2px; }
  .sc-meta { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
  .sc-meta .m { font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .sc-meta .ml { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); margin-right: 5px; }
  .sc.clickable { cursor: pointer; transition: border-color 0.15s, transform 0.15s; }
  .sc.clickable:hover { border-color: var(--accent); transform: translateY(-1px); }
  .sc.clickable:hover .sc-explore { color: var(--accent); }
  .sc-foot { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .sc-explore { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); }
  .sc-link { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-left: auto; }
</style>
