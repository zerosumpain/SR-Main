<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const m = $derived(data?.value?.monotony ?? 0);
  const band = $derived(data?.value?.band ?? 'low');
  const tone = $derived.by(() => band === 'low' ? 'good' as const : band === 'moderate' ? 'warn' as const : 'bad' as const);
  const label = $derived.by(() => band === 'low' ? 'Well-varied' : band === 'moderate' ? 'Moderate' : 'High');
  const barWidth = $derived(Math.min(100, (m / 3) * 100));
</script>

<MetricRow
  name="Monotony &amp; Strain"
  evidenceId="monotony"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{m.toFixed(2)}{/snippet}
  {#snippet status()}{label}{/snippet}
  {#snippet bar()}
    <span class="bar">
      <span class="bar-fill" style="width:{barWidth}%; background:{tone === 'bad' ? 'var(--status-error)' : 'var(--accent)'};"></span>
      <span class="bar-tick" style="left:33%;"></span>
      <span class="bar-tick" style="left:66%;"></span>
    </span>
  {/snippet}
</MetricRow>

<style>
  .bar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .bar-fill { display: block; height: 2px; }
  .bar-tick { position: absolute; top: -2px; width: 1px; height: 6px; background: var(--text-ghost); }
</style>
