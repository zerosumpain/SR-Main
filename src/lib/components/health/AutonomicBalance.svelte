<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data,
    onopenDetail,
    onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Autonomic Balance"
  evidenceId="autonomic-balance"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ab-row">
      <div class="ab-score">{Math.round(data.value.score)}</div>
      <div class="ab-meta">
        <div class="ab-line"><span>HRV 7d</span><span class="ab-val">{data.value.hrv7dMean.toFixed(0)} ms</span></div>
        <div class="ab-bar"><div class="ab-bar-fill" style="width:{Math.min(100, Math.max(0, 50 + data.value.hrvZ * 25))}%;"></div></div>
        <div class="ab-line"><span>RHR 7d</span><span class="ab-val">{data.value.rhr7dMean.toFixed(0)} bpm</span></div>
        <div class="ab-bar"><div class="ab-bar-fill" style="width:{Math.min(100, Math.max(0, 50 - data.value.rhrZ * 25))}%;"></div></div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ab-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .ab-score { font-size: 56px; font-weight: 200; color: var(--accent); line-height: 1; font-family: var(--font-display); }
  .ab-meta { display: flex; flex-direction: column; gap: 0.3rem; }
  .ab-line {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
  }
  .ab-val { color: var(--text-primary); }
  .ab-bar { height: 2px; background: var(--card-border); }
  .ab-bar-fill { height: 2px; background: var(--accent); }
  @media (max-width: 480px) {
    .ab-row { grid-template-columns: 1fr; }
    .ab-score { font-size: 44px; }
  }
</style>
