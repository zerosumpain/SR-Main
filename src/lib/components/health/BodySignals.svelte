<script lang="ts">
  let {
    signals,
    onopenDetail,
  }: { signals: any[]; onopenDetail?: () => void } = $props();

  const labels: Record<string, string> = {
    heart_rate: 'Heart rate',
    heart_rate_variability: 'HRV',
    resting_heart_rate: 'Resting HR',
    oxygen_saturation: 'SpO₂',
    respiratory_rate: 'Respiratory rate',
  };
  const ranges: Record<string, { lo: number; hi: number }> = {
    heart_rate: { lo: 50, hi: 110 },
    heart_rate_variability: { lo: 20, hi: 80 },
    resting_heart_rate: { lo: 40, hi: 70 },
    oxygen_saturation: { lo: 92, hi: 100 },
    respiratory_rate: { lo: 11, hi: 20 },
  };
  function arrow(t: string): string {
    return t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  }
  function inRange(metric: string, val: number): boolean {
    const r = ranges[metric];
    if (!r) return true;
    return val >= r.lo && val <= r.hi;
  }
  function markerLeft(metric: string, val: number): number {
    const r = ranges[metric];
    if (!r) return 50;
    const span = r.hi - r.lo;
    const ext = span * 0.2;
    const total = span + ext * 2;
    return Math.min(100, Math.max(0, ((val - (r.lo - ext)) / total) * 100));
  }

  function handle() { onopenDetail?.(); }
</script>

{#if signals?.length}
  {#each signals as s}
    {@const ok = inRange(s.metric, s.current)}
    <div class="row" role="button" tabindex="0"
         onclick={handle}
         onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(); } }}>
      <div class="name">
        <span class="label">{labels[s.metric] || s.metric}</span>
      </div>
      <div class="value">
        {Math.round(s.current)}<span class="unit">{s.unit}</span>
      </div>
      <div class="status status-{ok ? 'good' : 'bad'}">
        {arrow(s.trend)} 7d {Math.round(s.average7d)}
      </div>
      <div class="bar">
        <span class="track">
          <span class="band"></span>
          <span class="marker {ok ? '' : 'bad'}" style="left:{markerLeft(s.metric, s.current)}%;"></span>
        </span>
      </div>
      <span class="arrow">›</span>
    </div>
  {/each}
{/if}

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
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--surface-overlay); }
  .row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--surface-overlay); }
  .name { min-width: 0; }
  .label {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .value { font-family: var(--font-mono); font-size: 16px; color: var(--text-primary); text-align: right; line-height: 1; white-space: nowrap; }
  .unit { font-size: 10px; color: var(--text-ghost); margin-left: 2px; }
  .status { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status-good { color: var(--accent); }
  .status-bad { color: var(--status-error); }
  .track { display: block; position: relative; height: 2px; background: var(--card-border); }
  .band { position: absolute; left: 20%; right: 20%; top: 0; height: 2px; background: var(--accent-tint-35); }
  .marker { position: absolute; top: -2px; width: 1px; height: 6px; background: var(--text-primary); transform: translateX(-0.5px); }
  .marker.bad { background: var(--status-error); }
  .arrow { font-family: var(--font-mono); font-size: 14px; color: var(--text-ghost); line-height: 1; }
  .row:hover .arrow { color: var(--accent); }
  @media (max-width: 640px) {
    .row { grid-template-columns: minmax(0, 1fr) auto auto; row-gap: 4px; }
    .status { grid-column: 1 / 2; font-size: 9px; }
    .bar { grid-column: 1 / -1; }
    .arrow { grid-row: 1; }
  }
</style>
