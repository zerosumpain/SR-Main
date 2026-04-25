<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const ratio = $derived(data?.value?.ratio ?? 0);
  const zone = $derived(data?.value?.zone ?? 'detraining');
  const tone = $derived.by(() => zone === 'optimal' ? 'good' as const :
    zone === 'caution' || zone === 'undertraining' ? 'warn' as const : 'bad' as const);
  const markerLeft = $derived(Math.min(100, Math.max(0, (ratio / 2) * 100)));
</script>

<MetricRow
  name="ACWR (Workload Ratio)"
  evidenceId="acwr"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{ratio.toFixed(2)}{/snippet}
  {#snippet status()}{zone.replace('-', ' ')}{/snippet}
  {#snippet bar()}
    <span class="bar">
      <span class="bar-zone" style="left:0%; width:25%; background: rgba(194,91,91,0.18);"></span>
      <span class="bar-zone" style="left:25%; width:15%; background: rgba(196,87,10,0.10);"></span>
      <span class="bar-zone" style="left:40%; width:25%; background: rgba(196,87,10,0.30);"></span>
      <span class="bar-zone" style="left:65%; width:10%; background: rgba(196,87,10,0.10);"></span>
      <span class="bar-zone" style="left:75%; width:25%; background: rgba(194,91,91,0.18);"></span>
      <span class="bar-tick" style="left:40%;"></span>
      <span class="bar-tick" style="left:65%;"></span>
      <span class="bar-tick" style="left:75%;"></span>
      <span class="bar-marker" style="left:{markerLeft}%;"></span>
    </span>
  {/snippet}
</MetricRow>

<style>
  .bar { display: block; height: 6px; background: var(--card-border); position: relative; }
  .bar-zone { position: absolute; top: 0; height: 6px; }
  .bar-tick { position: absolute; top: -1px; width: 1px; height: 8px; background: var(--text-ghost); }
  .bar-marker {
    position: absolute; top: -2px; width: 2px; height: 10px;
    background: var(--text-primary); transform: translateX(-1px);
  }
</style>
