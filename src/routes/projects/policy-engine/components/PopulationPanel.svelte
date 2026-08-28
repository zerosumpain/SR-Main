<script lang="ts">
  // PopulationPanel — the "Population" tab. Turns the engine's period rates into the human
  // scale of a policy package vs the status-quo baseline: a synthetic-cohort funnel, headline
  // people-numbers, an impact ledger (point-in-time ⇄ cumulative, with stocks barred from
  // summation), child-years averted, and population stocks over time (reused OutcomeChart).

  import type { YearResult } from '$lib/policy-engine/types';
  import OutcomeChart, { type ChartSeries } from './OutcomeChart.svelte';
  import CohortFunnel from './CohortFunnel.svelte';
  import {
    cohortPipeline, cohortHeadline, peopleLedger, personYears, populationStocks,
    COHORT_N, DIS_COHORT_N, type PeopleRow,
  } from '../lib/population';
  import { BASE_YEAR, POP } from '$lib/policy-engine/params';
  import { fmtCompact, fmtNum } from '$lib/policy-engine/format';

  interface Props {
    sim: YearResult[];
    baseSim: YearResult[];
    horizon: number;
    scenarioName: string;
    /** When comparing, the funnel & ledger respond to Scenario B instead of the status-quo baseline. */
    compare?: { sim: YearResult[]; name: string } | null;
    /** Region pupil-share that scales every population denominator (1 = England). */
    scale?: number;
    /** Region name when a geographic filter is active (''=England). */
    regionName?: string;
  }
  let { sim, baseSim, horizon, scenarioName, compare = null, scale = 1, regionName = '' }: Props = $props();
  const isRegional = $derived(regionName !== '' && scale !== 1);

  // The comparator: Scenario B when a comparison is pinned, otherwise the do-nothing baseline.
  const cmpSim = $derived(compare ? compare.sim : baseSim);
  const cmpName = $derived(compare ? compare.name : 'status quo');
  const isCompare = $derived(!!compare);

  const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

  const pipeline = $derived(cohortPipeline(row(sim, horizon), row(cmpSim, horizon), scale));
  const headline = $derived(cohortHeadline(row(sim, horizon), row(cmpSim, horizon), scale));
  const ledger = $derived(peopleLedger(sim, cmpSim, horizon, scale));
  const py = $derived(personYears(sim, cmpSim, horizon, scale));
  const stocks = $derived(populationStocks(sim, cmpSim, scale));

  let ledgerMode = $state<'now' | 'cumulative'>('now');

  // --- formatting ---
  const human = (n: number) => fmtCompact(Math.abs(n));
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtCompact(Math.abs(n))}`;
  function rowVerb(r: PeopleRow): string {
    // direction word for the people sentence (good-signed)
    if (r.neutral) return r.rawDelta > 0 ? 'more' : r.rawDelta < 0 ? 'fewer' : 'as many';
    if (r.goodDelta === 0) return 'no change in';
    const fewerIsGood = r.label.match(/poverty|absent|NEET/i);
    if (fewerIsGood) return r.rawDelta < 0 ? 'fewer' : 'more';
    return r.rawDelta > 0 ? 'more' : 'fewer';
  }
  const sparkW = 46;
  function sparkBars(r: PeopleRow): { you: number; base: number } {
    const mx = Math.max(r.count, r.base, 1);
    return { you: (r.count / mx) * sparkW, base: (r.base / mx) * sparkW };
  }

  const cohortN = $derived(Math.round(COHORT_N * scale));
  const disCohortN = $derived(Math.round(DIS_COHORT_N * scale));

  // big-number meaning chips
  const chips = $derived([
    { v: headline.deltaGcseDis, label: 'more disadvantaged pupils leave with a strong GCSE pass', sub: `this ${horizon} cohort of ${fmtCompact(disCohortN)} disadvantaged`, good: headline.deltaGcseDis >= 0 },
    { v: headline.deltaReady, label: 'more children start school ready to learn at age 5', sub: `of a ${fmtCompact(cohortN)} cohort`, good: headline.deltaReady >= 0 },
    { v: headline.deltaGcse, label: 'more strong GCSE passes overall', sub: `≈ ${fmtNum(Math.abs(headline.classrooms))} classrooms of 30`, good: headline.deltaGcse >= 0 },
  ]);

  // --- stocks-over-time charts (reused OutcomeChart) ---
  const years = $derived(sim.map((y) => y.year));
  const C_YOU = '#9a3b2e', C_BASE = 'rgba(28,22,17,0.34)', C_B = '#3a5fa8';
  function stockSeries(scn: number[], base: number[]): ChartSeries[] {
    return [
      { label: isCompare ? 'Scenario A' : 'Your scenario', color: C_YOU, values: scn, emphasis: true },
      { label: isCompare ? 'Scenario B' : 'Status quo', color: isCompare ? C_B : C_BASE, values: base, dashed: true },
    ];
  }

  const pyTotalNote = 'Period-stock person-years (the area between the status-quo and scenario headcounts) — NOT distinct individuals; the same child can be counted in several years.';
</script>

<div class="pop">
  <div class="banner" class:cmp={isCompare} class:rgn={isRegional}>
    <span class="b-tag">{isRegional ? 'POPULATION · ' + regionName.toUpperCase() : isCompare ? 'POPULATION · A vs B' : 'POPULATION SIMULATION'}</span>
    <span class="b-text">
      {#if isCompare}
        The human scale of <b>{scenarioName}</b> (A) vs <b>{cmpName}</b> (B){#if isRegional} in <b>{regionName}</b>{/if}, at the <b>{horizon}</b> horizon — every
        number here compares the two pinned scenarios. Numbers are <b>headcounts of real children &amp; young people</b>.
      {:else}
        The human scale of <b>{scenarioName}</b> vs the status-quo (do-nothing) path{#if isRegional} in <b>{regionName}</b>{/if}, at the <b>{horizon}</b> horizon.
        Numbers are <b>headcounts of real children &amp; young people</b>.
      {/if}
      {#if isRegional}<b>{regionName}</b>’s regional rates are multiplied by its share (~{(scale * 100).toFixed(0)}%) of each England population base — an approximation that aggregates back to the national figures.{:else}Every rate is multiplied by its own England population base.{/if}
    </span>
  </div>

  <!-- headline people-numbers -->
  <div class="chips">
    {#each chips as c}
      <div class="chip {c.good ? 'good' : 'bad'}">
        <span class="c-num">{signed(c.v)}</span>
        <span class="c-lab">{c.label}</span>
        <span class="c-sub">{c.sub}</span>
      </div>
    {/each}
  </div>

  <!-- the centerpiece funnel -->
  <CohortFunnel {pipeline} {horizon} comparatorName={cmpName} {scale} {regionName} />

  <!-- impact ledger -->
  <section class="block">
    <div class="block-head">
      <h3>Impact ledger — people, not percentages</h3>
      <div class="seg" role="group" aria-label="Ledger reading">
        <button class:active={ledgerMode === 'now'} onclick={() => (ledgerMode = 'now')}>Right now ({horizon})</button>
        <button class:active={ledgerMode === 'cumulative'} onclick={() => (ledgerMode = 'cumulative')} title="Cumulative across every cohort 2026→horizon — only valid for cohort flows, not stocks">Cumulative (cohorts)</button>
      </div>
    </div>
    <div class="ledger">
      {#each ledger as r (r.key)}
        {@const sp = sparkBars(r)}
        <div class="lrow {r.neutral ? 'neutral' : r.goodDelta > 0 ? 'good' : r.goodDelta < 0 ? 'bad' : 'flat'}">
          <div class="l-main">
            <span class="l-count">{human(r.count)}</span>
            <span class="l-label">{r.label} <em>· {r.scope}</em></span>
          </div>
          <svg class="spark" width={sparkW} height="16" aria-hidden="true">
            <rect x="0" y="2" width={sp.base} height="5" rx="1" fill="rgba(28,22,17,0.3)" />
            <rect x="0" y="9" width={sp.you} height="5" rx="1" fill={r.neutral ? '#566a8c' : r.goodDelta >= 0 ? '#2f7d4f' : '#b1455e'} />
          </svg>
          <div class="l-delta">
            {#if ledgerMode === 'now'}
              {#if r.neutral}
                <span class="d neutral">{signed(r.rawDelta)} plans <small>vs {cmpName} · neutral</small></span>
              {:else if Math.abs(r.rawDelta) < 1}
                <span class="d flat">= {cmpName}</span>
              {:else}
                <span class="d {r.goodDelta > 0 ? 'good' : 'bad'}">{human(Math.abs(r.rawDelta))} {rowVerb(r)} <small>vs {cmpName}</small></span>
              {/if}
            {:else if r.isStock}
              <span class="d barred" title="A stock is a point-in-time count — the same children recur each year, so summing across years would double-count them. See child-years averted below.">— stock · can’t sum</span>
            {:else}
              <span class="d {(r.cumulative ?? 0) >= 0 ? 'good' : 'bad'}">{signed(r.cumulative ?? 0)} <small>across 2026–{horizon} cohorts</small></span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- child-years averted -->
  <section class="block">
    <div class="block-head"><h3>Child-years averted, 2025–{horizon}</h3></div>
    <div class="py-grid">
      {#each py as p (p.key)}
        <div class="py {p.childYears >= 0 ? 'good' : 'bad'}">
          <span class="py-num">{signed(p.childYears)}</span>
          <span class="py-unit">{p.unitNoun}</span>
          <span class="py-lab">of {p.label} {p.childYears >= 0 ? 'averted' : 'added'} vs {cmpName}</span>
        </div>
      {/each}
    </div>
    <p class="py-note">{pyTotalNote} Reported per stock — the overlapping stocks (poverty, absence, NEET, EHCP) are never added into a single “children affected” total.</p>
  </section>

  <!-- population stocks over time -->
  <section class="block">
    <div class="block-head"><h3>Population stocks over time</h3></div>
    <div class="stock-grid">
      {#each stocks as s (s.key)}
        <div class="stock-cell">
          <OutcomeChart title={s.title} unit="millions" years={years} series={stockSeries(s.scn, s.base)}
                        baseYear={BASE_YEAR} horizonYear={horizon} dp={2} zeroBased height={188} />
          <p class="stock-note">{s.denomNote}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- calibration & honesty footer -->
  <details class="calib">
    <summary>How we count — denominators, sources &amp; the counting rules</summary>
    <div class="calib-body">
      <table>
        <thead><tr><th>Quantity</th><th class="num">2025 base</th><th>Denominator &amp; source</th></tr></thead>
        <tbody>
          <tr><td>Children with an EHC plan</td><td class="num">639k</td><td>engine headcount (5.3% × 12.05m 0–25 ref pop) — DfE EES; used verbatim</td></tr>
          <tr><td>Young people NEET</td><td class="num">871k</td><td>13.3% × {POP.youth16to24}m aged 16–24 — ONS MYE; DfE/ONS NEET</td></tr>
          <tr><td>Children in relative poverty</td><td class="num">4.2m</td><td>31% × {POP.childPop0to17}m aged 0–17 (AHC) — ONS MYE; DWP HBAI</td></tr>
          <tr><td>Disadvantaged pupils persistently absent</td><td class="num">678k</td><td>29.9% × ({POP.pupils}m × {POP.disadvShare} = {(POP.pupils * POP.disadvShare).toFixed(2)}m) — DfE EES/SWC</td></tr>
          <tr><td>One school cohort</td><td class="num">{fmtCompact(COHORT_N)}</td><td>a single year-group — ONS births; DfE SWC ({fmtCompact(DIS_COHORT_N)} disadvantaged at {POP.disadvShare})</td></tr>
        </tbody>
      </table>
      <ul class="rules">
        <li><b>Synthetic period cohort.</b> The funnel applies one year’s age-5/11/16 rates to a notional year-group — not a longitudinally tracked birth cohort.</li>
        <li><b>Stocks aren’t flows.</b> Poverty, NEET, absence and EHCP are point-in-time stocks; they’re never summed across years (that double-counts the same child) — child-years averted are shown separately and per-stock.</li>
        <li><b>EHCP is neutral.</b> More plans means more support and more cost — shown as a headcount “with a plan”, never as children “helped” or “lifted”, and excluded from every total.</li>
        <li><b>Direction = better.</b> Colour follows whether a change is good for children (fewer NEET, fewer in poverty = good), not which run is which.</li>
      </ul>
    </div>
  </details>
</div>

<style>
  .pop { display: flex; flex-direction: column; gap: 14px; }
  .banner { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; padding: 8px 12px; border-radius: var(--radius-sharp);
    background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-22); }
  .banner.cmp { background: var(--accent-ink-tint-12); border-color: var(--accent-ink-tint-35); }
  .banner.cmp .b-tag { color: var(--accent-ink); }
  .banner.rgn { background: var(--accent-ink-tint-12); border-color: var(--accent-ink-tint-35); }
  .banner.rgn .b-tag { color: var(--accent-ink); }
  .b-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.12em; color: var(--accent-ink); }
  .b-text { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.72); flex: 1; min-width: 240px; }
  .b-text b { color: var(--ink); }

  .chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  .chip { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.45); border: 1px solid rgba(28,22,17,0.12); border-left-width: 3px; }
  .chip.good { border-left-color: var(--success); }
  .chip.bad { border-left-color: var(--error); }
  .c-num { font-family: var(--fs-serif); font-weight: 600; font-size: 30px; line-height: 1; color: var(--ink); }
  .chip.good .c-num { color: var(--success); }
  .chip.bad .c-num { color: var(--error); }
  .c-lab { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.82); margin-top: 3px; }
  .c-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }

  .block { display: flex; flex-direction: column; gap: 8px; }
  .block-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  h3 { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); margin: 0; color: var(--ink); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 4px 9px; border-radius: var(--radius-sharp);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .seg button.active { background: var(--ink); color: var(--paper); }

  .ledger { display: flex; flex-direction: column; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); overflow: hidden; }
  .lrow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; padding: 8px 12px;
    border-left: 3px solid transparent; border-bottom: 1px solid rgba(28,22,17,0.06); background: rgba(255,255,255,0.3); }
  .lrow:last-child { border-bottom: none; }
  .lrow.good { border-left-color: var(--success); }
  .lrow.bad { border-left-color: var(--error); }
  .lrow.neutral { border-left-color: var(--accent-ink); }
  .lrow.flat { border-left-color: rgba(28,22,17,0.2); }
  .l-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .l-count { font-family: var(--fs-serif); font-weight: 600; font-size: 18px; color: var(--ink); white-space: nowrap; }
  .l-label { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.78); }
  .l-label em { font-style: normal; color: rgba(28,22,17,0.45); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .spark { flex-shrink: 0; }
  .l-delta { text-align: right; min-width: 96px; }
  .d { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; white-space: nowrap; }
  .d small { font-weight: 400; color: rgba(28,22,17,0.45); }
  .d.good { color: var(--success); }
  .d.bad { color: var(--error); }
  .d.neutral { color: var(--accent-ink); }
  .d.flat, .d.barred { color: rgba(28,22,17,0.45); font-weight: 400; }

  .py-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  .py { display: flex; flex-direction: column; gap: 1px; padding: 10px 12px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-left-width: 3px; }
  .py.good { border-left-color: var(--success); }
  .py.bad { border-left-color: var(--error); }
  .py-num { font-family: var(--fs-serif); font-weight: 600; font-size: 24px; line-height: 1; color: var(--ink); }
  .py.good .py-num { color: var(--success); }
  .py.bad .py-num { color: var(--error); }
  .py-unit { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .py-lab { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.7); margin-top: 2px; }
  .py-note { margin: 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.55); }

  .stock-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; }
  .stock-cell { display: flex; flex-direction: column; }
  .stock-note { margin: 4px 2px 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }

  .calib { font-size: var(--fs-label-xs); border-top: 1px solid rgba(28,22,17,0.1); padding-top: 6px; }
  .calib summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.6); padding: 4px 0; }
  .calib summary:hover { color: var(--ink); }
  .calib-body { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: var(--fs-label-xs); }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 3px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.15); }
  th.num, td.num { text-align: right; white-space: nowrap; font-family: var(--font-mono); }
  td { padding: 4px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.06); color: rgba(28,22,17,0.78); line-height: 1.35; }
  .rules { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }
  .rules li { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.65); }
  .rules b { color: var(--ink); }
</style>
