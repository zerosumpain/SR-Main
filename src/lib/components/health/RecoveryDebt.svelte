<script lang="ts">
  import MetricRow from './MetricRow.svelte';
  import MiniSparkline from './MiniSparkline.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const debt = $derived(data?.value?.sleepDebtMin ?? 0);
  const overdrawn = $derived(!!data?.value?.overdrawn);
  const tone = $derived.by(() => overdrawn ? 'bad' as const : debt > 120 ? 'warn' as const : 'good' as const);
  const label = $derived.by(() => overdrawn ? 'Overdrawn' : debt > 120 ? 'Building' : 'Cleared');
  const points = $derived.by(() => (data?.value?.series ?? []).map((p: any) => ({ date: new Date(p.date), value: p.debt })));
</script>

<MetricRow
  name="Recovery Debt"
  evidenceId="recovery-debt"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
  statusTone={tone}
>
  {#snippet value()}{Math.round(debt)}<span class="unit">m</span>{/snippet}
  {#snippet status()}{label}{/snippet}
  {#snippet bar()}
    <span class="spark">
      <MiniSparkline points={points} height={18} color={overdrawn ? 'var(--status-error)' : 'var(--text-muted)'} />
    </span>
  {/snippet}
</MetricRow>

<style>
  .unit { font-size: 10px; color: var(--text-ghost); margin-left: 1px; }
  .spark { display: block; }
</style>
