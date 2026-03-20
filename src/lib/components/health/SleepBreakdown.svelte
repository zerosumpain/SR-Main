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

<section class="max-w-lg mx-auto px-6 sm:px-8">
  <h2 class="text-[10px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost); font-family: var(--font-mono);">
    Sleep
  </h2>

  {#if latest}
    <div class="backdrop-blur-md border rounded-xl p-6" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-2xl font-light" style="color: var(--text-primary);">
        {msToHours(latest.totalDuration)} <span class="text-sm" style="color: var(--text-ghost);">hours</span>
      </p>

      <!-- Stage bar -->
      <div class="flex h-3 rounded-full overflow-hidden mt-4 gap-0.5">
        {#each stages as stage}
          {#if stage.pct > 0}
            <div style="width: {stage.pct}%; background: {stage.color};" class="rounded-full"></div>
          {/if}
        {/each}
      </div>

      <!-- Stage labels -->
      <div class="flex justify-between mt-2">
        {#each stages as stage}
          <span class="text-[9px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {stage.label} {stage.pct}%
          </span>
        {/each}
      </div>

      <!-- Metrics -->
      <div class="flex gap-6 mt-5">
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Performance</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.performance)}%</p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Consistency</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.consistency)}%</p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Efficiency</p>
          <p class="text-lg font-light" style="color: var(--text-primary);">{Math.round(latest.efficiency)}%</p>
        </div>
      </div>
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No sleep data yet.</p>
  {/if}
</section>
