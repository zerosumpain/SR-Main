<script lang="ts">
  import EvidenceChip from './EvidenceChip.svelte';

  let {
    sleepAnalysis,
    onopenDetail,
    onopenEvidence,
  }: {
    sleepAnalysis: any;
    onopenDetail?: () => void;
    onopenEvidence?: (id: string) => void;
  } = $props();

  const latest = $derived(sleepAnalysis?.latest);
  const hours = $derived(latest ? (latest.totalDuration / 3600000) : 0);
  const tone = $derived.by(() => {
    if (!latest) return 'neutral';
    if (latest.performance >= 85) return 'good';
    if (latest.performance >= 70) return 'warn';
    return 'bad';
  });
  const stages = $derived(latest ? [
    { label: 'Light', pct: latest.lightPercent, color: 'var(--accent-tint-35)' },
    { label: 'Deep',  pct: latest.deepPercent,  color: 'var(--accent)' },
    { label: 'REM',   pct: latest.remPercent,   color: 'var(--text-secondary)' },
    { label: 'Awake', pct: latest.awakePercent, color: 'var(--text-ghost)' },
  ] : []);
</script>

<div class="row" class:disabled={!latest}
     role={latest && onopenDetail ? 'button' : undefined}
     tabindex={latest && onopenDetail ? 0 : undefined}
     onclick={() => latest && onopenDetail?.()}
     onkeydown={(e) => { if (latest && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onopenDetail?.(); } }}>
  <div class="name">
    <span class="label">Last night</span>
    <EvidenceChip id="readiness" onopen={onopenEvidence} />
  </div>

  <div class="value">
    {#if latest}{hours.toFixed(1)}<span class="unit">h</span>{:else}<span class="dim">—</span>{/if}
  </div>

  <div class="status status-{tone}">
    {#if latest}{Math.round(latest.performance)}% perf{:else}<span class="insufficient">no data</span>{/if}
  </div>

  <div class="bar">
    {#if latest}
      <span class="stack">
        {#each stages as s}
          {#if s.pct > 0}<span class="seg" style="width:{s.pct}%; background:{s.color};" title="{s.label} {s.pct}%"></span>{/if}
        {/each}
      </span>
    {/if}
  </div>

  <span class="arrow">{latest ? '›' : ''}</span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(60px, auto) minmax(0, 1fr) minmax(120px, 1.4fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.6rem 0.55rem 0.4rem;
    border-bottom: 1px solid var(--divider);
    cursor: pointer;
    transition: background 80ms ease;
  }
  .row:hover:not(.disabled) { background: var(--surface-overlay); }
  .row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--surface-overlay); }
  .row.disabled { cursor: default; }
  .name { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .label { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .value { font-family: var(--font-mono); font-size: 16px; color: var(--text-primary); text-align: right; line-height: 1; white-space: nowrap; }
  .unit { font-size: 10px; color: var(--text-ghost); margin-left: 1px; }
  .dim { color: var(--text-ghost); }
  .status { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status-good { color: var(--accent); }
  .status-warn { color: var(--text-secondary); }
  .status-bad  { color: var(--status-error); }
  .status-neutral { color: var(--text-muted); }
  .insufficient { font-style: italic; text-transform: none; letter-spacing: 0; color: var(--text-ghost); }
  .stack { display: flex; height: 6px; background: var(--card-border); }
  .seg { display: block; height: 6px; }
  .arrow { font-family: var(--font-mono); font-size: 14px; color: var(--text-ghost); line-height: 1; }
  .row:hover:not(.disabled) .arrow { color: var(--accent); }
  @media (max-width: 640px) {
    .row { grid-template-columns: minmax(0, 1fr) auto auto; row-gap: 4px; }
    .status { grid-column: 1 / 2; font-size: 9px; }
    .bar { grid-column: 1 / -1; }
    .arrow { grid-row: 1; }
  }
</style>
