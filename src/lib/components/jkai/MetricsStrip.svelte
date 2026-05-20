<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';

  let {
    metrics,
    totalSpendUsd = 0,
  }: {
    metrics: { scheduled: number; running: number; completed: number; failed: number };
    totalSpendUsd?: number;
  } = $props();
</script>

<div
  class="flex items-center gap-4 text-[11px] overflow-x-auto whitespace-nowrap min-w-0"
  style="font-family: var(--font-mono); color: var(--text-ghost); scrollbar-width: none;"
>
  <span>{metrics.scheduled} scheduled</span>
  <span style="color: var(--text-ghost);">|</span>
  {#if metrics.running > 0}
    <span style="color: #569cd6;">{metrics.running} running</span>
  {:else}
    <span>{metrics.running} running</span>
  {/if}
  <span style="color: var(--text-ghost);">|</span>
  <span>{metrics.completed} completed</span>
  <span style="color: var(--text-ghost);">|</span>
  {#if metrics.failed > 0}
    <span style="color: #b43232;">{metrics.failed} failed</span>
  {:else}
    <span>{metrics.failed} failed</span>
  {/if}
  <span style="color: var(--text-ghost);">|</span>
  <span title="LLM spend (GBP) across conversations and builds active in the last 24h">
    {formatGbp(totalSpendUsd)} spend · 24h
  </span>
</div>
