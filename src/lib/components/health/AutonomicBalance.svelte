<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const score = $derived(data?.value?.score ?? 0);
  const tone = $derived.by(() => {
    if (!data) return 'neutral' as const;
    if (score >= 65) return 'good' as const;
    if (score >= 40) return 'warn' as const;
    return 'bad' as const;
  });
  const label = $derived.by(() => {
    if (score >= 65) return 'Recovered';
    if (score >= 40) return 'Mid';
    return 'Stressed';
  });
</script>

<MetricRow
  name="Autonomic Balance"
  evidenceId="autonomic-balance"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}
    {Math.round(score)}
  {/snippet}
  {#snippet status()}
    {label}
  {/snippet}
  {#snippet bar()}
    <span class="bar"><span class="bar-fill" style="width:{Math.min(100, Math.max(0, score))}%;"></span></span>
  {/snippet}
</MetricRow>

<style>
  .bar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .bar-fill { display: block; height: 2px; background: var(--accent); }
</style>
