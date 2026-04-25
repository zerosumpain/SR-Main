<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Training Monotony &amp; Strain"
  evidenceId="monotony"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="tm-row">
      <div class="tm-cell">
        <div class="tm-label">Monotony (mean / SD)</div>
        <div class="tm-val tm-{data.value.band}">{data.value.monotony.toFixed(2)}</div>
      </div>
      <div class="tm-cell">
        <div class="tm-label">Strain (sum × monotony)</div>
        <div class="tm-val">{Math.round(data.value.strain)}</div>
      </div>
      <div class="tm-cell">
        <div class="tm-label">Verdict</div>
        <div class="tm-val tm-{data.value.band}">
          {data.value.band === 'high' ? 'High — vary intensity' : data.value.band === 'moderate' ? 'Moderate' : 'Low — well-varied'}
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .tm-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .tm-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .tm-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .tm-val { font-size: 20px; font-weight: 300; color: var(--text-primary); font-family: var(--font-mono); }
  .tm-val.tm-low { color: var(--accent); }
  .tm-val.tm-moderate { color: var(--text-secondary); }
  .tm-val.tm-high { color: #c44; }
  @media (max-width: 480px) { .tm-row { grid-template-columns: 1fr 1fr; } .tm-cell:nth-child(3) { grid-column: 1 / -1; } }
</style>
