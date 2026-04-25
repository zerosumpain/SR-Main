<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const v = $derived(data?.value ?? 0);
  const tone = $derived.by(() => v >= 87 ? 'good' as const : v >= 70 ? 'warn' as const : 'bad' as const);
  const label = $derived.by(() => v >= 87 ? 'Regular' : v >= 70 ? 'Mid' : 'Irregular');
</script>

<MetricRow
  name="Sleep Regularity (SRI)"
  evidenceId="sri"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{Math.round(v)}{/snippet}
  {#snippet status()}{label}{/snippet}
  {#snippet bar()}
    <span class="bar">
      <span class="bar-fill" style="width:{Math.min(100, Math.max(0, v))}%;"></span>
      <span class="bar-tick" style="left:70%;"></span>
      <span class="bar-tick" style="left:87%;"></span>
    </span>
  {/snippet}
</MetricRow>

<style>
  .bar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .bar-fill { display: block; height: 2px; background: var(--accent); }
  .bar-tick {
    position: absolute; top: -2px; width: 1px; height: 6px; background: var(--text-ghost);
  }
</style>
