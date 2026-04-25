<script lang="ts">
  import MetricRow from './MetricRow.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const easy = $derived(data?.value?.easyPct ?? 0);
  const mid = $derived(data?.value?.midPct ?? 0);
  const hard = $derived(data?.value?.hardPct ?? 0);
  const verdict = $derived(data?.value?.verdict ?? 'pyramid');
  const tone = $derived.by(() => verdict === 'polarised' ? 'good' as const :
    verdict === 'pyramid' ? 'warn' as const : 'bad' as const);
  const label = $derived.by(() => verdict.replace('-', ' '));
</script>

<MetricRow
  name="Intensity Distribution"
  evidenceId="polarised"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{Math.round(easy)}<span class="sep">·</span>{Math.round(mid)}<span class="sep">·</span>{Math.round(hard)}{/snippet}
  {#snippet status()}{label}{/snippet}
  {#snippet bar()}
    <span class="stack">
      <span class="seg seg-easy" style="width:{easy}%;" title="Easy (Z1+Z2)"></span>
      <span class="seg seg-mid"  style="width:{mid}%;"  title="Mid (Z3)"></span>
      <span class="seg seg-hard" style="width:{hard}%;" title="Hard (Z4+Z5)"></span>
    </span>
  {/snippet}
</MetricRow>

<style>
  .sep { color: var(--text-ghost); margin: 0 2px; font-size: 11px; }
  .stack { display: flex; height: 6px; background: var(--card-border); }
  .seg { display: block; height: 6px; }
  .seg-easy { background: var(--accent); }
  .seg-mid { background: var(--accent-tint-35); }
  .seg-hard { background: var(--text-muted); }
</style>
