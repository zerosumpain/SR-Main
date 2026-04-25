<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="VO₂max — Cardio Percentile"
  evidenceId="vo2max"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="v-row">
      <div class="v-current">
        <div class="v-num">{data.value.current.toFixed(1)}</div>
        <div class="v-unit">mL/kg/min</div>
      </div>
      <div class="v-rest">
        <div class="v-line"><span>Percentile</span><span class="v-strong">{Math.round(data.value.percentile)}</span></div>
        <div class="v-bar"><div class="v-bar-fill" style="width: {Math.min(100, Math.max(0, data.value.percentile))}%;"></div></div>
        <div class="v-line"><span>Band</span><span class="v-strong">{data.value.band}</span></div>
        <div class="v-line">
          <span>Trend / month</span>
          <span class="v-strong">
            {data.value.trendSlopePerMonth > 0 ? '↑' : data.value.trendSlopePerMonth < 0 ? '↓' : '→'}
            {data.value.trendSlopePerMonth.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .v-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .v-current { display: flex; flex-direction: column; align-items: flex-start; }
  .v-num { font-size: 48px; font-weight: 200; color: var(--accent); font-family: var(--font-display); line-height: 1; }
  .v-unit { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .v-rest { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  .v-line { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  .v-strong { color: var(--text-primary); text-transform: capitalize; }
  .v-bar { height: 2px; background: var(--card-border); }
  .v-bar-fill { height: 2px; background: var(--accent); }
  @media (max-width: 480px) { .v-row { grid-template-columns: 1fr; } }
</style>
