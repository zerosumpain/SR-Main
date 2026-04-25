<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');

  function markerLeft(ratio: number): number {
    return Math.min(100, Math.max(0, (ratio / 2) * 100));
  }
</script>

<MetricCard
  label="ACWR — Injury Risk"
  evidenceId="acwr"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ar-row">
      <div class="ar-ratio ar-{data.value.zone}">{data.value.ratio.toFixed(2)}</div>
      <div class="ar-rest">
        <div class="ar-bar">
          <div class="ar-band-detrain" style="left:0%; width:25%;"></div>
          <div class="ar-band-under" style="left:25%; width:15%;"></div>
          <div class="ar-band-optimal" style="left:40%; width:25%;"></div>
          <div class="ar-band-caution" style="left:65%; width:10%;"></div>
          <div class="ar-band-danger" style="left:75%; width:25%;"></div>
          <div class="ar-marker" style="left: {markerLeft(data.value.ratio)}%;"></div>
        </div>
        <div class="ar-axis">
          <span>0.5</span><span>0.8</span><span>1.3</span><span>1.5</span>
        </div>
        <div class="ar-zone">{data.value.zone.toUpperCase()}</div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ar-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .ar-ratio { font-size: 48px; font-weight: 200; line-height: 1; font-family: var(--font-display); color: var(--text-primary); }
  .ar-ratio.ar-optimal { color: var(--accent); }
  .ar-ratio.ar-caution, .ar-ratio.ar-undertraining { color: #b88a40; }
  .ar-ratio.ar-danger, .ar-ratio.ar-detraining { color: #c44; }
  .ar-rest { display: flex; flex-direction: column; gap: 0.35rem; }
  .ar-bar { position: relative; height: 8px; background: var(--card-border); }
  .ar-bar > div { position: absolute; top: 0; height: 8px; }
  .ar-band-optimal { background: rgba(184,84,31,0.25); }
  .ar-band-caution { background: rgba(184,138,64,0.4); }
  .ar-band-danger { background: rgba(196,68,68,0.4); }
  .ar-band-detrain { background: rgba(196,68,68,0.25); }
  .ar-band-under { background: rgba(184,138,64,0.25); }
  .ar-marker { width: 2px; background: var(--text-primary); top: -3px; height: 14px; }
  .ar-axis { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .ar-zone { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; color: var(--text-secondary); }
  @media (max-width: 480px) { .ar-row { grid-template-columns: 1fr; } }
</style>
