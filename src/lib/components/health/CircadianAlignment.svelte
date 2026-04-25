<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');

  function fmtMid(min: number): string {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
</script>

<MetricCard
  label="Circadian Alignment"
  evidenceId="circadian-alignment"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ca-grid">
      <div>
        <div class="ca-label">7d midpoint</div>
        <div class="ca-val">{fmtMid(data.value.recentMidpointMin)}</div>
      </div>
      <div>
        <div class="ca-label">Baseline midpoint</div>
        <div class="ca-val">{fmtMid(data.value.baselineMidpointMin)}</div>
      </div>
      <div>
        <div class="ca-label">Drift</div>
        <div class="ca-val ca-{data.value.flag}">
          {data.value.driftHours > 0 ? '+' : ''}{data.value.driftHours.toFixed(1)} h
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ca-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .ca-label {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--text-ghost);
  }
  .ca-val { font-size: 22px; font-weight: 300; color: var(--text-primary); margin-top: 4px; font-family: var(--font-mono); }
  .ca-val.ca-drift-late, .ca-val.ca-drift-early { color: #c44; }
  .ca-val.ca-aligned { color: var(--accent); }
  @media (max-width: 480px) { .ca-grid { grid-template-columns: 1fr 1fr; } }
</style>
