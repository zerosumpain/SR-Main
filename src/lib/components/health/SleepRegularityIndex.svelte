<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const band = $derived.by(() => {
    if (!data) return 'low';
    const v = data.value;
    return v >= 87 ? 'regular' : v >= 70 ? 'mid' : 'irregular';
  });
</script>

<MetricCard
  label="Sleep Regularity Index"
  evidenceId="sri"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="sri-row">
      <div class="sri-score">{Math.round(data.value)}</div>
      <div class="sri-rest">
        <div class="sri-band sri-{band}">
          {band === 'regular' ? 'Regular' : band === 'mid' ? 'Moderately regular' : 'Irregular'}
        </div>
        <div class="sri-bar">
          <div class="sri-bar-fill" style="width: {Math.min(100, Math.max(0, data.value))}%;"></div>
          <div class="sri-bar-tick" style="left: 70%;" title="moderately regular"></div>
          <div class="sri-bar-tick" style="left: 87%;" title="regular"></div>
        </div>
        <p class="sri-note">Phillips 2017. Higher = more consistent sleep/wake schedule.</p>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .sri-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .sri-score { font-size: 56px; font-weight: 200; color: var(--accent); line-height: 1; font-family: var(--font-display); }
  .sri-rest { display: flex; flex-direction: column; gap: 0.4rem; }
  .sri-band {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
  }
  .sri-band.sri-regular { color: var(--accent); }
  .sri-band.sri-mid { color: var(--text-secondary); }
  .sri-band.sri-irregular { color: #c44; }
  .sri-bar { position: relative; height: 2px; background: var(--card-border); }
  .sri-bar-fill { height: 2px; background: var(--accent); }
  .sri-bar-tick { position: absolute; top: -2px; width: 1px; height: 6px; background: var(--text-ghost); }
  .sri-note { margin: 0; font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  @media (max-width: 480px) { .sri-row { grid-template-columns: 1fr; } .sri-score { font-size: 44px; } }
</style>
