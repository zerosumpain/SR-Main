<script lang="ts">
  import type { YearResult } from '../lib/types';
  import OutcomeChart, { type ChartSeries } from './OutcomeChart.svelte';
  import { fmtGBPbn, fmtGBP, fmtNum } from '../lib/format';

  interface Props { sim: YearResult[]; baseSim: YearResult[]; horizon: number; }
  let { sim, baseSim, horizon }: Props = $props();

  const KS4_COHORT = 600_000; // approx GCSE cohort/yr

  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];
  const yEnd = $derived(row(sim, horizon));
  const bEnd = $derived(row(baseSim, horizon));

  const years = $derived(sim.map((y) => y.year));
  const costSeries = $derived<ChartSeries[]>([
    { label: 'Annual additional cost', color: '#5a6b3a', values: sim.map((y) => y.annualCost), emphasis: true },
  ]);
  const cumSeries = $derived<ChartSeries[]>([
    { label: 'Cumulative cost', color: '#b4632e', values: sim.map((y) => y.cumulativeCost), emphasis: true },
  ]);

  const eff = $derived.by(() => {
    const cum = yEnd.cumulativeCost;
    const gapClosed = bEnd.gapKS4 - yEnd.gapKS4;                 // months
    const a8Gain = yEnd.attainment8 - bEnd.attainment8;
    // cumulative extra grade-5 pupils across every projected year (stock vs stock,
    // so the £-per-pupil ratio uses matching cumulative quantities)
    const horizonIdx = sim.findIndex((y) => y.year === horizon);
    let cumExtraG5 = 0;
    for (let i = 0; i <= (horizonIdx < 0 ? sim.length - 1 : horizonIdx); i++) {
      cumExtraG5 += Math.max(0, ((sim[i].grade5EM - baseSim[i].grade5EM) / 100) * KS4_COHORT);
    }
    const deficitAvoided = bEnd.highNeedsDeficitStock - yEnd.highNeedsDeficitStock;
    return {
      cum, gapClosed, a8Gain, cumExtraG5, deficitAvoided,
      perMonth: gapClosed > 0.05 ? cum / gapClosed : null,
      perA8: a8Gain > 0.05 ? cum / a8Gain : null,
      perG5: cumExtraG5 > 1000 ? (cum * 1e9) / cumExtraG5 : null,
    };
  });
</script>

<div class="cost">
  <div class="charts">
    <OutcomeChart title="Annual additional cost" unit="£bn / yr" {years} series={costSeries}
                  baseYear={sim[0].year} dp={1} zeroBased height={170} />
    <OutcomeChart title="Cumulative cost" unit="£bn since 2025" {years} series={cumSeries}
                  baseYear={sim[0].year} dp={1} zeroBased height={170} />
  </div>

  <div class="eff">
    <p class="eff-note">Cost-effectiveness of your package by {horizon}, vs the status-quo trajectory.
      These are illustrative ratios over the whole programme, not marginal costings.</p>
    <div class="eff-grid">
      <div class="eff-card">
        <span class="ev">{fmtGBPbn(eff.cum, 0)}</span>
        <span class="el">cumulative additional spend</span>
      </div>
      <div class="eff-card">
        <span class="ev">{eff.gapClosed > 0 ? fmtNum(eff.gapClosed, 1) : '—'}<small> mo</small></span>
        <span class="el">disadvantage gap closed (KS4)</span>
      </div>
      <div class="eff-card">
        <span class="ev">{eff.perMonth ? fmtGBPbn(eff.perMonth, 1) : '—'}</span>
        <span class="el">per month of gap closed</span>
      </div>
      <div class="eff-card">
        <span class="ev">{eff.perA8 ? fmtGBPbn(eff.perA8, 1) : '—'}</span>
        <span class="el">per +1 Attainment-8 point</span>
      </div>
      <div class="eff-card">
        <span class="ev">{eff.perG5 ? fmtGBP(Math.round(eff.perG5 / 1000) * 1000) : '—'}</span>
        <span class="el">per extra grade-5 E&amp;M pupil (cumulative)</span>
      </div>
      <div class="eff-card">
        <span class="ev">{eff.deficitAvoided > 0 ? fmtGBPbn(eff.deficitAvoided, 1) : '—'}</span>
        <span class="el">SEND deficit avoided</span>
      </div>
    </div>
  </div>
</div>

<style>
  .cost { display: flex; flex-direction: column; gap: 12px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 640px) { .charts { grid-template-columns: 1fr; } }
  .eff-note { margin: 0 0 8px; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.65); }
  .eff-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .eff-card {
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-radius: 7px;
    padding: 9px 10px; display: flex; flex-direction: column; gap: 3px;
  }
  .ev { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; color: var(--ink, #1c1611); line-height: 1; }
  .ev small { font-size: 11px; font-weight: 500; color: rgba(28,22,17,0.5); }
  .el { font-size: 10.5px; line-height: 1.3; color: rgba(28,22,17,0.6); }
</style>
