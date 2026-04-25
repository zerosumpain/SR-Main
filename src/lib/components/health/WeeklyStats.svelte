<script lang="ts">
  let {
    stats,
    onopenDetail,
  }: { stats: any; onopenDetail?: () => void } = $props();

  function formatDistance(m: number): string {
    return (m / 1000).toFixed(1);
  }
  function formatDuration(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
  }
</script>

{#if stats?.weekly}
  <button type="button" class="strip" onclick={() => onopenDetail?.()}>
    <div class="cell">
      <span class="lbl">Activities</span>
      <span class="val">{stats.weekly.activities}</span>
    </div>
    <div class="cell">
      <span class="lbl">Distance</span>
      <span class="val">{formatDistance(stats.weekly.totalDistance)}<span class="u">km</span></span>
    </div>
    <div class="cell">
      <span class="lbl">Duration</span>
      <span class="val">{formatDuration(stats.weekly.totalDuration)}</span>
    </div>
    <div class="cell">
      <span class="lbl">Elevation</span>
      <span class="val">{Math.round(stats.weekly.totalElevation)}<span class="u">m</span></span>
    </div>
  </button>
{/if}

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    width: 100%;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--card-border);
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .strip:hover { background: var(--surface-overlay); }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0.6rem 0.85rem;
    border-right: 1px solid var(--divider);
    min-width: 0;
  }
  .cell:last-child { border-right: 0; }
  .lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .val {
    font-family: var(--font-mono);
    font-size: 18px;
    color: var(--text-primary);
    line-height: 1;
  }
  .u { font-size: 10px; color: var(--text-ghost); margin-left: 2px; }
  @media (max-width: 640px) {
    .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cell:nth-child(2n) { border-right: 0; }
  }
</style>
