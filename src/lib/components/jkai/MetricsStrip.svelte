<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';

  interface SpendByPeriod {
    day: number;
    week: number;
    month: number;
    lifetime: number;
  }

  let {
    metrics,
    spendByPeriod,
  }: {
    metrics: { scheduled: number; running: number; completed: number; failed: number };
    spendByPeriod: SpendByPeriod;
  } = $props();

  // Click-to-cycle spend window. day → week → month → lifetime → day.
  const PERIODS = [
    { key: 'day', label: 'day' },
    { key: 'week', label: 'week' },
    { key: 'month', label: 'month' },
    { key: 'lifetime', label: 'lifetime' },
  ] as const;
  let periodIdx = $state(0);
  const period = $derived(PERIODS[periodIdx]);
  function cyclePeriod() {
    periodIdx = (periodIdx + 1) % PERIODS.length;
  }
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
  <button
    type="button"
    class="spend"
    onclick={cyclePeriod}
    title="LLM spend (GBP) across conversations and builds — click to change window (day / week / month / lifetime)"
  >
    {formatGbp(spendByPeriod[period.key])} spend · {period.label}
  </button>
</div>

<style>
  .spend {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .spend:hover {
    color: var(--text-primary);
  }
</style>
