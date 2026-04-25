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

<section class="nm-sec weekly-wrap">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">This Week</span>
  </div>

  {#if stats?.weekly}
    <div class="border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="grid grid-cols-3 gap-4 p-6">
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Activities</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.activities}</p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Distance</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{formatDistance(stats.weekly.totalDistance)} <span class="text-xs" style="color: var(--text-ghost);">km</span></p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Duration</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{formatDuration(stats.weekly.totalDuration)}</p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Elevation</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{Math.round(stats.weekly.totalElevation)} <span class="text-xs" style="color: var(--text-ghost);">m</span></p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Avg Recovery</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.avgRecovery}%</p>
        </div>
        <div>
          <p class="sr-label-tight" style="color: var(--text-ghost);">Avg Sleep</p>
          <p class="text-xl font-light" style="color: var(--text-primary);">{stats.weekly.avgSleep}%</p>
        </div>
      </div>
    </div>

    {#if stats.personalRecords?.length}
      <div class="nm-sec-hd" style="margin-top: 2rem;">
        <span class="sr-label-tight">Personal Records</span>
      </div>
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

<style>
  .weekly-wrap {
    padding: 0 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
