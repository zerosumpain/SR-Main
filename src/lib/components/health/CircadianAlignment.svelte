<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const drift = $derived(data?.value?.driftHours ?? 0);
  const flag = $derived(data?.value?.flag ?? 'aligned');
  const tone = $derived.by(() => flag === 'aligned' ? 'good' as const : Math.abs(drift) > 1.5 ? 'bad' as const : 'warn' as const);
  const label = $derived.by(() => flag === 'aligned' ? 'Aligned' : flag === 'drift-late' ? 'Phase delayed' : 'Phase advanced');
  const barWidth = $derived(Math.min(100, Math.abs(drift) / 3 * 50));
</script>

<MetricRow
  name="Circadian Alignment"
  evidenceId="circadian-alignment"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{drift > 0 ? '+' : ''}{drift.toFixed(1)}<span class="unit">h</span>{/snippet}
  {#snippet status()}{label}{/snippet}
  {#snippet bar()}
    <span class="bar">
      <span class="bar-mid"></span>
      <span class="bar-fill" style="left:{drift >= 0 ? 50 : 50 - barWidth}%; width:{barWidth}%; background:{tone === 'good' ? 'var(--accent)' : tone === 'bad' ? 'var(--status-error)' : 'var(--text-muted)'};"></span>
    </span>
  {/snippet}
</MetricRow>

<style>
  .unit { font-size: 10px; color: var(--text-ghost); margin-left: 1px; }
  .bar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .bar-fill { position: absolute; top: 0; height: 2px; }
  .bar-mid { position: absolute; left: 50%; top: -2px; width: 1px; height: 6px; background: var(--text-ghost); }
</style>
