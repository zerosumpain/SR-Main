<script lang="ts">
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  type Factor = { value: number; weight: number };
  type Readiness = {
    score: number;
    label: string;
    recommendation: string;
    factors: {
      recovery: Factor;
      hrvTrend: Factor & { direction: 'up' | 'down' | 'stable'; raw?: number; avg7d?: number };
      sleepQuality: Factor;
      loadBalance: Factor & { zone: string };
    };
  };

  let {
    readiness,
    onevidence,
  }: { readiness: Readiness; onevidence?: (id: string) => void } = $props();

  // Score band — warm family only: ready = accent, moderate = warn, low = brown.
  const scoreTone = $derived(
    readiness.score >= 70 ? 'good' : readiness.score >= 50 ? 'warn' : 'bad',
  );

  const zoneWord = $derived(readiness.factors.loadBalance.zone.replace(/_/g, ' '));

  const arrow = $derived(
    readiness.factors.hrvTrend.direction === 'up'
      ? '↑'
      : readiness.factors.hrvTrend.direction === 'down'
        ? '↓'
        : '→',
  );

  const bars = $derived([
    { key: 'RECOVERY', f: readiness.factors.recovery, note: '' },
    {
      key: 'HRV TREND',
      f: readiness.factors.hrvTrend,
      note:
        readiness.factors.hrvTrend.raw != null
          ? `${arrow} ${readiness.factors.hrvTrend.raw}ms`
          : arrow,
    },
    { key: 'SLEEP', f: readiness.factors.sleepQuality, note: '' },
    { key: 'LOAD', f: readiness.factors.loadBalance, note: zoneWord },
  ]);
</script>

<div class="rd">
  <div class="rd-verdict">
    <div class="rd-verdict-head">
      <p class="rd-kicker">TODAY · READINESS</p>
      <EvidenceChip id="readiness" onopen={onevidence} />
    </div>
    <p class="rd-score {scoreTone}">
      {readiness.score}<span class="rd-score-max">/100</span>
    </p>
    <p class="rd-label {scoreTone}">{readiness.label}</p>
    <p class="rd-rec">{readiness.recommendation}</p>
  </div>

  <div class="rd-factors">
    <p class="rd-factors-cap">WHAT'S DRIVING IT</p>
    {#each bars as b (b.key)}
      <div class="rd-factor">
        <div class="rd-factor-top">
          <span class="rd-factor-name">{b.key}</span>
          <span class="rd-factor-wt">{Math.round(b.f.weight * 100)}%</span>
        </div>
        <div class="rd-factor-bar">
          <span class="rd-factor-fill" style="width: {Math.max(2, Math.min(100, b.f.value))}%"></span>
        </div>
        <div class="rd-factor-foot">
          <span class="rd-factor-val">{Math.round(b.f.value)}</span>
          {#if b.note}<span class="rd-factor-note">{b.note}</span>{/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .rd {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
    gap: 0;
    border: 2px solid var(--card-border);
    background: var(--bg);
  }
  @media (max-width: 560px) {
    .rd {
      grid-template-columns: 1fr;
    }
  }
  .rd-verdict {
    padding: 20px 22px;
    border-right: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  @media (max-width: 560px) {
    .rd-verdict {
      border-right: none;
      border-bottom: 1px solid var(--divider);
    }
  }
  .rd-verdict-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 2px;
  }
  .rd-kicker {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .rd-score {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(56px, 8vw, 88px);
    line-height: 0.86;
    letter-spacing: -0.03em;
    margin: 2px 0 0;
    color: var(--text-primary);
  }
  .rd-score.good {
    color: var(--accent);
  }
  .rd-score.warn {
    color: var(--warn);
  }
  .rd-score.bad {
    color: var(--trend-down);
  }
  .rd-score-max {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .rd-label {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    line-height: 1;
    margin: 4px 0 0;
    color: var(--text-primary);
  }
  .rd-label.good {
    color: var(--accent);
  }
  .rd-label.warn {
    color: var(--warn);
  }
  .rd-label.bad {
    color: var(--trend-down);
  }
  .rd-rec {
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 8px 0 0;
    border-left: 3px solid var(--accent);
    padding-left: 12px;
  }

  .rd-factors {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    justify-content: center;
  }
  .rd-factors-cap {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 2px;
  }
  .rd-factor {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rd-factor-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .rd-factor-name {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .rd-factor-wt {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .rd-factor-bar {
    height: 6px;
    background: rgba(26, 16, 8, 0.1);
    position: relative;
  }
  .rd-factor-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    display: block;
  }
  .rd-factor-foot {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .rd-factor-val {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 14px;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }
  .rd-factor-note {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
</style>
