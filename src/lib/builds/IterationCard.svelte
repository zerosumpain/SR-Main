<script lang="ts">
  import LaneThinking from './LaneThinking.svelte';
  import LaneTools from './LaneTools.svelte';
  import LaneOutput from './LaneOutput.svelte';
  import type { IterationCardData } from './feed';

  let { iter }: { iter: IterationCardData } = $props();

  const label = $derived(iter.id === '__unscoped__' ? 'System' : `Iteration ${iter.id.slice(0, 8)}`);
</script>

<section class="nm-sec iter">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">{label}</span>
  </header>

  {#if iter.lanes.thinking}
    <LaneThinking content={iter.lanes.thinking} />
  {/if}

  {#if iter.lanes.tools.length > 0}
    <LaneTools tools={iter.lanes.tools} />
  {/if}

  {#if iter.lanes.output}
    <LaneOutput content={iter.lanes.output} />
  {/if}

  {#each iter.systemLogs as log, i (i)}
    <pre class="syslog">{log}</pre>
  {/each}
</section>

<style>
  .iter {
    font-family: var(--font-body);
  }
  .syslog {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    margin: 0.4rem 0 0;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
