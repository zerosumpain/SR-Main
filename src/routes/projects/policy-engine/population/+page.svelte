<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import PopulationPanel from '../components/PopulationPanel.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import { STORIES } from '../lib/stories';
  import { economicImpact, ECON, NEET_ECON, neetHeadcountAvoided } from '../lib/economics';
  import { regionEarnings } from '../lib/regions';
  import { COHORTS, KIND_META, ADMIN_COHORTS, TIDE_STATS, TIDE_LONDON, TIDE_DATA, COUNTING, POP_TAKEAWAY } from '../lib/populationIntel';

  const eli = $derived(app.narrative === 'eli5');

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
  <StorySection title="1 · One year-group, three gates">
  {#snippet prose()}
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
  {/snippet}
  {#snippet data()}
  <div class="panel">
    {#if app.mounted}
      <PopulationPanel sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} scenarioName={app.scenarioName}
        compare={app.compareB && app.viewSimB ? { sim: app.viewSimB, name: app.compareB.name } : null}
        scale={app.scale} regionName={app.region === 'all' ? '' : app.regionName} />
    {/if}
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.populationFunnel} /></div>
  </div>
  {/snippet}
  </StorySection>

  <StorySection title="2 · The economic return">
  {#snippet prose()}
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
  {/snippet}
  {#snippet data()}
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
  {/snippet}
  </StorySection>

  <!-- ===================== 3 · the cohort tradition ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The cohort tradition — following the children for real</h2>
    <p class="cap">
      {eli
        ? 'The funnel above follows a pretend year-group. Britain invented the real thing: for 80 years it has followed actual babies through life — and each study changed what governments did. Then it nearly lost the habit.'
        : 'The synthetic cohort above has a real ancestor: Britain’s birth-cohort tradition is the most powerful population-intelligence instrument any country has built — an unbroken 80-year chain in which each study bought specific policy. The ledger, including the failure.'}
    </p>
    <div class="co-cards">
      {#each COHORTS as c (c.name)}
        <article class="co" style="--kc:{KIND_META[c.kind].colour}">
          <header class="co-head">
            <div class="co-names"><span class="co-name">{c.name}</span><span class="co-meta">{c.born} · {c.size}</span></div>
            <span class="co-kind" style="background:{KIND_META[c.kind].colour}">{eli ? KIND_META[c.kind].eli5 : KIND_META[c.kind].label}</span>
          </header>
          <p class="co-what">{c.what}</p>
          <p class="co-bought"><span class="co-tag">{eli ? 'What it changed' : 'What it bought policy'}</span>{c.bought}</p>
          <a class="co-src" href={c.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
    <div class="admin-box">
      <span class="ab-lab">{eli ? 'The quiet revolution' : 'The admin estate became the bigger cohort machine'}</span>
      <p>{eli ? ADMIN_COHORTS.eli5 : ADMIN_COHORTS.research}</p>
    </div>
  </section>

  <!-- ===================== 4 · the demographic tide ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The demographic tide</h2>
    <p class="cap">
      {eli
        ? 'The biggest population story in education right now isn’t a gap or a score — it’s that there are simply fewer children. Every number on this page is about to shrink, and that forces choices.'
        : 'The population denominators this page rests on are falling fast — the live strategic issue every other field study sits inside. The numbers, the choice they force, and the data that should be steering it.'}
    </p>
    <div class="tide-stats">
      {#each TIDE_STATS as s (s.big)}
        <div class="ts"><span class="ts-big">{s.big}</span><span class="ts-lab">{eli ? s.eli5 : s.label}</span></div>
      {/each}
    </div>
    <p class="tide-note">{eli ? TIDE_LONDON.eli5 : TIDE_LONDON.research}</p>
    <div class="admin-box teal">
      <span class="ab-lab">{eli ? 'The early-warning opportunity' : 'The place-planning data gap'}</span>
      <p>{eli ? TIDE_DATA.eli5 : TIDE_DATA.research}</p>
    </div>
  </section>

  <!-- ===================== 5 · counting the next generation ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · Counting the next generation</h2>
    <p class="cap">
      {eli
        ? 'Even the basic job of counting people is being rethought — and the boldest idea abroad is to go further: use the records to work out, child by child, where early help pays off most.'
        : 'How the state counts children is itself in flux — and the frontier abroad is actuarial: pricing lifetime trajectories from linked records to target early intervention. The models, and the UK’s specific gap.'}
    </p>
    <div class="cm-cards">
      {#each COUNTING as m (m.name)}
        <article class="cm" style="--mc:{m.colour}">
          <header class="cm-head"><span class="cm-name">{m.name}</span><span class="cm-status">{m.status}</span></header>
          <p class="cm-what">{m.what}</p>
          <p class="cm-lesson"><span class="cm-tag">The lesson</span>{m.lesson}</p>
          <a class="cm-src" href={m.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
    <div class="takeaway-box">
      <span class="tb-lab">{eli ? 'The bottom line' : 'For the data strategist'}</span>
      <p>{eli ? POP_TAKEAWAY.eli5 : POP_TAKEAWAY.research}</p>
      <a class="tb-link" href="/projects/policy-engine/monitor">How the records would join up → the data spine</a>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/regions">Where & to whom → Regions</a>
</div>

<style>
  .panel { margin: 0 0 8px; }
  .mrow { margin: 8px 0 0; }
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: var(--fs-nav); line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 90ch; }

  /* 3 · cohort cards */
  .co-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 12px; margin-bottom: 14px; }
  .co { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--kc); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .co-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .co-names { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .co-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .co-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .co-kind { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em;
    color: #fff; padding: 3px 7px; border-radius: var(--radius-sharp); white-space: nowrap; }
  .co-what { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .co-bought { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--ink); }
  .co-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--kc); margin-bottom: 2px; }
  .co-src { margin-top: auto; align-self: flex-start; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .admin-box { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp);
    background: var(--accent-ink-tint-06); padding: 13px 16px; max-width: 96ch; }
  .admin-box.teal { border-color: var(--accent-ink-tint-35); border-left-color: var(--accent-ink); background: var(--accent-ink-tint-06); }
  .ab-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .admin-box.teal .ab-lab { color: var(--accent-ink); }
  .admin-box p { margin: 0; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* 4 · tide */
  .tide-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-bottom: 12px; }
  .ts { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid rgba(28,22,17,0.14);
    border-left: 3px solid #b4632e; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.42); }
  .ts-big { font-family: var(--fs-serif); font-weight: 600; font-size: 22px; line-height: 1; color: var(--ink); }
  .ts-lab { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.65); }
  .tide-note { margin: 0 0 12px; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 96ch; }

  /* 5 · counting models */
  .cm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 12px; margin-bottom: 14px; }
  .cm { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--mc); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .cm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .cm-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .cm-status { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--mc); }
  .cm-what { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .cm-lesson { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--ink); }
  .cm-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--mc); margin-bottom: 2px; }
  .cm-src { margin-top: auto; align-self: flex-start; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .takeaway-box { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp);
    background: var(--accent-ink-tint-06); padding: 13px 16px; max-width: 96ch; }
  .tb-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .takeaway-box p { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.78); }
  .tb-link { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .econ-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0; }
  .ec { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.4); border-left-width: 3px; border-left-color: rgba(28,22,17,0.3); }
  .ec.good { border-left-color: var(--success); } .ec.bad { border-left-color: var(--error); }
  .ec-num { font-family: var(--fs-serif); font-weight: 600; font-size: 26px; line-height: 1; color: var(--ink); }
  .ec.good .ec-num { color: var(--success); } .ec.bad .ec-num { color: var(--error); }
  .ec-lab { font-size: var(--fs-label-xs); line-height: 1.35; color: rgba(28,22,17,0.6); }
  .neet-ctx { margin: 2px 0 10px; padding: 9px 12px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.55;
    color: rgba(28,22,17,0.7); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-22); }
  .neet-ctx b { color: var(--ink); }
  .econ-caveat { margin: 6px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.62); }
  .econ-caveat b { color: var(--ink); } .econ-caveat a { color: var(--accent-ink); }
</style>
