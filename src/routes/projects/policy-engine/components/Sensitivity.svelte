<script lang="ts">
  import type { LeverState } from '../lib/types';
  import { runSensitivity, type McKey, MC_KEYS } from '../lib/montecarlo';
  import { OUTCOMES_BY_ID } from '../lib/outcomes';
  import { LEVERS_BY_ID, GROUP_META } from '../lib/levers';
  import { fmtNum } from '../lib/format';

  interface Props { levers: LeverState; horizon: number; }
  let { levers, horizon }: Props = $props();

  let kpi = $state<McKey>('gapKS4');
  const kpiOptions = MC_KEYS.filter((k) => OUTCOMES_BY_ID[k]);

  const bars = $derived(runSensitivity(levers, kpi, horizon));
  const meta = $derived(OUTCOMES_BY_ID[kpi]);

  const domain = $derived.by(() => {
    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { lo = Math.min(lo, b.low, b.high, b.baseline); hi = Math.max(hi, b.low, b.high, b.baseline); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 0.5;
    return { lo: lo - pad, hi: hi + pad };
  });
  function x(v: number): number {
    const { lo, hi } = domain;
    return ((v - lo) / (hi - lo)) * 100;
  }
  // "good" end of each bar (which direction improves the KPI)
  function goodAtHigh(): boolean { return meta.goodIfUp; }
</script>

<div class="sens">
  <div class="sens-head">
    <p class="sens-note">
      Tornado: how far each lever can move <b>{meta.label}</b> in {horizon}, swung individually from
      its minimum to its maximum (all other levers held at your current settings). The widest bars are
      your highest-leverage policies.
    </p>
    <label class="kpi-pick">
      KPI
      <select bind:value={kpi}>
        {#each kpiOptions as k}<option value={k}>{OUTCOMES_BY_ID[k].short}</option>{/each}
      </select>
    </label>
  </div>

  <div class="bars">
    {#each bars as b (b.leverId)}
      {@const gc = GROUP_META[LEVERS_BY_ID[b.leverId].group].colour}
      {@const a = x(Math.min(b.low, b.high))}
      {@const w = Math.abs(x(b.high) - x(b.low))}
      <div class="bar-row">
        <span class="bl">{LEVERS_BY_ID[b.leverId].label}</span>
        <div class="track">
          <span class="baseline-tick" style="left:{x(b.baseline)}%"></span>
          <span class="bar" style="left:{a}%; width:{Math.max(0.8, w)}%; background:{gc}"></span>
          <span class="end-lo" style="left:{x(b.low)}%">{fmtNum(b.low, meta.dp)}</span>
          <span class="end-hi" style="left:{x(b.high)}%">{fmtNum(b.high, meta.dp)}</span>
        </div>
        <span class="bs">{fmtNum(b.swing, meta.dp)}</span>
      </div>
    {/each}
  </div>
  <p class="legend">
    <span class="tick-key"></span> your current value &nbsp;·&nbsp; bar endpoints = lever at min / max &nbsp;·&nbsp;
    right column = swing ({meta.unit})
  </p>
</div>

<style>
  .sens { display: flex; flex-direction: column; gap: 8px; }
  .sens-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .sens-note { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.65); max-width: 60ch; }
  .kpi-pick { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.6); display: flex; align-items: center; gap: 5px; }
  .kpi-pick select {
    font-family: inherit; font-size: 11px; padding: 4px 6px; border-radius: 4px;
    border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); color: var(--ink, #1c1611);
  }
  .bars { display: flex; flex-direction: column; gap: 5px; }
  .bar-row { display: grid; grid-template-columns: 150px 1fr 44px; gap: 8px; align-items: center; }
  .bl { font-size: 11px; color: rgba(28,22,17,0.78); text-align: right; line-height: 1.2; }
  .track { position: relative; height: 20px; background: rgba(28,22,17,0.05); border-radius: 4px; }
  .bar { position: absolute; top: 4px; height: 12px; border-radius: 3px; opacity: 0.82; }
  .baseline-tick { position: absolute; top: 0; height: 20px; width: 1.5px; background: rgba(28,22,17,0.55); transform: translateX(-50%); z-index: 2; }
  .end-lo, .end-hi {
    position: absolute; top: 50%; transform: translate(-50%, -50%); font-family: 'JetBrains Mono', monospace;
    font-size: 8px; color: rgba(28,22,17,0.55); pointer-events: none;
  }
  .bs { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: var(--ink, #1c1611); text-align: right; }
  .legend { margin: 4px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .tick-key { display: inline-block; width: 1.5px; height: 11px; background: rgba(28,22,17,0.55); vertical-align: middle; }
</style>
