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

<!-- Stacked, sidebar-footer layout: abbreviated job counts wrap on the first
     row, the click-to-cycle spend window sits on its own row beneath. Kept off
     the chat header so the conversation surface stays uncluttered. -->
<div class="metrics-strip" style="font-family: var(--font-mono); color: var(--text-ghost);">
  <div class="counts">
    <span>{metrics.scheduled} sched</span>
    <span class="sep">·</span>
    <span class:run-active={metrics.running > 0}>{metrics.running} run</span>
    <span class="sep">·</span>
    <span>{metrics.completed} done</span>
    <span class="sep">·</span>
    <span class:fail-active={metrics.failed > 0}>{metrics.failed} fail</span>
  </div>
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
  .metrics-strip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
  }
  .sep {
    opacity: 0.5;
  }
  .run-active {
    color: var(--accent);
  }
  .fail-active {
    color: var(--error);
  }
  .spend {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .spend:hover {
    color: var(--text-primary);
  }
</style>
