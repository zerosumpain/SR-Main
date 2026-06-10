<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import PopulationPanel from '../components/PopulationPanel.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import { STORIES } from '../lib/stories';
  import { economicImpact, ECON, NEET_ECON, neetHeadcountAvoided } from '../lib/economics';
  import { regionEarnings } from '../lib/regions';

  const wageFactor = $derived(regionEarnings(app.region));
  const econ = $derived(economicImpact(app.viewSim, app.viewBase, app.horizon, app.scale, wageFactor));
  const neetPpAvoided = $derived.by(() => {
    const y = app.viewSim.find((r) => r.year === app.horizon);
    const b = app.viewBase.find((r) => r.year === app.horizon);
    return y && b ? Math.max(0, b.neet - y.neet) : 0;
  });
  const neetHeads = $derived(neetHeadcountAvoided(neetPpAvoided, app.scale));
  const fbn = (v: number) => `${v < 0 ? '−' : ''}£${(Math.abs(v) / 1e9).toFixed(1)}bn`;
  const fk = (v: number) => `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v) / 1000)}k`;
</script>

<svelte:head><title>Population — Education Policy Modelling</title></svelte:head>

<div class="pe-route">
  <StoryMasthead story={STORIES.population} />
  <div class="pe-prose">
    {#if app.narrative === 'eli5'}
      <p>
        Percentages are hard to feel. This page turns them into <b>real numbers of children</b>. So instead of “the gap closed by a
        few tenths of a month”, you see “eighteen thousand more poorer kids leave school with a strong pass”.
      </p>
      <p>
        We do it by multiplying each percentage by how many children it applies to, and comparing your plan with doing nothing. The
        funnel below follows one year-group of children through three checkpoints — ready for school at five, on track at eleven, and a
        strong GCSE pass at sixteen — and the list shows how many are helped. Pick a region up top and the numbers shrink to just that area.
      </p>
    {:else}
      <p>
        The model speaks in rates — a gap of so many months, a percentage reaching a standard. This page translates those rates into
        <b>headcounts of actual children and young people</b>, because a tenth of a percentage point on Attainment 8 is abstract, but
        “eighteen thousand more disadvantaged pupils leave school with a strong pass” is not.
      </p>
      <p>
        Every rate is multiplied by its <b>own</b> England population base — the disadvantage gap over a year-group of school leavers,
        child poverty over the 0–17 population, NEET over the 16–24 population — and the difference your package makes is measured
        against the status-quo (do-nothing) path. The synthetic-cohort funnel below tracks one notional year-group through the gates of
        school-readiness, secondary-readiness and a strong GCSE pass; the ledger and the “child-years averted” count the human scale of
        the change. If a region is selected in the bar above, the whole page rescales to that region’s share of each population.
      </p>
    {/if}
  </div>

  <div class="panel">
    {#if app.mounted}
      <PopulationPanel sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} scenarioName={app.scenarioName}
        compare={app.compareB && app.viewSimB ? { sim: app.viewSimB, name: app.compareB.name } : null}
        scale={app.scale} regionName={app.region === 'all' ? '' : app.regionName} />
    {/if}
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.populationFunnel} /></div>
  </div>

  <section class="econ">
    <h2 class="pe-h2">The economic return</h2>
    <div class="pe-prose">
      {#if app.narrative === 'eli5'}
        <p>
          Better results don’t just help children at school — they earn more as adults. Using the government’s own data linking
          school grades to later pay (called <b>LEO</b>), we can put a rough pound figure on your plan.
        </p>
      {:else}
        <p>
          Beyond the gates of school, attainment shows up as adult earnings. The DfE’s <b>Longitudinal Educational Outcomes (LEO)</b>
          data links school records to HMRC pay, letting us monetise the modelled Attainment-8 gain across the {econ.cohorts} leaving
          cohorts {app.region === 'all' ? '' : `in ${app.regionName} `}between 2026 and {app.horizon}, in present-value terms.
        </p>
      {/if}
    </div>
    <div class="econ-grid">
      <div class="ec {econ.lifetimePV >= 0 ? 'good' : 'bad'}"><span class="ec-num">{fbn(econ.lifetimePV)}</span><span class="ec-lab">extra lifetime earnings (PV) vs doing nothing</span></div>
      <div class="ec {econ.exchequerPV >= 0 ? 'good' : 'bad'}"><span class="ec-num">{fbn(econ.exchequerPV)}</span><span class="ec-lab">of it back to the exchequer (tax &amp; NICs)</span></div>
      <div class="ec"><span class="ec-num">{fk(econ.perPupilPV)}</span><span class="ec-lab">per pupil, on average</span></div>
      <div class="ec {econ.disLifetimePV >= 0 ? 'good' : 'bad'}"><span class="ec-num">{fbn(econ.disLifetimePV)}</span><span class="ec-lab">accruing to disadvantaged pupils</span></div>
    </div>
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.leoEconomics} /></div>
    {#if neetHeads > 1000}
      <p class="neet-ctx">
        {#if app.narrative === 'eli5'}
          Separately: by {app.horizon} your plan has about <b>{Math.round(neetHeads / 1000)}k fewer young people</b> with no job,
          education or training. Each one avoided is worth roughly <b>£104k–£300k</b> over a lifetime — but we don't add that to the
          totals above, because part of it is already counted through better grades.
        {:else}
          Context, <b>not added to the totals above</b>: at {app.horizon} the modelled NEET rate is {neetPpAvoided.toFixed(1)}pp lower
          than the status quo ≈ <b>{Math.round(neetHeads / 1000)}k fewer 16–24-year-olds NEET</b>. Published lifetime costs run
          <b>£{Math.round(NEET_ECON.perPersonLifetimeLow / 1000)}k–£{Math.round(NEET_ECON.perPersonLifetimeHigh / 1000)}k per person</b>
          ({NEET_ECON.source}) — the upper figure is Milburn's earnings-scarring bound. Adding this to the LEO PV would double-count
          the attainment-driven share of the NEET reduction, so it stays a context line.
        {/if}
      </p>
    {/if}
    <p class="econ-caveat">
      ⚠ <b>Treat as illustrative, not causal.</b> These figures multiply the modelled Attainment-8 change by a per-point earnings
      value (~£{ECON.pvPerA8Point.toLocaleString()} PV/point, from the DfE’s ~£100k-per-standard-deviation estimate). The earnings–
      attainment link is <b>associational</b> — it partly reflects that higher-attaining people would earn more anyway (selection bias) —
      and the constant comes from 2000s GCSE cohorts. To avoid double-counting we monetise <b>only</b> attainment, not a separate
      NEET wage-scar (13–21%) or the ~£150 PV per absence day, which the model already feeds through attainment.
      {#if app.region !== 'all'}In this regional view the per-point value is scaled by <b>{app.regionName}</b>’s relative earnings
      (×{wageFactor.toFixed(2)}, ONS ASHE-derived) — a crude adjustment that ignores migration between regions.{/if} Sources:
      DfE “GCSE Attainment and Lifetime Earnings”, DfE/LEO, IFS; see the <a href="/projects/policy-engine/method">Method</a> page.
    </p>
  </section>

  <a class="pe-next" href="/projects/policy-engine/regions">Where & to whom → Regions</a>
</div>

<style>
  .panel { margin: 18px 0 22px; }
  .econ { margin: 8px 0 24px; }
  .mrow { margin: 8px 0 0; }
  .econ-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
  .ec { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid rgba(28,22,17,0.14); border-radius: 9px;
    background: rgba(255,255,255,0.4); border-left-width: 3px; border-left-color: rgba(28,22,17,0.3); }
  .ec.good { border-left-color: #2f7d4f; } .ec.bad { border-left-color: #b1455e; }
  .ec-num { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; line-height: 1; color: var(--ink, #1c1611); }
  .ec.good .ec-num { color: #2f7d4f; } .ec.bad .ec-num { color: #b1455e; }
  .ec-lab { font-size: 11px; line-height: 1.35; color: rgba(28,22,17,0.6); }
  .neet-ctx { margin: 2px 0 10px; padding: 9px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.7); background: rgba(86,106,140,0.07); border: 1px solid rgba(86,106,140,0.25); }
  .neet-ctx b { color: var(--ink, #1c1611); }
  .econ-caveat { margin: 6px 0 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.62); }
  .econ-caveat b { color: var(--ink, #1c1611); } .econ-caveat a { color: #2f6f97; }
</style>
