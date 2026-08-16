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
  {#each METHODOLOGY as entry (entry.id)}
    <article class="ev-entry" data-entry-id={entry.id}>
      <div class="ev-rule">
        <span class="ev-metric">{entry.metric}</span>
        <span class="ev-cite">{entry.cite}</span>
      </div>
      <dl class="ev-grid">
        <dt>Formula</dt><dd>{entry.formula}</dd>
        <dt>Source</dt><dd>{entry.sourceData}</dd>
        <dt>Caveats</dt><dd>{entry.caveats}</dd>
        <dt>Reference</dt><dd class="ev-ref">{entry.reference}</dd>
      </dl>
    </article>
  {/each}
</div>

<style>
  .ev-root { display: flex; flex-direction: column; gap: 0; }
  .ev-entry { padding: 0 0 0.75rem; }
  .ev-rule {
    display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap;
    padding: 0.5rem 0 0.4rem;
    border-top: 1px solid var(--line-strong);
    margin-bottom: 0.4rem;
  }
  .ev-entry:first-child .ev-rule { border-top: 0; padding-top: 0; }
  .ev-metric {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.18em;
    color: var(--accent);
  }
  .ev-cite {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-left: auto;
  }
  .ev-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.85rem;
    row-gap: 0.3rem;
    margin: 0;
  }
  .ev-grid dt {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-muted);
    padding-top: 2px;
  }
  .ev-grid dd {
    font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-secondary);
    margin: 0;
  }
  .ev-ref { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
</style>
