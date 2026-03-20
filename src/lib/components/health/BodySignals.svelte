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

<section class="max-w-lg mx-auto px-6 sm:px-8">
  <h2 class="text-[10px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost); font-family: var(--font-mono);">
    Body Signals
  </h2>

  {#if signals?.length}
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {#each signals as signal}
        <div class="backdrop-blur-md border rounded-xl p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {labels[signal.metric] || signal.metric}
          </p>
          <p class="text-xl font-light mt-1" style="color: var(--text-primary);">
            {Math.round(signal.current)}
            <span class="text-xs" style="color: var(--text-ghost);">{signal.unit}</span>
          </p>
          <p class="text-[9px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {signal.trend === 'up' ? '↑' : signal.trend === 'down' ? '↓' : '→'} avg {Math.round(signal.average7d)} {signal.unit}
          </p>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No body signal data yet.</p>
  {/if}
</section>
