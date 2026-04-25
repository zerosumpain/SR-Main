<script lang="ts">
  import { METHODOLOGY } from '$lib/health/methodology';
  import { onMount, tick } from 'svelte';

  let { focusId }: { focusId?: string | null } = $props();
  let root: HTMLDivElement | null = $state(null);

  onMount(async () => {
    if (focusId) {
      await tick();
      root?.querySelector(`[data-entry-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
    }
  });
</script>

<div bind:this={root} class="ev-root">
  <p class="ev-intro">
    Every analytics module on this page is derived from peer-reviewed health science.
    Each entry below states the formula, the source data, the citation, and the caveats.
  </p>

  {#each METHODOLOGY as entry (entry.id)}
    <article class="ev-entry" data-entry-id={entry.id}>
      <header class="ev-hd">
        <span class="ev-metric">{entry.metric}</span>
        <span class="ev-cite-tag">{entry.cite}</span>
      </header>
      <dl class="ev-grid">
        <dt>Formula</dt>
        <dd>{entry.formula}</dd>
        <dt>Source data</dt>
        <dd>{entry.sourceData}</dd>
        <dt>Caveats</dt>
        <dd>{entry.caveats}</dd>
        <dt>Reference</dt>
        <dd class="ev-ref">{entry.reference}</dd>
      </dl>
    </article>
  {/each}
</div>

<style>
  .ev-root { display: flex; flex-direction: column; gap: 1.25rem; }
  .ev-intro {
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-secondary);
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--card-border);
    margin: 0;
  }
  .ev-entry {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--card-border);
  }
  .ev-entry:last-child { border-bottom: 0; }
  .ev-hd {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .ev-metric {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-primary);
  }
  .ev-cite-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .ev-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.9rem;
    row-gap: 0.35rem;
    margin: 0;
  }
  .ev-grid dt {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    padding-top: 2px;
  }
  .ev-grid dd {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
  }
  .ev-ref {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
  }
</style>
