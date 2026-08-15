<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import OutcomeChart from '../components/OutcomeChart.svelte';
  import EthicsGuardrails from '../components/EthicsGuardrails.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import TriageSimulator from '../components/TriageSimulator.svelte';
  import UpliftSimulator from '../components/UpliftSimulator.svelte';
  import TransitionCurve from '../components/TransitionCurve.svelte';
  import NowcastMock from '../components/NowcastMock.svelte';
  import DataEstateMap from '../components/DataEstateMap.svelte';
  import StakeholderMap from '../components/StakeholderMap.svelte';
  import { selectEstateNode } from '../lib/estateSel.svelte';
  import { ESTATE_BY_ID } from '../lib/dataestate';
  import { STORIES } from '../lib/stories';
  import { goto } from '$app/navigation';
  import { PRESETS } from '../lib/scenarios';
  import { DIRECTIONS, DIR_STATUS_META } from '../lib/directions';
  import {
    NEET_NOW, LA_SPREAD, LA_NOTE, LEO_NOTE, JOIN_SPOKES,
    NL_ESL, EUROSTAT_NEET, ESTONIA_FUNNEL, ABC, RONI_INPUTS,
    NEET_INTL, NEET_TIER_META, NEET_KEY_STATS,
    AI_INTRO, AI_ROLES, AI_STATS, AI_CAUTIONS,
    CCIS_INTRO, CCIS_NAMING, CCIS_ROLE, CCIS_LIMITS, CCIS_OVERHAUL, CCIS_AIVALUE, CCIS_STATS,
    TOOLING_LADDER, FAILURE_GALLERY, OPPORTUNITY_LADDER, GOVERNANCE_CHECKLIST,
    MILBURN_FAILURES, MILBURN_STATS,
  } from '../lib/neet';

  const eli = $derived(app.narrative === 'eli5');

  const milburnDirections = DIRECTIONS.filter((d) => d.kind === 'diagnosis-direction');
  function loadMilburnPackage() {
    const preset = PRESETS.find((p) => p.name === 'Milburn-aligned response');
    if (preset) app.applyPreset(preset);
    goto('/projects/policy-engine/outcomes');
  }

  const fmtK = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m` : `${Math.round(n / 1000)}k`;

  // ---- live model hook: the engine projects NEET in three segments ----
  const neetSeries = $derived([
    { label: app.scenarioDisplayName, color: '#566a8c', values: app.viewSim.map((y) => y.neet), emphasis: true },
    { label: eli ? 'Looking for work' : 'Unemployed', color: '#2f6f97', values: app.viewSim.map((y) => y.neetUnemployed) },
    { label: eli ? 'Too unwell' : 'Inactive (health)', color: '#7a5aa6', values: app.viewSim.map((y) => y.neetInactiveHealth) },
    { label: eli ? 'Other reasons' : 'Inactive (other)', color: '#9a7b1f', values: app.viewSim.map((y) => y.neetInactiveOther) },
    { label: eli ? 'Stuck 12+ months' : 'Long-term (12+ mo)', color: '#8a2d3a', values: app.viewSim.map((y) => y.neetLongTerm), dashed: true },
    { label: eli ? 'Do nothing new' : 'Status quo', color: 'rgba(28,22,17,0.42)', values: app.viewBase.map((y) => y.neet), dashed: true },
  ]);
  const neetAtH = $derived(app.viewSim.find((y) => y.year === app.horizon)?.neet ?? 0);
  const baseAtH = $derived(app.viewBase.find((y) => y.year === app.horizon)?.neet ?? 0);
  const neetDelta = $derived(neetAtH - baseAtH);

  // ---- composition bar geometry (ONS, current) ----
  const CW0 = 60, CW1 = 720, cMax = 1_300_000;
  const cx = (v: number) => CW0 + (v / cMax) * (CW1 - CW0);
  const segs = [
    { from: 0, to: NEET_NOW.unemployed, disp: NEET_NOW.unemployed, label: 'Unemployed (looking)', colour: '#7d8db0' },
    { from: NEET_NOW.unemployed, to: NEET_NOW.total, disp: NEET_NOW.inactive, label: 'Economically inactive (not looking)', colour: '#566a8c' },
  ];
  const cTicks = [0, 500_000, 1_000_000, 1_250_000];

  // ---- LA "not known" bars ----
  const LX0 = 150, LX1 = 700, lMax = 22, lRowH = 40, lTop = 16;
  const lw = (v: number) => (v / lMax) * (LX1 - LX0);

  // ---- Netherlands ESL line ----
  const NX0 = 52, NX1 = 350, NY0 = 18, NY1 = 150, nMax = 78_000;
  const nx = (yr: number) => NX0 + ((yr - 2002) / (2024 - 2002)) * (NX1 - NX0);
  const ny = (v: number) => NY1 - (v / nMax) * (NY1 - NY0);
  const nlPath = NL_ESL.map((p, i) => `${i === 0 ? 'M' : 'L'} ${nx(p.year).toFixed(1)} ${ny(p.value).toFixed(1)}`).join(' ');

  // ---- Eurostat ranked bars ----
  const EX0 = 96, EX1 = 330, eMax = 21, eRowH = 30, eTop = 10;
  const ew = (v: number) => (v / eMax) * (EX1 - EX0);
  const euAvg = EUROSTAT_NEET.find((b) => b.kind === 'avg')?.pct ?? 11;
  const eKind: Record<string, string> = { low: '#2f7d4f', avg: 'rgba(28,22,17,0.4)', high: '#b1455e', uk: '#566a8c' };
</script>

<svelte:head><title>A NEET early-warning system for England · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.neet} />

  <div class="pe-prose lede">
    {#if eli}
      <p>
        Right now <b>just over a million</b> young people aged 16–24 in the UK are not in any school, job or training — about 1 in 8, and rising.
        Most of them aren’t even looking for work, often because they’re unwell. A major government review warns this could become <b>1 in 6
        within five years</b>, at a cost of roughly <b>£125 billion a year</b>.
      </p>
      <p>
        England’s system for identifying young people <i>before</i> they disengage is slow and has gaps. This page asks one narrow
        question: if England builds the “data spine” and the one-number-per-child it has just announced, and adopts the approaches the Netherlands and
        Estonia already use, could it monitor its own NEET projection against reality and intervene early, rather than recording the outcomes later?
      </p>
    {:else}
      <p>
        More than a million young people — <b>{NEET_NOW.total.toLocaleString()}</b>, or <b>{NEET_NOW.pct}%</b> of 16–24-year-olds ({NEET_NOW.asOf}) — are
        now NEET, the highest in years and rising; about <b>{NEET_NOW.inactive.toLocaleString()}</b> are economically inactive, not even job-seeking.
        The Milburn review warns the figure could reach <b>1 in 6 within five years</b> (~£125bn/yr). England’s machinery for identifying young
        people before they disengage is structurally <b>delayed and uneven</b>: a 16–17 tracking process built on periodic local-authority returns, a
        large “Not Known” cohort, and administrative data that is linkable for research but not actionable in real time.
      </p>
      <p>
        This page asks a deliberately narrow question. If England builds the <a href="/projects/policy-engine/monitor">data spine and consistent
        identifier</a> it has committed to, and pairs them with an attendance-led early-warning system — the approach the Netherlands and Estonia
        already use — could it monitor its own NEET projection against reality and intervene early? The evidence indicates the design works. It also
        indicates that <b>identification is not engagement</b>, and that errors in the governance of such a system carry direct consequences for children.
      </p>
    {/if}
  </div>

  <!-- ===================== The fork in the road (Milburn) ===================== -->
  <section class="block milburn">
    <p class="kick">The Milburn review · "Young People and Work" (interim, May 2026)</p>
    <h2 class="pe-h2">The fork in the road — what the diagnosis says must change</h2>
    <p class="cap">
      {eli
        ? 'A major government review set out WHY a million young people are NEET. It is a diagnosis, not a plan — its recommendations come in autumn 2026. Here is what it found, and the directions it points to.'
        : 'Alan Milburn’s DWP review diagnoses why ~1m young people are NEET across five interlocking failures. It is explicitly diagnostic — Chapter 9 is "the fork in the road" — with recommendations deferred to the solutions phase (autumn 2026). Below: the diagnosis, the directions it points toward, and the response package the engine can project.'}
    </p>

    <div class="mstats">
      {#each MILBURN_STATS as s (s.big)}
        <a class="mstat" href={s.url} target="_blank" rel="noopener">
          <span class="mstat-big">{s.big}</span><span class="mstat-lab">{s.label}</span>
        </a>
      {/each}
    </div>

    <div class="mfails">
      {#each MILBURN_FAILURES as f (f.title)}
        <div class="mfail">
          <span class="mfail-ch">{f.chapter}</span>
          <h3 class="mfail-t">{f.title}</h3>
          <p class="mfail-b">{eli ? f.eli5 : f.research}</p>
        </div>
      {/each}
    </div>

    <h3 class="pe-h3">The directions the diagnosis points to</h3>
    <p class="cap">
      {eli
        ? 'These are NOT the review’s recommendations (those come later) — they are the directions its diagnosis points to, each paired with what the model can simulate.'
        : 'Directions, not recommendations: each Milburn ask is tagged as diagnosis-led and mapped to the engine’s levers, so the package below can be projected. Formal recommendations follow in autumn 2026.'}
    </p>
    <div class="mdirs">
      {#each milburnDirections as d (d.id)}
        <div class="mdir">
          <span class="mdir-badge" style="--c:{DIR_STATUS_META[d.status].colour}">
            {eli ? DIR_STATUS_META[d.status].eli5 : DIR_STATUS_META[d.status].label}
          </span>
          <h4 class="mdir-t">{d.title}</h4>
          <p class="mdir-b">{eli ? d.whatChanges.eli5 : d.whatChanges.research}</p>
          <p class="mdir-eff"><b>{eli ? 'In the model:' : 'Expected effect:'}</b> {eli ? d.expectedEffect.eli5 : d.expectedEffect.research}</p>
        </div>
      {/each}
    </div>

    <div class="mcta">
      <button class="mcta-btn" onclick={loadMilburnPackage}>
        {eli ? 'See what this mix does →' : 'Load the "Milburn-aligned response" package →'}
      </button>
      <p class="mcta-note">
        {eli
          ? 'Loads a ready-made mix of these policies and shows the projection. It’s a fair attempt, not the review’s plan — and the model is unsure of the size.'
          : 'Applies a defensible participation-first package (entry-level, Youth Guarantee, apprenticeships, careers, post-16 and youth mental-health) and opens the Outcomes projection. Not the review’s recommendations; subject to the engine’s wide uncertainty (the youth levers are low-confidence).'}
      </p>
    </div>
  </section>

  <!-- ===================== 1 · the scale ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · A million young people, and rising</h2>
    <p class="cap">
      {eli
        ? 'The total is just over a million — and the bigger share aren’t unemployed (looking for work) but “economically inactive” (not looking at all). The faint bar shows where the review fears it’s heading.'
        : 'The 16–24 NEET total is more than a million, and crucially the larger share are economically inactive (not seeking work), not unemployed — a different, harder problem. The ghosted extension is the Milburn “1 in 6” trajectory.'}
    </p>
    <div class="chart">
      <svg viewBox="0 0 760 150" role="img" aria-label="Composition of UK 16 to 24 NEET: unemployed versus economically inactive, with the Milburn projection">
        {#each segs as s (s.label)}
          <rect x={cx(s.from)} y="44" width={cx(s.to) - cx(s.from)} height="40" fill={s.colour} />
          <text x={(cx(s.from) + cx(s.to)) / 2} y="68" class="seg-v">{fmtK(s.disp)}</text>
          <text x={(cx(s.from) + cx(s.to)) / 2} y="100" class="seg-l">{s.label}</text>
        {/each}
        <!-- projection ghost -->
        <rect x={cx(NEET_NOW.total)} y="44" width={cx(NEET_NOW.projection) - cx(NEET_NOW.total)} height="40" fill="url(#neethatch)" stroke="#b1455e" stroke-dasharray="3 2" stroke-width="1" />
        <defs>
          <pattern id="neethatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="rgba(177,69,94,0.08)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(177,69,94,0.5)" stroke-width="1.4" />
          </pattern>
        </defs>
        <text x={(cx(NEET_NOW.total) + cx(NEET_NOW.projection)) / 2} y="36" class="proj-l">Milburn: ~1.25m “1 in 6”</text>
        <!-- axis -->
        {#each cTicks as t (t)}
          <line x1={cx(t)} x2={cx(t)} y1="44" y2="90" class="ctick" />
          <text x={cx(t)} y="124" class="cax">{t === 0 ? '0' : fmtK(t)}</text>
        {/each}
        <text x={cx(NEET_NOW.total)} y="140" class="cnow">↑ now: {NEET_NOW.total.toLocaleString()} ({NEET_NOW.pct}%)</text>
      </svg>
    </div>
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.neetComposition} /></div>

    <h3 class="sub-h">{eli ? 'When do they fall?' : 'When they fall — the transition curve'}</h3>
    <p class="cap small">
      {eli
        ? 'The same million, sliced by age. Almost nobody is NEET at 16. The cliff is at 18 — the exact age the official tracking stops.'
        : 'The hazard is not evenly spread: it concentrates at the 17→18 transition, and the rate then plateaus rather than recovering. Note where the hatching starts.'}
    </p>
    <TransitionCurve />
  </section>

  <!-- ===================== 2 · live model bridge ===================== -->
  <section class="block bridge">
    <h2 class="pe-h2">2 · This model already projects NEET — so watch it live</h2>
    <p class="cap">
      {eli
        ? 'This is the result of joining the two ideas. This simulator already forecasts NEET for whatever scenario you’ve built. A real-time data spine would let you compare that line against what is actually happening, and act in time. Move the levers and this updates.'
        : 'This connects the model to the operational case. The engine already models NEET as an outcome (driven, in the model, through attainment and the post-16 boundary). A live data spine plus attendance feed is what would let you track this projection against reality and intervene on individuals, not just averages. The chart is your current scenario — open the levers and it moves.'}
    </p>
    {#if app.mounted}
      <div class="livewrap">
        <OutcomeChart
          title={eli ? 'NEET in your scenario, to 2040' : 'Modelled NEET (16–24): this scenario vs status quo'}
          unit="%"
          years={app.viewSim.map((y) => y.year)}
          series={neetSeries}
          baseYear={app.sim.baseYear}
          horizonYear={app.horizon}
          dp={1}
          goodIfUp={false}
          height={250}
        />
        <p class="liveread" class:good={neetDelta < -0.05} class:bad={neetDelta > 0.05}>
          By {app.horizon}, this scenario lands NEET at <b>{neetAtH.toFixed(1)}%</b>
          {#if Math.abs(neetDelta) >= 0.05}
            — {Math.abs(neetDelta).toFixed(1)}pp {neetDelta < 0 ? 'below' : 'above'} the status quo ({baseAtH.toFixed(1)}%).
          {:else}
            — about the same as the status quo ({baseAtH.toFixed(1)}%).
          {/if}
          <span class="liveread-cav">A modelled projection, not a forecast. Real monitoring is how you’d find out if it’s right.
            <a class="meth-link" href="/projects/policy-engine/method#eq-neet">how the three segments are modelled → Method</a></span>
        </p>
        <div class="mrow"><MeasurementPopover m={MEASUREMENT.neet} /></div>
      </div>
    {:else}
      <div class="chart skel">The live NEET projection loads here.</div>
    {/if}
  </section>

  <!-- ===================== 3 · the risk-tooling ladder ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The risk-tooling ladder: checklist → weights → ML</h2>
    <p class="cap">
      {eli
        ? 'England already scores children for NEET risk — three ways, of increasing cleverness. The strange part: nobody publishes how accurate any of it is.'
        : 'Risk scoring is not hypothetical — it is current practice, on a ladder of sophistication. The central fact sits at the top: no deployed English NEET model has published its precision or recall. The accuracy of the national practice is therefore unverifiable from the public record.'}
    </p>
    <div class="ladder">
      {#each TOOLING_LADDER as r (r.rung)}
        <article class="rung" style="--rc:{r.colour}">
          <header class="rung-head"><span class="rung-n">{r.rung}</span><span class="rung-name">{r.name}</span></header>
          <p class="rung-what">{eli ? r.whatEli5 : r.what}</p>
          {#if !eli}<p class="rung-status"><b>Status:</b> {r.status}</p>{/if}
          <p class="rung-weak"><b>{eli ? 'The catch:' : 'Weakness:'}</b> {r.weakness}</p>
        </article>
      {/each}
    </div>
    <h3 class="sub-h">{eli ? 'The cases that set the rules' : 'The failure gallery — each one a design rule'}</h3>
    <div class="failures">
      {#each FAILURE_GALLERY as f (f.name)}
        <article class="fail">
          <span class="fail-name">{f.name}</span>
          <p class="fail-what">{f.what}</p>
          <p class="fail-rule">▸ {f.rule} <a href={f.url} target="_blank" rel="noopener">↗</a></p>
        </article>
      {/each}
    </div>
  </section>

  <!-- ===================== 4 · the triage simulator ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · Try it: the triage trade-off</h2>
    <p class="cap">
      {eli
        ? 'This is the decision every early-warning system forces: flag more children and you catch more future NEETs — but you also wrongly label more, and someone has to support everyone on the list. Slide the slider and watch all three move at once.'
        : 'The central design decision of any early-warning system, made tangible: the flag-rate threshold trades recall against precision against caseload, simultaneously. Built on the published DfE/NatCen/Impetus risk multipliers with their uncertainty carried through — figures that deployed systems do not publish.'}
    </p>
    <TriageSimulator />
  </section>

  <!-- ===================== 5 · CCIS ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · CCIS — how England actually tracks (and loses) its 16–17s</h2>
    <p class="cap">{@html eli ? CCIS_INTRO.eli5 : CCIS_INTRO.research}</p>

    <div class="naming">
      {#each CCIS_NAMING as n (n.name)}
        <div class="nm-box" style="--nc:{n.colour}">
          <span class="nm-name">{n.name}</span>
          <span class="nm-expand">{n.expand}</span>
          <p class="nm-detail">{@html n.detail}</p>
        </div>
      {/each}
    </div>

    <h3 class="sub-h">What CCIS does</h3>
    <div class="pdgrid">
      {#each CCIS_ROLE as r (r.point)}
        <div class="pd"><span class="pd-point">{r.point}</span><span class="pd-detail">{r.detail}</span></div>
      {/each}
    </div>

    <h3 class="sub-h">Its defining failure — the “Not Known” cohort</h3>
    <p class="cap small">
      {eli
        ? 'When a council loses touch, the young person is filed as “activity not known” rather than chased — and councils that track harder simply look better. In Dudley only 2.4% were officially NEET, but nearly 1 in 5 were “not known”.'
        : 'Activity that isn’t reconfirmed in time is logged “activity not known”, not NEET — so the spread below is mostly tracking quality, not genuine risk. Dudley’s headline 21.5% is overwhelmingly lost contact (19.1% “not known”); the “Not Known” cohort, not measured NEET, is the dominant tracking failure.'}
    </p>
    <div class="chart">
      <svg viewBox="0 0 760 {lTop + LA_SPREAD.length * lRowH + 30}" role="img" aria-label="Local-authority 16 to 17 NEET versus activity not known">
        <text x={LX0} y={12} class="ax">% of 16–17 cohort →</text>
        <defs>
          <pattern id="nkhatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="rgba(154,123,31,0.1)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(154,123,31,0.7)" stroke-width="1.6" />
          </pattern>
        </defs>
        {#each LA_SPREAD as r, i (r.la)}
          {@const y = lTop + i * lRowH + lRowH / 2}
          <text x={LX0 - 12} y={y + 4} class="rn" text-anchor="end">{r.la}</text>
          {#if r.neet + r.notKnown === 0}
            <rect x={LX0} y={y - 11} width="3" height="22" rx="1.5" fill="#2f7d4f" />
            <text x={LX0 + 10} y={y + 4} class="rv">0.0%</text>
          {:else}
            <rect x={LX0} y={y - 11} width={lw(r.neet)} height="22" rx="2.5" fill="#566a8c" />
            {#if r.notKnown > 0}
              <rect x={LX0 + lw(r.neet)} y={y - 11} width={lw(r.notKnown)} height="22" rx="2.5" fill="url(#nkhatch)" stroke="rgba(154,123,31,0.6)" stroke-width="1" />
            {/if}
            <text x={LX0 + lw(r.neet + r.notKnown) + 8} y={y + 4} class="rv">{r.neet > 0 ? `${r.neet}% NEET` : ''}{r.notKnown > 0 ? ` + ${r.notKnown}% not known` : ''}</text>
          {/if}
        {/each}
        <g transform="translate({LX0}, {lTop + LA_SPREAD.length * lRowH + 14})">
          <rect x="0" y="-9" width="12" height="12" rx="2" fill="#566a8c" /><text x="18" y="1" class="leg">recorded NEET</text>
          <rect x="130" y="-9" width="12" height="12" rx="2" fill="url(#nkhatch)" stroke="rgba(154,123,31,0.6)" /><text x="148" y="1" class="leg">“activity not known” — the gap</text>
        </g>
      </svg>
    </div>
    <p class="offaxis">{LA_NOTE} <a href="https://feweek.co.uk/missing-teenagers-suggests-a-worthless-guarantee/" target="_blank" rel="noopener">Around 80,000 of 1.3m leavers had no recorded suitable offer in 2025 ↗</a>, and ~44% of NEETs are “hidden” — not on any out-of-work benefit, so the systems built to find them never see them.</p>

    <h3 class="sub-h">Why it creaks</h3>
    <div class="pdgrid">
      {#each CCIS_LIMITS as r (r.point)}
        <div class="pd lim"><span class="pd-point">{r.point}</span><span class="pd-detail">{r.detail}</span></div>
      {/each}
    </div>

    <h3 class="sub-h">How you’d overhaul it</h3>
    <p class="cap small">
      {eli
        ? 'Each row is a job CCIS does, how it works today, and how the new ideas on this page — a shared ID for every child, a “data spine”, and AI record-matching — would change it. (These reforms are announced or planned, not built.)'
        : 'Each row pairs a CCIS function with how it works today and how the announced reforms — a consistent identifier, the data spine and AI record-linkage — would change it. The point: the thing to overhaul is the system, not to bolt on another dashboard. (Reforms are announced/planned, not delivered.)'}
    </p>
    <div class="overhaul">
      <div class="oh-head"><span class="oh-dim">Function</span><span>CCIS today</span><span>Overhauled — identifier · spine · AI</span></div>
      {#each CCIS_OVERHAUL as o (o.dimension)}
        <div class="oh-row">
          <span class="oh-dim">{o.dimension}</span>
          <span class="oh-today">{o.today}</span>
          <span class="oh-new">{o.overhauled}</span>
        </div>
      {/each}
    </div>

    <div class="ccis-ai">
      <span class="ccis-ai-tag">⚙ Where AI actually fits</span>
      <p>{@html eli ? CCIS_AIVALUE.eli5 : CCIS_AIVALUE.research}</p>
      <p class="ccis-ai-foot">{eli ? 'The matching method is explained further in the AI section below. The constant constraint: locating a young person is not the same as re-engaging one.' : 'The record-linkage mechanism (the FIND role) is detailed in §11 below; the recurring caveat — a match is a status, not engagement — runs through the whole page.'}</p>
    </div>

    <div class="stats ccis-stats">
      {#each CCIS_STATS as s (s.big)}
        <a class="stat" href={s.url} target="_blank" rel="noopener"><span class="stat-big">{s.big}</span><span class="stat-lab">{s.label}</span></a>
      {/each}
    </div>
  </section>

  <!-- ===================== 6 · the data estate, triaged ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The data estate — proven, wasted, missing</h2>
    <p class="cap">
      {eli
        ? 'England already holds almost everything you’d need to spot a young person drifting — school, college, benefits and pay records. Green boxes work today; orange ones exist but sit unused for this; red dashed ones don’t exist at all. Click any box. Notice where the red stripes are: after 18.'
        : 'The estate, triaged node by node: what exists and is proven, what exists but is underused for NEET, and the missing links. Click a node for its latency, access route and the strategic gap. The hatched column is the age-18 dark zone — tracking ends exactly where the NEET problem peaks.'}
    </p>
    <DataEstateMap />
    <p class="offaxis">{LEO_NOTE}</p>

    <h3 class="sub-h">{eli ? 'What faster data would look like' : 'The nowcast: what the estate could already tell us'}</h3>
    <NowcastMock />
  </section>

  <!-- ===================== 7 · the join key ===================== -->
  <section class="block">
    <h2 class="pe-h2">7 · The join key: one number per child</h2>
    <p class="cap">
      {eli
        ? 'Connecting school systems is only half the job. To really catch a young person falling through, you often need to see across health, social care and benefits too — and for that you need one shared number that means “this same child” everywhere. A new law creates exactly that.'
        : 'A connectivity layer within education is necessary but not sufficient: finding a drifting young person usually means linking education, health, social care and benefits to the same child. That is the job of the statutory consistent identifier (Children’s Wellbeing and Schools Act 2026) — the cross-domain join key, distinct from the intra-education spine.'}
    </p>
    <div class="joinwrap">
      <svg viewBox="0 0 380 280" class="join" role="img" aria-label="One child identifier joining education, health, social care, police and benefits">
        {#each JOIN_SPOKES as sp, i (sp.label)}
          {@const a = (i / JOIN_SPOKES.length) * 2 * Math.PI - Math.PI / 2}
          {@const ex = 190 + 108 * Math.cos(a)}
          {@const ey = 140 + 100 * Math.sin(a)}
          <line x1="190" y1="140" x2={ex} y2={ey} stroke={sp.colour} stroke-width="2" opacity="0.5" />
          <circle cx={ex} cy={ey} r="6" fill={sp.colour} />
          <text x={ex} y={ey + (Math.sin(a) > 0.4 ? 20 : Math.sin(a) < -0.4 ? -12 : 4)} class="join-l" text-anchor={Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'} fill={sp.colour}>{sp.label}</text>
          <text x={ex} y={ey + (Math.sin(a) > 0.4 ? 32 : Math.sin(a) < -0.4 ? 0 : 16)} class="join-s" text-anchor={Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'}>{sp.sub}</text>
        {/each}
        <circle cx="190" cy="140" r="34" fill="#566a8c" />
        <text x="190" y="136" class="join-c">one child</text>
        <text x="190" y="150" class="join-c2">one number</text>
      </svg>
      <div class="join-body">
        <p>
          {#if eli}
            The law (the Children’s Wellbeing and Schools Act 2026) creates a “consistent identifier” for every child. It doesn’t actually say it
            must be the NHS number — but that’s the plan, being trialled in Wigan. There are sensible safeguards: you can leave the number off if
            including it would harm the child.
          {:else}
            The Act inserts a “consistent identifier” into the Children Act 2004 (ss.16LA–16LD): a number attached when processing a child’s
            information for safeguarding, subject to harm/proportionality carve-outs. It does <b>not</b> name the NHS number — that is policy intent,
            piloted with NHS England in Wigan. It is the same architecture Estonia and the Netherlands already run.
          {/if}
        </p>
        <a class="join-link" href="/projects/policy-engine/monitor">The spine vs the identifier, in full → Monitoring</a>
      </div>
    </div>
  </section>

  <!-- ===================== 8 · what works abroad ===================== -->
  <section class="block">
    <h2 class="pe-h2">8 · What works abroad</h2>
    <p class="cap">
      {eli
        ? 'Other countries do this effectively, and they use broadly the same approach: give every young person one ID, link the records, and have a named local person follow up with those who lose contact. Note the constraint shown in the third chart.'
        : 'International practice converges on one design pattern: a unique identifier plus cross-register linkage feeding a regional or municipal coordinator who proactively contacts the young person. Three charts set out the evidence — and the third sets out the caveat.'}
    </p>

    <div class="trio">
      <!-- NL halving -->
      <div class="panel">
        <h3 class="panel-h"><span class="cc-iso">NL</span> Drop-out, more than halved</h3>
        <svg viewBox="0 0 360 170" role="img" aria-label="Netherlands new early school leavers falling from 71,000 to 29,163">
          <line x1={NX0} x2={NX1} y1={NY1} y2={NY1} class="grid" />
          <line x1={NX0} x2={NX0} y1={NY0} y2={NY1} class="grid" />
          <path d={nlPath} fill="none" stroke="#2f7d4f" stroke-width="2.5" />
          {#each NL_ESL as p (p.year)}
            <circle cx={nx(p.year)} cy={ny(p.value)} r="4.5" fill={p.approx ? '#f1ead6' : '#2f7d4f'} stroke="#2f7d4f" stroke-width="2" stroke-dasharray={p.approx ? '2 2' : ''} />
            <text x={nx(p.year)} y={ny(p.value) - 10} class="np" text-anchor="middle">{p.label}</text>
            <text x={nx(p.year)} y={NY1 + 14} class="nax" text-anchor="middle">{p.year}{p.year === 2024 ? '/24' : ''}</text>
          {/each}
        </svg>
        <p class="panel-cap">New early school leavers per year. <b>The EU’s lowest NEET rate today.</b></p>
      </div>

      <!-- Eurostat ranked -->
      <div class="panel">
        <h3 class="panel-h"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" style="vertical-align:-2px"><line x1="3" y1="17" x2="17" y2="17"/><rect x="4" y="10" width="3" height="6"/><rect x="9" y="6" width="3" height="10"/><rect x="14" y="12" width="3" height="4"/></svg> Where they sit on NEET</h3>
        <svg viewBox="0 0 360 {eTop + EUROSTAT_NEET.length * eRowH + 22}" role="img" aria-label="NEET rates: Netherlands, EU average, UK and Romania">
          <line x1={EX0 + ew(euAvg)} x2={EX0 + ew(euAvg)} y1={eTop} y2={eTop + EUROSTAT_NEET.length * eRowH} class="euavg" />
          {#each EUROSTAT_NEET as b, i (b.name)}
            {@const y = eTop + i * eRowH + eRowH / 2}
            <text x={EX0 - 8} y={y + 4} class="ern" text-anchor="end">{b.flag} {b.name}</text>
            <rect x={EX0} y={y - 9} width={ew(b.pct)} height="18" rx="2.5" fill={eKind[b.kind]} opacity={b.kind === 'uk' ? 0.7 : 0.9} stroke={b.kind === 'uk' ? '#566a8c' : 'none'} stroke-dasharray={b.kind === 'uk' ? '3 2' : ''} stroke-width="1.4" />
            <text x={EX0 + ew(b.pct) + 6} y={y + 4} class="erv">{b.pct}%</text>
          {/each}
        </svg>
        <p class="panel-cap">15–29 (Eurostat), 2025. <b>UK is 16–24</b> — shown for scale, not like-for-like.</p>
      </div>

      <!-- Estonia funnel: identification ≠ engagement -->
      <div class="panel">
        <h3 class="panel-h"><span class="cc-iso">EE</span> Found ≠ reached</h3>
        <div class="efunnel">
          {#each ESTONIA_FUNNEL as st, i (st.label)}
            <div class="ef-row">
              <div class="ef-bar" style="width:{st.pct}%; opacity:{(1 - i * 0.17).toFixed(2)}">{st.pct === 100 ? '✓' : `${st.pct}%`}</div>
              <div class="ef-lab"><b>{st.label}</b><span>{st.sub}</span></div>
            </div>
          {/each}
        </div>
        <p class="panel-cap"><b>Only ~1 in 5</b> of those identified were actually reached. Finding them is the easy part.</p>
      </div>
    </div>

    <p class="trio-note">{eli ? 'Estonia’s twice-a-year check cross-references nine government databases to list every town’s NEET young people — yet it reached only about a fifth. Finland’s approach: deploy outreach workers to find them.' : 'Estonia’s YGSS cross-references nine registers twice a year (a complete data-spine pattern) — but the IBS evaluation found only ~half were contacted and ~1 in 5 reached. The finding: a spine that produces a list is not, by itself, a system that re-engages young people. That requires funded human outreach (Finland’s Ohjaamo) and a guaranteed offer (the EU Youth Guarantee).'}</p>

    <!-- intl cards by tier -->
    {#each Object.entries(NEET_TIER_META) as [tier, meta] (tier)}
      {@const rows = NEET_INTL.filter((r) => r.tier === tier)}
      <div class="tier">
        <h3 class="tier-h" style="--tc:{meta.colour}">{meta.label}</h3>
        <div class="cards">
          {#each rows as r (r.country)}
            <article class="ccard" style="--tc:{meta.colour}">
              <header><span class="cc-flag">{r.flag}</span><span class="cc-name">{r.country}</span></header>
              <span class="cc-sys">{r.system}</span>
              <p class="cc-mech">{r.mechanism}</p>
              <p class="cc-res"><b>Result:</b> {r.result}</p>
              <p class="cc-les"><span class="cc-tag">For England</span>{r.lesson}</p>
              <a class="cc-src" href={r.sourceUrl} target="_blank" rel="noopener">source ↗</a>
            </article>
          {/each}
        </div>
      </div>
    {/each}
  </section>

  <!-- ===================== 9 · who owns what ===================== -->
  <section class="block">
    <h2 class="pe-h2">9 · Who owns what — and the five fault lines</h2>
    <p class="cap">
      {eli
        ? 'Part of why this is hard: the job is split between government departments, councils, colleges and the NHS — and some squares on the board belong to nobody at all.'
        : 'The coordination problem, mapped: life stage × function, with the documented fault lines numbered. The pattern to notice is not who owns each cell — it is that the 18–24 tracking cell is EMPTY, and the health column never connects to the rest.'}
    </p>
    <StakeholderMap />
  </section>

  <!-- ===================== 10 · designing it: attendance as hub ===================== -->
  <section class="block">
    <h2 class="pe-h2">10 · Designing England’s early-warning system: attendance as the hub</h2>
    <p class="cap">
      {eli
        ? 'If you want to spot a young person heading for trouble early, the best clues aren’t exam results — they’re the everyday signals a school can change: are they turning up, how’s their behaviour, are they passing? “A” (attendance) is the biggest tell — and England already collects it twice a day.'
        : 'The strongest evidence says to build around “alterable” school signals — the ABCs (Attendance, Behaviour, Course performance) — which out-predict test scores and background. Attendance is the earliest and leading signal, which is why the engine makes it the hub. England already runs the feed and a NEET-specific process (RONI) that pulls multi-agency data schools can’t see alone.'}
    </p>
    <div class="hub">
      <div class="hub-abc">
        {#each ABC as a (a.letter)}
          <div class="abc" style="--ac:{a.colour}"><span class="abc-x">{a.letter}</span><span class="abc-l">{a.label}</span><span class="abc-s">{a.sub}</span></div>
        {/each}
      </div>
      <div class="hub-flow">
        <div class="hub-inputs">
          <span class="hub-lab">+ multi-agency data (RONI)</span>
          <div class="roni">{#each RONI_INPUTS as r (r)}<span class="roni-chip">{r}</span>{/each}</div>
        </div>
        <span class="hub-arrow">→</span>
        <div class="hub-pipe">
          <span class="pipe risk">risk score</span>
          <span class="pipe-arr">→</span>
          <span class="pipe human">a human caseworker</span>
          <span class="pipe-arr">→</span>
          <span class="pipe offer">an offer of support</span>
        </div>
      </div>
    </div>
    <p class="offaxis">{eli ? 'The data finds the young person; a person re-engages them — and the goal is always to offer help, never to punish or write anyone off.' : 'A spine-plus-identifier system would let England track its modelled NEET projection (above) against live attendance and act on individuals — provided the framing stays support-targeting, not punishment. The data finds the young person; a person re-engages them.'}</p>
  </section>

  <!-- ===================== 11 · how AI could help ===================== -->
  <section class="block">
    <h2 class="pe-h2">11 · How AI could improve England’s NEET approach</h2>
    <p class="cap">{eli ? AI_INTRO.eli5 : AI_INTRO.research}</p>
    <div class="airoles">
      {#each AI_ROLES as r (r.key)}
        <article class="airole" style="--rc:{r.colour}">
          <header class="ar-head">
            <span class="ar-icon" aria-hidden="true">
              {#if r.key === 'find'}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="10" r="3"/><circle cx="13.5" cy="10" r="3"/><path d="M8.8 8.4 11.2 11.6M8.8 11.6 11.2 8.4"/></svg>
              {:else if r.key === 'predict'}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3"/><circle cx="10" cy="10" r="0.6" fill="currentColor"/></svg>
              {:else if r.key === 'reach'}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 5h13v8h-7l-3.5 3v-3h-2.5z"/></svg>
              {:else}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13v-3"/><path d="M6.5 10a3.5 3.5 0 0 1 7 0"/><path d="M4 10a6 6 0 0 1 12 0"/><circle cx="10" cy="14.5" r="1" fill="currentColor" stroke="none"/></svg>
              {/if}
            </span>
            <div class="ar-heads">
              <span class="ar-tag">{r.tag}</span>
              <h3 class="ar-title">{r.title}</h3>
            </div>
            <span class="ar-verdict">{r.verdict}</span>
          </header>
          <p class="ar-prose">{eli ? r.eli5 : r.research}</p>
          <p class="ar-eg"><span class="ar-eg-tag">Grounding example</span>{r.example} <a href={r.exampleUrl} target="_blank" rel="noopener">↗</a></p>
        </article>
      {/each}
    </div>

    <div class="stats ai-stats">
      {#each AI_STATS as s (s.big)}
        <a class="stat" href={s.url} target="_blank" rel="noopener"><span class="stat-big">{s.big}</span><span class="stat-lab">{s.label}</span></a>
      {/each}
    </div>

    <h3 class="sub-h">{eli ? 'Everything data and AI could do here, ranked by how proven it is' : 'The opportunity ladder — eight shapes, ranked evidence → novelty'}</h3>
    <p class="cap small">
      {eli
        ? 'From the safest options at the top to the newest idea at the bottom: move from asking only “who’s at risk?” to asking “who would this programme actually help?”'
        : 'Each rung names what it is, the data it needs (cross-reference the estate map above), where the evidence stands, and the governance price. The frontier rung is the strategic one: risk-based targeting wastes spend on high-risk/low-responsiveness cases — uplift modelling targets by treatment effect, and the UK uniquely has the ingredients (YFF’s RCT portfolio × LEO outcomes).'}
    </p>
    <div class="opp-scroll">
      <table class="opp">
        <thead><tr><th>#</th><th>{eli ? 'Idea' : 'Shape'}</th><th>{eli ? 'What it is' : 'What'}</th><th>{eli ? 'Needs' : 'Data it needs'}</th><th>{eli ? 'How proven' : 'Evidence'}</th><th>{eli ? 'Safety rules' : 'Governance price'}</th></tr></thead>
        <tbody>
          {#each OPPORTUNITY_LADDER as o (o.rank)}
            <tr class:frontier={o.frontier}>
              <td class="num">{o.rank}</td>
              <td class="opp-name">{o.name}{#if o.frontier}<span class="front-tag">the frontier</span>{/if}</td>
              <td>{o.what}</td>
              <td class="opp-needs">{o.needs}
                {#if o.needIds?.length}
                  <span class="need-chips">
                    {#each o.needIds as nid (nid)}
                      <button class="need-chip" onclick={() => selectEstateNode(nid)} title="Jump to this node on the estate map">▴ {ESTATE_BY_ID[nid].name}</button>
                    {/each}
                  </span>
                {/if}
              </td>
              <td class="opp-ev">{o.evidence}</td>
              <td class="opp-gov">{o.governance}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <h3 class="sub-h">{eli ? 'Try the frontier: pick who to help, two ways' : 'Try the frontier: risk-targeting vs uplift-targeting'}</h3>
    <p class="cap small">
      {eli
        ? 'The bottom rung of the ladder, as a toy you can drive. Same money, same year-group — two ways of choosing who gets a programme place.'
        : 'Rung 8, made tangible. The same synthetic cohort as the triage simulator — but now a budget buys programme places, and the choice of WHO gets them is the policy. Risk-ranking is today’s default; treatment-effect-ranking is what the YFF-RCT × LEO linkage would enable.'}
    </p>
    <UpliftSimulator />

    <h3 class="sub-h">{eli ? 'The non-negotiables' : 'The governance checklist — distilled from the failure gallery'}</h3>
    <div class="govgrid">
      {#each GOVERNANCE_CHECKLIST as g (g.item)}
        <div class="gov"><span class="gov-item">✓ {g.item}</span><span class="gov-why">{g.why}</span></div>
      {/each}
    </div>

    <div class="aicaution">
      <span class="aic-tag">⚠ The caveats</span>
      <ul>{#each AI_CAUTIONS as c (c)}<li>{c}</li>{/each}</ul>
      <p class="aic-foot">{eli ? 'The full safety rules — checking for bias, the law, and always keeping a human in charge — are in the next section.' : 'The full guardrails — bias auditing, DPIAs, the automated-decisions law and human-in-the-loop — are in the next section.'}</p>
    </div>
  </section>

  <!-- ===================== 12 · ethics ===================== -->
  <section class="block">
    <h2 class="pe-h2">12 · Governing it for safety</h2>
    <p class="cap">
      {eli
        ? 'Because this concerns vulnerable young people, the risks weigh as heavily as the benefits. A system that predicts who is “at risk” can cause harm where it errs.'
        : 'Because this concerns vulnerable young people, the risks are stated as plainly as the benefits. A predictive early-warning system can reinforce the inequity it was intended to reduce — unless it is governed to “screen in” for support, with a human in the loop.'}
    </p>
    <EthicsGuardrails />
  </section>

  <!-- ===================== stats + closer ===================== -->
  <section class="block">
    <h2 class="pe-h2">The numbers</h2>
    <div class="stats">
      {#each NEET_KEY_STATS as s (s.big)}
        <a class="stat" href={s.url} target="_blank" rel="noopener"><span class="stat-big">{s.big}</span><span class="stat-lab">{s.label}</span></a>
      {/each}
    </div>
  </section>

  <section class="block takeaway">
    <h2 class="pe-h2">{eli ? 'The bottom line' : 'How this ties back to the model'}</h2>
    <div class="pe-prose">
      <p>
        {eli
          ? 'This simulator already forecasts NEET. A data spine, one number per child, and the attendance feed are the means to compare that forecast against reality and reach a specific young person early. Scotland and the Netherlands show it can work. The caveat is that locating young people is the more tractable step, and a flag should function as a prompt to check in, not a fixed judgement.'
          : 'The engine already models NEET as an outcome and treats attendance as the leading indicator. A data spine, a consistent identifier and the live attendance feed are the means by which that projection could be checked against reality and acted on for individuals. Scotland and the Netherlands show the pattern works; Estonia shows identification is not engagement; Wisconsin shows the governance is not optional. The model poses the question — real monitoring is how it would be answered.'}
      </p>
    </div>
    <div class="closer-links">
      <a class="pe-next" href="/projects/policy-engine/send">The costliest and least-measured subsystem → Field Study №7: SEND</a>
      <a class="pe-next ghost" href="/projects/policy-engine">Open the levers and move the NEET line →</a>
    </div>
  </section>
</div>

<style>
  .lede { max-width: 80ch; }
  .mrow { margin: 8px 0 0; }
  .meth-link { display: inline-block; margin-left: 8px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .lede b { color: var(--ink); } .lede a { color: var(--accent-ink); }
  .block { margin: 34px 0; }
  .block.bridge { background: var(--accent-ink-tint-06); border: 1px solid var(--accent-ink-tint-22); border-radius: var(--radius-sharp); padding: 18px 20px; }
  .cap { margin: 0 0 16px; font-size: var(--fs-nav); line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 90ch; }
  .cap b { color: var(--ink); }
  .offaxis { margin: 12px 0 0; padding: 9px 13px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.72);
    background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.1); }
  .offaxis b { color: var(--ink); } .offaxis a { color: var(--accent-ink); }

  .chart { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 12px 14px; }
  .chart svg { display: block; width: 100%; height: auto; }
  .chart.skel { color: rgba(28,22,17,0.4); font-size: var(--fs-label-xs); font-family: var(--font-mono); padding: 40px; text-align: center; }

  /* composition */
  .seg-v { font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 600; fill: #fff; text-anchor: middle; }
  .seg-l { font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.7); text-anchor: middle; }
  .proj-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: #b1455e; text-anchor: middle; }
  .ctick { stroke: rgba(28,22,17,0.12); stroke-width: 1; }
  .cax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); text-anchor: middle; }
  .cnow { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: #566a8c; text-anchor: middle; }

  /* live bridge */
  .livewrap { background: rgba(255,255,255,0.45); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 10px 14px 14px; }
  .liveread { margin: 8px 0 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.76); padding: 8px 12px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.04); }
  .liveread b { color: var(--ink); }
  .liveread.good { background: var(--success-bg); } .liveread.good b { color: var(--success); }
  .liveread.bad { background: var(--error-bg); } .liveread.bad b { color: var(--error); }
  .liveread-cav { display: block; margin-top: 3px; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); font-style: italic; }

  /* LA bars */
  .ax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.45); text-anchor: start; }
  .rn { font-family: var(--font-body); font-size: var(--fs-label); fill: rgba(28,22,17,0.82); }
  .rv { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.7); }
  .leg { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.6); }

  /* ---- risk-tooling ladder + failure gallery (§3) ---- */
  .ladder { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 11px; margin-bottom: 16px; }
  .rung { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--rc); border-radius: var(--radius-sharp); padding: 11px 13px; background: rgba(255,255,255,0.42); }
  .rung-head { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
  .rung-n { font-family: var(--fs-serif); font-weight: 600; font-size: 19px; color: var(--rc); }
  .rung-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .rung-what { margin: 0 0 6px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .rung-status { margin: 0 0 6px; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.6); }
  .rung-status b, .rung-weak b { color: var(--ink); }
  .rung-weak { margin: 0; font-size: var(--fs-label-xs); line-height: 1.45; color: #8a2d3a; }
  .failures { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 10px; }
  .fail { border: 1px dashed var(--error-border); border-radius: var(--radius-sharp); padding: 10px 12px; background: var(--error-bg); }
  .fail-name { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: #8a2d3a; }
  .fail-what { margin: 5px 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.72); }
  .fail-rule { margin: 0; font-size: var(--fs-label-xs); line-height: 1.4; font-weight: 600; color: var(--ink); }
  .fail-rule a { color: var(--accent-ink); text-decoration: none; }

  /* ---- opportunity ladder + governance (§11) ---- */
  .opp-scroll { overflow-x: auto; margin-bottom: 16px; }
  .opp { border-collapse: collapse; width: 100%; min-width: 760px; font-size: var(--fs-label-xs); }
  .opp th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 4px 10px 5px 0; border-bottom: 1px solid rgba(28,22,17,0.18); }
  .opp td { padding: 7px 10px 7px 0; border-bottom: 1px solid rgba(28,22,17,0.07); color: rgba(28,22,17,0.76); vertical-align: top; line-height: 1.45; }
  .opp td.num { font-family: var(--font-mono); }
  .opp-name { font-weight: 600; color: var(--ink); white-space: nowrap; }
  .front-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-ink); margin-top: 2px; }
  tr.frontier td { background: var(--accent-ink-tint-06); }
  .opp-needs, .opp-gov { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.62); }
  .need-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .need-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); background: var(--accent-ink-tint-12);
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 1px 6px; cursor: pointer; white-space: nowrap; }
  .need-chip:hover { background: var(--accent-ink-tint-22); border-color: var(--accent-ink); }
  .opp-ev { font-size: var(--fs-label-xs); }
  .govgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 9px; margin-bottom: 16px; }
  .gov { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 1px solid var(--success-border); border-radius: var(--radius-sharp); background: var(--success-bg); }
  .gov-item { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--success); }
  .gov-why { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.66); }

  /* join key */
  .joinwrap { display: grid; grid-template-columns: 380px 1fr; gap: 16px; align-items: center;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 12px 16px; }
  .join { width: 100%; max-width: 380px; height: auto; }
  .join-c { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: #fff; text-anchor: middle; }
  .join-c2 { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(255,255,255,0.85); text-anchor: middle; }
  .join-l { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 600; }
  .join-s { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); }
  .join-body p { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.76); } .join-body b { color: var(--ink); }
  .join-link { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* trio */
  .trio { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 12px; }
  .panel { background: rgba(255,255,255,0.42); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 12px 14px; }
  .panel-h { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); margin: 0 0 6px; color: var(--ink); }
  .cc-iso { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.04em; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 1px 4px; vertical-align: 1px; }
  .panel svg { display: block; width: 100%; height: auto; }
  .panel-cap { margin: 6px 0 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.66); } .panel-cap b { color: var(--ink); }
  .grid { stroke: rgba(28,22,17,0.12); stroke-width: 1; }
  .np { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: #2f7d4f; }
  .nax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); }
  .euavg { stroke: rgba(28,22,17,0.4); stroke-width: 1.2; stroke-dasharray: 3 3; }
  .ern { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.8); }
  .erv { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; fill: rgba(28,22,17,0.7); }
  .efunnel { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
  .ef-row { display: grid; grid-template-columns: 130px 1fr; align-items: center; gap: 12px; }
  .ef-bar { width: 100%; min-width: 38px; height: 24px; display: grid; place-items: center; background: var(--accent-ink); color: #fff; border-radius: var(--radius-sharp);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; }
  .ef-lab { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ef-lab b { font-size: var(--fs-label-xs); line-height: 1.25; color: var(--ink); }
  .ef-lab span { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.55); }
  .trio-note { margin: 12px 0 0; padding: 10px 13px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.76);
    background: var(--accent-ink-tint-06); border: 1px solid var(--accent-ink-tint-22); }
  .trio-note b { color: var(--ink); }

  /* tier cards */
  .tier { margin: 16px 0 0; }
  .tier-h { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink);
    margin: 0 0 9px; padding-left: 10px; border-left: 3px solid var(--tc); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr)); gap: 11px; }
  .ccard { border: 1px solid rgba(28,22,17,0.12); border-top: 3px solid var(--tc); border-radius: var(--radius-sharp); padding: 13px 14px; background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 5px; }
  .ccard header { display: flex; align-items: baseline; gap: 8px; }
  .cc-flag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.04em; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 1px 5px; } .cc-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); color: var(--ink); }
  .cc-sys { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--tc); }
  .cc-mech { margin: 4px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.76); }
  .cc-res { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); } .cc-res b { color: var(--ink); }
  .cc-les { margin: 4px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.82); }
  .cc-tag { display: inline-block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: var(--tc); border-radius: var(--radius-sharp); padding: 1px 5px; margin-right: 6px; }
  .cc-src { margin-top: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--tc); text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }

  /* attendance hub */
  .hub { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 14px 16px; }
  .hub-abc { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .abc { border-radius: var(--radius-sharp); padding: 11px 13px; background: color-mix(in srgb, var(--ac) 8%, transparent); border: 1px solid color-mix(in srgb, var(--ac) 30%, transparent); display: flex; flex-direction: column; gap: 2px; }
  .abc-x { font-family: var(--fs-serif); font-weight: 600; font-size: 22px; color: var(--ac); line-height: 1; }
  .abc-l { font-family: var(--font-body); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .abc-s { font-size: var(--fs-label-xs); line-height: 1.35; color: rgba(28,22,17,0.62); }
  .hub-flow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .hub-inputs { flex: 1 1 240px; }
  .hub-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .roni { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .roni-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 3px 7px; border-radius: var(--radius-sharp); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-22); color: var(--accent-ink); }
  .hub-arrow { font-size: 18px; color: rgba(28,22,17,0.3); }
  .hub-pipe { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .pipe { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 500; padding: 6px 11px; border-radius: var(--radius-sharp); }
  .pipe.risk { background: var(--error-bg); color: var(--error); }
  .pipe.human { background: var(--accent-ink-tint-12); color: var(--accent-ink); }
  .pipe.offer { background: var(--success-bg); color: var(--success); }
  .pipe-arr { color: rgba(28,22,17,0.35); }

  /* stats + closer */
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); gap: 10px; }
  .stat { display: flex; flex-direction: column; gap: 4px; padding: 13px 15px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.42);
    border: 1px solid rgba(28,22,17,0.12); text-decoration: none; transition: border-color 0.12s, background 0.12s; }
  .stat:hover { border-color: var(--accent-ink-tint-35); background: rgba(255,255,255,0.6); }
  .stat-big { font-family: var(--fs-serif); font-weight: 600; font-size: 23px; color: var(--accent-ink); line-height: 1; }
  .stat-lab { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.68); }
  .takeaway { border-top: 1px solid rgba(28,22,17,0.12); padding-top: 16px; }
  .takeaway .pe-prose { max-width: 88ch; } .takeaway p { margin: 0 0 12px; } .takeaway b { color: var(--ink); }
  .closer-links { display: flex; flex-wrap: wrap; gap: 8px; }
  .pe-next.ghost { background: transparent; color: var(--ink); border: 1px solid rgba(28,22,17,0.3); }
  .pe-next.ghost:hover { background: rgba(28,22,17,0.06); }

  /* AI-for-NEET roles */
  .airoles { display: flex; flex-direction: column; gap: 11px; }
  .airole { border: 1px solid rgba(28,22,17,0.12); border-left: 4px solid var(--rc); border-radius: var(--radius-sharp); padding: 13px 16px; background: rgba(255,255,255,0.42); }
  .ar-head { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 7px; }
  .ar-icon { font-size: 22px; line-height: 1.15; }
  .ar-heads { flex: 1; min-width: 0; }
  .ar-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.1em; color: var(--rc); }
  .ar-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); margin: 1px 0 0; color: var(--ink); line-height: 1.2; }
  .ar-verdict { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: #fff; background: var(--rc); border-radius: var(--radius-sharp);
    padding: 3px 8px; align-self: center; text-align: center; max-width: 160px; line-height: 1.25; }
  .ar-prose { margin: 0 0 9px; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.8); }
  .ar-eg { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.68); padding: 8px 11px; border-radius: var(--radius-sharp); background: color-mix(in srgb, var(--rc) 7%, transparent); }
  .ar-eg-tag { display: inline-block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: var(--rc); border-radius: var(--radius-sharp); padding: 1px 6px; margin-right: 7px; }
  .ar-eg a { color: var(--rc); font-weight: 700; text-decoration: none; }
  .ai-stats { margin-top: 14px; }
  .aicaution { margin-top: 14px; padding: 12px 16px; border-radius: var(--radius-sharp); background: var(--error-bg); border: 1px solid var(--error-border); }
  .aic-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--error); font-weight: 600; margin-bottom: 7px; }
  .aicaution ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  .aicaution li { font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.76); }
  .aic-foot { margin: 9px 0 0; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); font-style: italic; }

  /* CCIS deep-dive */
  .cap.small { font-size: var(--fs-label); margin: 0 0 12px; }
  .sub-h { font-family: var(--fs-serif); font-weight: 600; font-size: 17px; color: var(--ink); margin: 24px 0 10px; padding-bottom: 5px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .naming { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
  .nm-box { border: 1px solid rgba(28,22,17,0.12); border-left: 4px solid var(--nc); border-radius: var(--radius-sharp); padding: 11px 14px; background: rgba(255,255,255,0.42); }
  .nm-name { font-family: var(--font-mono); font-weight: 700; font-size: var(--fs-nav); color: var(--nc); letter-spacing: 0.04em; }
  .nm-expand { font-family: var(--fs-serif); font-style: italic; font-size: var(--fs-label); color: rgba(28,22,17,0.7); margin-left: 7px; }
  .nm-detail { margin: 6px 0 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); }
  .pdgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
  .pd { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 10px 13px; background: rgba(255,255,255,0.38); }
  .pd.lim { background: var(--error-bg); border-color: var(--error-border); }
  .pd-point { display: block; font-family: var(--font-body); font-weight: 600; font-size: var(--fs-label); color: var(--ink); margin-bottom: 3px; }
  .pd-detail { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); }
  .overhaul { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); overflow: hidden; background: rgba(255,255,255,0.4); }
  .oh-head, .oh-row { display: grid; grid-template-columns: 128px 1fr 1.15fr; gap: 12px; padding: 10px 14px; }
  .oh-head { background: rgba(28,22,17,0.05); border-bottom: 1px solid rgba(28,22,17,0.12); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.55); }
  .oh-head span:last-child { color: var(--success); }
  .oh-row { border-bottom: 1px solid rgba(28,22,17,0.07); align-items: start; }
  .oh-row:last-child { border-bottom: none; }
  .oh-dim { font-family: var(--font-body); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .oh-today { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.62); }
  .oh-new { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.82); padding-left: 12px; border-left: 2px solid var(--success-border); }
  .ccis-ai { margin-top: 16px; padding: 13px 16px; border-radius: var(--radius-sharp); background: var(--accent-ink-tint-06); border: 1px solid var(--accent-ink-tint-22); }
  .ccis-ai-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .ccis-ai p { margin: 0; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.82); }
  .ccis-ai-foot { margin-top: 8px !important; font-size: var(--fs-label-xs) !important; color: rgba(28,22,17,0.6) !important; font-style: italic; }
  .ccis-stats { margin-top: 14px; }

  @media (max-width: 820px) {
    .joinwrap { grid-template-columns: 1fr; } .join { margin: 0 auto; }
    .hub-abc { grid-template-columns: 1fr; }
    .ar-head { flex-wrap: wrap; } .ar-verdict { max-width: none; align-self: flex-start; }
    .naming, .pdgrid { grid-template-columns: 1fr; }
    .oh-head { display: none; }
    .oh-row { grid-template-columns: 1fr; gap: 5px; border-bottom: 1px solid rgba(28,22,17,0.12); }
    .oh-today::before { content: 'Today — '; font-weight: 600; color: rgba(28,22,17,0.5); }
    .oh-new { padding-left: 0; border-left: none; border-top: 1px dashed var(--success-border); padding-top: 6px; }
    .oh-new::before { content: 'Overhauled — '; font-weight: 600; color: var(--success); }
  }

  .milburn { border-left: 3px solid var(--accent-ink); padding-left: 1.1rem; }
  .milburn .kick { font: 600 0.72rem/1.3 var(--font-label, var(--font-mono)); letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent-ink); margin: 0 0 0.2rem; }
  .mstats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin: 0.9rem 0; }
  .mstat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.7rem; background: var(--card-bg, rgba(28,22,17,0.04)); border-radius: var(--radius-sharp); text-decoration: none; color: inherit; }
  .mstat-big { font: 800 1.25rem/1 var(--font-display, 'Archivo Black', system-ui); color: var(--accent-ink); }
  .mstat-lab { font-size: 0.78rem; line-height: 1.3; opacity: 0.85; }
  .mfails { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem; margin: 0.9rem 0; }
  .mfail { padding: 0.7rem 0.8rem; background: var(--card-bg, rgba(28,22,17,0.04)); border-radius: var(--radius-sharp); }
  .mfail-ch { font: 600 0.7rem var(--font-label, var(--font-mono)); opacity: 0.6; }
  .mfail-t { font-size: 0.95rem; margin: 0.2rem 0 0.3rem; }
  .mfail-b { font-size: 0.82rem; line-height: 1.4; margin: 0; opacity: 0.9; }
  .mdirs { display: grid; gap: 0.7rem; margin: 0.7rem 0; }
  .mdir { padding: 0.7rem 0.9rem; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); }
  .mdir-badge { display: inline-block; font: 600 0.66rem var(--font-label, var(--font-mono)); text-transform: uppercase; letter-spacing: 0.03em; color: var(--c); border: 1px solid var(--c); border-radius: var(--radius-sharp); padding: 0.1rem 0.5rem; margin-bottom: 0.35rem; }
  .mdir-t { font-size: 0.98rem; margin: 0 0 0.3rem; }
  .mdir-b { font-size: 0.85rem; line-height: 1.45; margin: 0 0 0.3rem; }
  .mdir-eff { font-size: 0.8rem; line-height: 1.4; margin: 0; opacity: 0.85; }
  .mcta { margin-top: 1rem; }
  .mcta-btn { font: 600 0.9rem var(--font-body, system-ui); background: var(--accent-ink); color: #fff; border: none; border-radius: var(--radius-sharp); padding: 0.6rem 1rem; cursor: pointer; }
  .mcta-btn:hover { filter: brightness(1.08); }
  .mcta-note { font-size: 0.78rem; line-height: 1.4; opacity: 0.8; margin: 0.45rem 0 0; }
  .pe-h3 { font-size: 1.05rem; margin: 1.1rem 0 0.2rem; }
</style>
