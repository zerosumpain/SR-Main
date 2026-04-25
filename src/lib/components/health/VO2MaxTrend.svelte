<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const cur = $derived(data?.value?.current ?? 0);
  const pct = $derived(data?.value?.percentile ?? 0);
  const band = $derived(data?.value?.band ?? 'poor');
  const slope = $derived(data?.value?.trendSlopePerMonth ?? 0);
  const tone = $derived.by(() => pct >= 60 ? 'good' as const : pct >= 40 ? 'warn' as const : 'bad' as const);
  const arrow = $derived(slope > 0.05 ? '↑' : slope < -0.05 ? '↓' : '→');
</script>

<MetricRow
  name="VO₂max (Cardio)"
  evidenceId="vo2max"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{cur.toFixed(1)}<span class="unit">{arrow}</span>{/snippet}
  {#snippet status()}p{Math.round(pct)} · {band}{/snippet}
  {#snippet bar()}
    <span class="bar"><span class="bar-fill" style="width:{Math.min(100, Math.max(0, pct))}%;"></span></span>
  {/snippet}
</MetricRow>

<style>
  .unit { font-size: 11px; color: var(--text-ghost); margin-left: 4px; }
  .bar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .bar-fill { display: block; height: 2px; background: var(--accent); }
</style>
