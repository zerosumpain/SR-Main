<script lang="ts">
  import MetricCard from './MetricCard.svelte';
  import MiniSparkline from './MiniSparkline.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const points = $derived.by(() => (data?.value?.series ?? []).map((p: any) => ({ date: new Date(p.date), value: p.debt })));
</script>

<MetricCard
  label="Recovery Debt"
  evidenceId="recovery-debt"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="rd-row">
      <div class="rd-cell">
        <div class="rd-label">Sleep debt 14d</div>
        <div class="rd-val" class:rd-overdrawn={data.value.overdrawn}>
          {Math.round(data.value.sleepDebtMin)} min
        </div>
      </div>
      <div class="rd-cell">
        <div class="rd-label">Strain / Recovery</div>
        <div class="rd-val">
          {data.value.strainRecoveryBalance.toFixed(1)}
        </div>
      </div>
      <div class="rd-cell rd-spark">
        <div class="rd-label">Cumulative debt</div>
        <MiniSparkline points={points} height={28} color={data.value.overdrawn ? '#c44' : 'var(--accent)'} />
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .rd-row { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 1.25rem; align-items: center; }
  .rd-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .rd-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .rd-val { font-size: 22px; font-weight: 300; color: var(--text-primary); font-family: var(--font-mono); }
  .rd-val.rd-overdrawn { color: #c44; }
  @media (max-width: 480px) { .rd-row { grid-template-columns: 1fr 1fr; } .rd-spark { grid-column: 1 / -1; } }
</style>
