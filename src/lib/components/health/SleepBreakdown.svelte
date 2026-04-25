<script lang="ts">
  let { sleepAnalysis }: { sleepAnalysis: any } = $props();
  const latest = sleepAnalysis?.latest;

  function msToHours(ms: number): string {
    return (ms / 3600000).toFixed(1);
  }

  const stages = latest ? [
    { label: 'Light', pct: latest.lightPercent, color: '#b8a88c' },
    { label: 'Deep', pct: latest.deepPercent, color: '#8b6914' },
    { label: 'REM', pct: latest.remPercent, color: 'var(--accent)' },
    { label: 'Awake', pct: latest.awakePercent, color: 'var(--text-whisper)' },
  ] : [];
</script>

<section class="nm-sec sleep-wrap">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Sleep</span>
  </div>

  {#if latest}
    <div class="border p-6" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-2xl font-light" style="color: var(--text-primary);">
        {msToHours(latest.totalDuration)} <span class="text-sm" style="color: var(--text-ghost);">hours</span>
      </p>

      <!-- Stage bar -->
      <div class="flex mt-4 gap-0.5" style="height: 2px; overflow: hidden;">
        {#each stages as stage}
          {#if stage.pct > 0}
            <div style="width: {stage.pct}%; background: {stage.color};"></div>
          {/if}
        {/each}
      </div>

      <!-- Stage labels -->
      <div class="flex justify-between mt-2">
        {#each stages as stage}
          <span class="sr-label-tight" style="color: var(--text-ghost);">
            {stage.label} {stage.pct}%
          </span>
        {/each}
      </div>

      <!-- Metrics -->
      <div class="flex gap-6 mt-5">
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Performance</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.performance)}%</p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Consistency</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.consistency)}%</p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Efficiency</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.efficiency)}%</p>
        </div>
      </div>
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No sleep data yet.</p>
  {/if}
</section>

<style>
  .sleep-wrap {
    padding: 0 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
