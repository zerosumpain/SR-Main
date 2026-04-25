<script lang="ts">
  let { signals }: { signals: any[] } = $props();

  const labels: Record<string, string> = {
    heart_rate: 'Heart Rate',
    heart_rate_variability: 'HRV',
    resting_heart_rate: 'Resting HR',
    oxygen_saturation: 'SpO₂',
    respiratory_rate: 'Resp Rate',
  };
</script>

<section class="nm-sec signals-wrap">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Body Signals</span>
  </div>

  {#if signals?.length}
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {#each signals as signal}
        <div class="border p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <p class="sr-label-tight" style="color: var(--text-ghost);">
            {labels[signal.metric] || signal.metric}
          </p>
          <p class="text-xl font-light mt-1" style="color: var(--text-primary);">
            {Math.round(signal.current)}
            <span class="text-xs" style="color: var(--text-ghost);">{signal.unit}</span>
          </p>
          <p class="sr-label-tight mt-1" style="color: var(--text-ghost);">
            {signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'} avg {Math.round(signal.average7d)} {signal.unit}
          </p>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No body signal data yet.</p>
  {/if}
</section>

<style>
  .signals-wrap {
    padding: 0 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
