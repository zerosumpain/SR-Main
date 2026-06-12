<script lang="ts">
  import type { StandardEntry } from '../lib/types';
  import { identifierById } from '../lib/knowledge';
  let { std, compact = false }: { std: StandardEntry; compact?: boolean } = $props();
</script>

<div class="sc" class:compact>
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
  {#if std.urls?.length}
    <a class="sc-link" href={std.urls[0]} target="_blank" rel="noopener">Source ↗</a>
  {/if}
</div>

<style>
  .sc { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 13px 15px; background: var(--surface-elevated); display: flex; flex-direction: column; gap: 5px; }
  .sc.compact { padding: 9px 12px; gap: 3px; }
  .sc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sc-name { font-weight: 700; font-size: 14px; color: var(--text-primary); line-height: 1.2; }
  .sc-owner { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .sc-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 4px 0 2px; }
  .sc-meta { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
  .sc-meta .m { font-size: 11.5px; color: var(--text-secondary); }
  .sc-meta .ml { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); margin-right: 5px; }
  .sc-link { align-self: flex-start; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-top: 3px; }
</style>
