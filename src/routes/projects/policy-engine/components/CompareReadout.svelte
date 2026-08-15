<script lang="ts">
  import type { YearResult } from '../lib/types';
  import { OUTCOMES_BY_ID, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { fmtNum } from '../lib/format';
  import { app } from '../lib/appState.svelte';
  const lbl = (id: string, label: string) => (app.narrative === 'eli5' ? OUTCOME_ELI5_LABEL[id] ?? label : label);

  interface Props { simA: YearResult[]; simB: YearResult[]; nameA: string; nameB: string; horizon: number; }
  let { simA, simB, nameA, nameB, horizon }: Props = $props();

  const IDS = ['gapKS4', 'attainment8', 'grade5EM', 'gld', 'persistentAbsenceDis', 'ehcpPct', 'highNeedsDeficitStock', 'neet', 'childPoverty', 'cumulativeCost'];
  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

  const rows = $derived(IDS.map((id) => {
    const m = OUTCOMES_BY_ID[id];
    const a = (row(simA, horizon) as any)[id] as number;
    const b = (row(simB, horizon) as any)[id] as number;
    const delta = a - b;
    const meaningful = Math.abs(delta) >= Math.pow(10, -m.dp) / 2;
    const aBetter = m.neutral ? null : (delta > 0) === m.goodIfUp;
    const unit = m.unit === '£bn' ? 'bn' : (m.unit === '%' || m.unit === '% of pupils') ? '%' : m.unit === 'months' ? 'mo' : '';
    return { m, a, b, delta, meaningful, aBetter, unit };
  }));
</script>

<div class="cmp">
  <div class="cmp-head">
    <span class="ch-title">Side-by-side comparison · {horizon}</span>
    <span class="ch-key"><i class="ka"></i>A: {nameA} &nbsp; <i class="kb"></i>B: {nameB}</span>
  </div>
  <div class="cmp-scroll">
    <table>
      <thead>
        <tr><th>Outcome</th><th class="num">A</th><th class="num">B</th><th class="num">Δ (A − B)</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.m.id)}
          <tr>
            <td>{lbl(r.m.id, r.m.label)}</td>
            <td class="num a">{fmtNum(r.a, r.m.dp)}<small>{r.unit}</small></td>
            <td class="num b">{fmtNum(r.b, r.m.dp)}<small>{r.unit}</small></td>
            <td class="num delta {r.m.neutral || !r.meaningful ? 'neutral' : r.aBetter ? 'good' : 'bad'}">
              {#if r.meaningful}{r.delta > 0 ? '+' : ''}{fmtNum(r.delta, r.m.dp)}{r.unit}{#if !r.m.neutral}<span class="verdict"> {r.aBetter ? '· A better' : '· B better'}</span>{/if}{:else}—{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .cmp { border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); background: var(--accent-ink-tint-06); padding: 9px 12px; }
  .cmp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .ch-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .ch-key { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); display: inline-flex; align-items: center; }
  .ch-key i { display: inline-block; width: 9px; height: 3px; border-radius: var(--radius-sharp); margin-right: 4px; }
  .ka { background: #9a3b2e; }
  .kb { background: var(--accent-ink); }
  .cmp-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 340px; font-size: var(--fs-label-xs); }
  @media (max-width: 560px) { .verdict { display: none; } }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 3px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.15); }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td { padding: 4px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.06); color: rgba(28,22,17,0.82); }
  td.num { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  td.a { color: #9a3b2e; }
  td.b { color: var(--accent-ink); }
  td small { font-size: var(--fs-label-xs); opacity: 0.6; margin-left: 1px; }
  td.delta { font-weight: 600; }
  td.delta.good { color: var(--success); }
  td.delta.bad { color: var(--error); }
  td.delta.neutral { color: rgba(28,22,17,0.5); font-weight: 500; }
</style>
