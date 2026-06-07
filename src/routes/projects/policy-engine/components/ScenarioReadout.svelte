<script lang="ts">
  import type { YearResult } from '../lib/types';
  import { OUTCOMES_BY_ID, OUTCOME_ELI5, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { fmtNum } from '../lib/format';
  import { app } from '../lib/appState.svelte';
  const meaning = (id: string) => (app.narrative === 'eli5' ? OUTCOME_ELI5[id] ?? '' : OUTCOMES_BY_ID[id]?.blurb ?? '');
  const lbl = (id: string, short: string) => (app.narrative === 'eli5' ? OUTCOME_ELI5_LABEL[id] ?? short : short);

  interface Props { sim: YearResult[]; baseSim: YearResult[]; horizon: number; scenarioName: string; }
  let { sim, baseSim, horizon, scenarioName }: Props = $props();

  // headline metrics shown in the always-on scenario readout
  const IDS = ['gapKS4', 'attainment8', 'grade5EM', 'highNeedsDeficitStock', 'neet', 'cumulativeCost'];
  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

  const cells = $derived(IDS.map((id) => {
    const m = OUTCOMES_BY_ID[id];
    const v = (row(sim, horizon) as any)[id] as number;
    const base = (row(baseSim, horizon) as any)[id] as number;
    const delta = v - base;
    const meaningful = Math.abs(delta) >= Math.pow(10, -m.dp) / 2;
    const good = m.neutral ? null : (delta > 0) === m.goodIfUp;
    return { m, v, delta, meaningful, good };
  }));
</script>

<div class="readout">
  <div class="ro-head">
    <span class="ro-scn">{scenarioName}</span>
    <span class="ro-yr">readout · {horizon}</span>
  </div>
  <div class="ro-cells">
    {#each cells as c (c.m.id)}
      <div class="ro-cell" title={meaning(c.m.id)}>
        <span class="ro-label">{lbl(c.m.id, c.m.short)}</span>
        <span class="ro-val">{fmtNum(c.v, c.m.dp)}<small>{c.m.unit === '£bn' ? 'bn' : c.m.unit === '%' || c.m.unit === '% of pupils' ? '%' : c.m.unit === 'months' ? 'mo' : ''}</small></span>
        {#if c.m.id === 'cumulativeCost'}
          <span class="ro-delta neutral">cumulative spend</span>
        {:else if c.meaningful}
          <span class="ro-delta {c.good ? 'good' : 'bad'}">{c.delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(c.delta), c.m.dp)} vs status quo</span>
        {:else}
          <span class="ro-delta neutral">= status quo</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .readout { border: 1px solid rgba(28,22,17,0.12); border-radius: 8px; background: rgba(255,255,255,0.34); padding: 8px 12px; }
  .ro-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
  .ro-scn { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink, #1c1611); }
  .ro-yr { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .ro-cells { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .ro-cell { display: flex; flex-direction: column; gap: 1px; padding: 2px 8px; border-left: 2px solid rgba(28,22,17,0.12); cursor: help; }
  .ro-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.55); }
  .ro-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; line-height: 1.05; color: var(--ink, #1c1611); }
  .ro-val small { font-size: 10px; font-weight: 500; color: rgba(28,22,17,0.5); margin-left: 1px; }
  .ro-delta { font-family: 'JetBrains Mono', monospace; font-size: 9px; }
  .ro-delta.good { color: #2f7d4f; }
  .ro-delta.bad { color: #b1455e; }
  .ro-delta.neutral { color: rgba(28,22,17,0.45); }
</style>
