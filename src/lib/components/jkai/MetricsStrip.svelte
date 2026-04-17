<script lang="ts">
  let {
    metrics,
    totalSpendUsd = 0,
  }: {
    metrics: { scheduled: number; running: number; completed: number; failed: number };
    totalSpendUsd?: number;
  } = $props();
</script>

<div class="flex items-center gap-4 text-[11px]" style="font-family: var(--font-mono); color: var(--text-ghost);">
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
  <span title="Total LLM spend across conversations and builds">
    ${totalSpendUsd.toFixed(2)} spend
  </span>
</div>
