<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Polarised Training Distribution"
  evidenceId="polarised"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="pd-row">
      <div class="pd-stack">
        <div class="pd-easy" style="width: {data.value.easyPct}%;" title="Easy (Z1+Z2)">{Math.round(data.value.easyPct)}%</div>
        <div class="pd-mid" style="width: {data.value.midPct}%;" title="Mid (Z3)">{Math.round(data.value.midPct)}%</div>
        <div class="pd-hard" style="width: {data.value.hardPct}%;" title="Hard (Z4+Z5)">{Math.round(data.value.hardPct)}%</div>
      </div>
      <div class="pd-meta">
        <div class="pd-line"><span class="pd-dot pd-d-easy"></span>Easy</div>
        <div class="pd-line"><span class="pd-dot pd-d-mid"></span>Mid</div>
        <div class="pd-line"><span class="pd-dot pd-d-hard"></span>Hard</div>
      </div>
      <div class="pd-verdict pd-{data.value.verdict}">
        {data.value.verdict.replace('-', ' ')}
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .pd-row { display: grid; grid-template-columns: 1fr auto auto; gap: 1.25rem; align-items: center; }
  .pd-stack { display: flex; height: 22px; border: 1px solid var(--card-border); }
  .pd-stack > div { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 10px; color: var(--bg); }
  .pd-easy { background: var(--accent); }
  .pd-mid { background: #b88a40; }
  .pd-hard { background: #6b3a1a; }
  .pd-meta { display: flex; flex-direction: column; gap: 4px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
  .pd-line { display: flex; align-items: center; gap: 6px; }
  .pd-dot { display: inline-block; width: 8px; height: 8px; border: 1px solid var(--card-border); }
  .pd-d-easy { background: var(--accent); }
  .pd-d-mid { background: #b88a40; }
  .pd-d-hard { background: #6b3a1a; }
  .pd-verdict {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
  }
  .pd-verdict.pd-polarised { color: var(--accent); }
  .pd-verdict.pd-pyramid { color: var(--text-secondary); }
  .pd-verdict.pd-junk-middle { color: #c44; }
  .pd-verdict.pd-insufficient-volume { color: var(--text-ghost); }
  @media (max-width: 640px) { .pd-row { grid-template-columns: 1fr; } }
</style>
