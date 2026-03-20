<script lang="ts">
  let { stats }: { stats: any } = $props();

  function formatDistance(m: number): string {
    return (m / 1000).toFixed(1);
  }
  function formatDuration(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
</script>

<section class="max-w-lg mx-auto px-6 sm:px-8">
  <h2 class="text-[10px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost); font-family: var(--font-mono);">
    This Week
  </h2>

  {#if stats?.weekly}
    <div class="backdrop-blur-md border rounded-xl p-6" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="grid grid-cols-3 gap-4">
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Activities</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.activities}</p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Distance</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{formatDistance(stats.weekly.totalDistance)} <span class="text-xs" style="color: var(--text-ghost);">km</span></p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Duration</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{formatDuration(stats.weekly.totalDuration)}</p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Elevation</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{Math.round(stats.weekly.totalElevation)} <span class="text-xs" style="color: var(--text-ghost);">m</span></p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Avg Recovery</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.avgRecovery}%</p>
        </div>
        <div>
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Avg Sleep</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.avgSleep}%</p>
        </div>
      </div>
    </div>

    {#if stats.personalRecords?.length}
      <h3 class="text-[10px] uppercase tracking-[0.3em] mt-8 mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Personal Records
      </h3>
      <div class="space-y-2">
        {#each stats.personalRecords as pr}
          <div class="flex justify-between items-center py-2" style="border-bottom: 1px solid var(--card-border);">
            <span class="text-sm" style="color: var(--text-secondary);">{pr.label}</span>
            <span class="text-sm font-light" style="color: var(--text-primary); font-family: var(--font-mono);">
              {pr.value} {pr.unit}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No activity data yet.</p>
  {/if}
</section>
