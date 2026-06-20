<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import OutcomeChart, { type ChartSeries } from '../components/OutcomeChart.svelte';
  import ChartModal from '../components/ChartModal.svelte';
  import StorySection from '../components/StorySection.svelte';
  import CompareReadout from '../components/CompareReadout.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import { HISTORY, BASE_YEAR, BASELINE, TARGETS } from '../lib/params';
  import { chartSummary } from '../lib/summaries';
  import { LEVERS_BY_ID, LEVER_ELI5_NAME } from '../lib/levers';

  // the handful of sliders that most move each chart — a hint pointing the user at the drawer
  const KEY_LEVERS: Record<string, string[]> = {
    gapKS4: ['attendance', 'poverty_action', 'ey_quality', 'tutoring', 'place_investment'],
    attainment8: ['teachers', 'teacher_pay', 'attendance', 'reading', 'curriculum'],
    grade5EM: ['teachers', 'attendance', 'reading', 'curriculum'],
    ks2RWM: ['reading', 'teachers', 'attendance', 'curriculum'],
    gld: ['ey_quality', 'ey_access', 'eypp', 'poverty_action'],
    ehcpPct: ['inclusion_fund', 'send_early', 'ehcp_reform', 'mental_health'],
    highNeedsDeficitStock: ['high_needs', 'inclusion_fund', 'ehcp_reform', 'send_early'],
    ehcpAttainment8: ['inclusion_fund', 'send_early', 'ehcp_reform', 'send_pipeline', 'care_support'],
    persistentAbsence: ['attendance', 'breakfast', 'mental_health', 'behaviour_support', 'housing_instability'],
    childPoverty: ['poverty_action', 'fsm'],
    neet: ['youth_guarantee', 'mental_health', 'apprenticeships', 'careers_gatsby', 'post16_premium'],
    teacherShortfall: ['teachers', 'teacher_pay', 'bursaries', 'school_funding'],
    cumulativeCost: [],
  };
  const lname = (id: string) => (app.narrative === 'eli5' ? LEVER_ELI5_NAME[id] ?? LEVERS_BY_ID[id].label : LEVERS_BY_ID[id].label);

  interface ChartDef { title: string; unit: string; dp: number; zeroBased?: boolean; target?: { value: number; label: string } | null; series: ChartSeries[]; }

  const C_YOU = '#9a3b2e', C_DIS = '#b4632e', C_BASE = 'rgba(28,22,17,0.34)', C_ALT = '#3f7d6e', C_B = '#3a5fa8';
  const HY = HISTORY.year;
  const padNaN = HY.map(() => Number.NaN);
  const allYears = $derived([...HY, ...app.viewSim.map((y) => y.year)]);
  function withHist(key: string): number[] {
    const hist = app.region === 'all' ? (HISTORY[key] ?? padNaN) : padNaN;
    return [...hist, ...app.viewSim.map((y) => (y as any)[key] as number)];
  }
  function proj(key: string, source = app.viewSim): number[] { return [...padNaN, ...source.map((y) => (y as any)[key] as number)]; }
  function bandFor(key: string): { p10: number[]; p90: number[] } | null {
    if (!app.mc || !app.mc.bands[key] || app.region !== 'all') return null;
    return { p10: [...padNaN, ...app.mc.bands[key].p10], p90: [...padNaN, ...app.mc.bands[key].p90] };
  }

  const CHART_PRIMARY: Record<string, string> = {
    'Disadvantage attainment gap': 'gapKS4', 'Attainment 8': 'attainment8', 'Grade 5+ in English & Maths': 'grade5EM',
    'KS2 reading + writing + maths': 'ks2RWM', 'Good Level of Development (age 5)': 'gld', 'EHCP prevalence': 'ehcpPct',
    'High-needs (SEND) deficit': 'highNeedsDeficitStock', 'SEND (EHCP) Attainment 8': 'ehcpAttainment8',
    'Persistent absence': 'persistentAbsence', 'Child poverty': 'childPoverty', 'NEET (16–24)': 'neet',
    'Teacher shortfall (6,500 pledge)': 'teacherShortfall', 'Total programme cost': 'cumulativeCost',
  };
  // plain-English chart titles (keyed on the canonical title, which stays for the summary lookup)
  const CHART_ELI5_TITLE: Record<string, string> = {
    'Disadvantage attainment gap': 'The rich–poor gap', 'Attainment 8': 'Average GCSE score',
    'Grade 5+ in English & Maths': 'Good pass in English & maths', 'KS2 reading + writing + maths': 'On track at end of primary',
    'Good Level of Development (age 5)': 'Ready for school at 5', 'EHCP prevalence': 'Pupils with a special-needs plan',
    'High-needs (SEND) deficit': 'Special-needs debt', 'SEND (EHCP) Attainment 8': 'Special-needs pupils’ GCSE score',
    'Persistent absence': 'Pupils missing lots of school', 'Child poverty': 'Children in poverty',
    'NEET (16–24)': 'Young people not working or studying', 'Teacher shortfall (6,500 pledge)': 'Teachers we’re short of',
    'Total programme cost': 'Total extra cost',
  };
  const dispTitle = (t: string) => (app.narrative === 'eli5' ? CHART_ELI5_TITLE[t] ?? t : t);

  interface Theme { key: string; title: string; prose: string; eli5: string; charts: ChartDef[]; }
  const themes = $derived.by<Theme[]>(() => {
    const vb = app.viewBase;
    const T: Theme[] = [
      { key: 'equity', title: 'Equity — the disadvantage gap', prose:
        'The headline measure: the “months of learning” a disadvantaged 16-year-old is behind their peers (EPI). The model treats the entire post-2019 widening as absence-driven, so attendance is the single strongest lever; early-years money is larger still but reaches GCSE only after an ~11-year lag. The dashed grey line is the do-nothing path.',
        eli5: 'The headline number: how far behind poorer 16-year-olds are, counted in months of learning. The biggest thing that moves it is getting those kids to actually attend school. Early-years help works even better, but takes about eleven years to show up. The dashed grey line is what happens if nothing changes.',
        charts: [{ title: 'Disadvantage attainment gap', unit: 'months behind', dp: 1, target: { value: BASELINE.gapKS4 / 2, label: 'halve (WP)' }, series: [
          { label: 'At 16 (KS4) — your scenario', color: C_YOU, values: withHist('gapKS4'), emphasis: true, band: bandFor('gapKS4') },
          { label: 'At 16 — status quo', color: C_BASE, values: proj('gapKS4', vb), dashed: true },
          { label: 'At 11 (KS2) — your scenario', color: C_ALT, values: withHist('gapKS2') }] }] },
      { key: 'attainment', title: 'Attainment', prose:
        'Levels, not gaps. Attainment is driven by teacher capacity (the strongest evidenced channel), attendance, and the literacy/curriculum levers — and, in this model, not by a direct £-per-pupil effect (a deliberate, contested assumption — see Method). Core funding shows up here only indirectly, by funding the staff that raise capacity. Good Level of Development at age 5 is almost entirely an early-years story.',
        eli5: 'How good results are, rather than the gap. Results go up mainly when there are enough good teachers and kids show up — plus better reading and curriculum. In this model, spending on its own helps mainly when it pays for those teachers (a debated assumption you can change). The age-5 “school-ready” number is almost all about early-years help.',
        charts: [
          { title: 'Attainment 8', unit: 'score (0–90)', dp: 1, target: { value: TARGETS.attainment8, label: 'WP target 50' }, series: [
            { label: 'All pupils — your', color: C_YOU, values: withHist('attainment8'), emphasis: true, band: bandFor('attainment8') },
            { label: 'Disadvantaged — your', color: C_DIS, values: proj('attainment8Dis'), dashed: true },
            { label: 'All — status quo', color: C_BASE, values: proj('attainment8', vb), dashed: true }] },
          { title: 'Grade 5+ in English & Maths', unit: '%', dp: 1, series: [
            { label: 'All — your', color: C_YOU, values: withHist('grade5EM'), emphasis: true, band: bandFor('grade5EM') },
            { label: 'Disadvantaged — your', color: C_DIS, values: proj('grade5EMDis'), dashed: true },
            { label: 'All — status quo', color: C_BASE, values: proj('grade5EM', vb), dashed: true }] },
          { title: 'KS2 reading + writing + maths', unit: '% expected std', dp: 1, target: { value: TARGETS.ks2RWM, label: 'above 2019' }, series: [
            { label: 'All — your', color: C_YOU, values: withHist('ks2RWM'), emphasis: true, band: bandFor('ks2RWM') },
            { label: 'Disadvantaged — your', color: C_DIS, values: proj('ks2RWMDis'), dashed: true },
            { label: 'All — status quo', color: C_BASE, values: proj('ks2RWM', vb), dashed: true }] },
          { title: 'Good Level of Development (age 5)', unit: '%', dp: 1, target: { value: TARGETS.gld, label: 'Best Start 75%' }, series: [
            { label: 'All — your', color: C_YOU, values: withHist('gld'), emphasis: true, band: bandFor('gld') },
            { label: 'Disadvantaged — your', color: C_DIS, values: proj('gldDis'), dashed: true },
            { label: 'All — status quo', color: C_BASE, values: proj('gld', vb), dashed: true }] }] },
      { key: 'send', title: 'SEND & the funding cliff', prose:
        'A stock-flow system of its own. EHCP prevalence climbs on its own momentum; inclusion and early-SEND slow it, and EHCP reform diverts plans from 2030 — but narrowing plans without matching inclusion lowers SEND attainment. The high-needs deficit is the time-bomb: when the statutory override ends in March 2028, an unbent deficit drains mainstream funding. The high-needs uplift lever acts here, not on the gap.',
        eli5: 'Special-needs support, which is its own tangle. More and more pupils get a legal plan (an EHCP). The real danger is the debt councils run up to pay for it: when a protection rule ends in 2028, that debt starts eating into ordinary school budgets. The high-needs money lever fixes the debt, not the gap.',
        charts: [
          { title: 'EHCP prevalence', unit: '% of pupils', dp: 2, target: { value: TARGETS.ehcpPctGov, label: 'gov 4.7%' }, series: [
            { label: 'Your scenario', color: C_YOU, values: withHist('ehcpPct'), emphasis: true, band: bandFor('ehcpPct') },
            { label: 'Status quo', color: C_BASE, values: proj('ehcpPct', vb), dashed: true }] },
          { title: 'High-needs (SEND) deficit', unit: '£bn — override ends 2028', dp: 1, zeroBased: true, series: [
            { label: 'Your scenario', color: C_YOU, values: withHist('highNeedsDeficitStock'), emphasis: true, band: bandFor('highNeedsDeficitStock') },
            { label: 'Status quo', color: C_BASE, values: proj('highNeedsDeficitStock', vb), dashed: true }] },
          { title: 'SEND (EHCP) Attainment 8', unit: 'score', dp: 1, series: [
            { label: 'Your scenario', color: C_YOU, values: proj('ehcpAttainment8'), emphasis: true },
            { label: 'Status quo', color: C_BASE, values: proj('ehcpAttainment8', vb), dashed: true }] }] },
      { key: 'system', title: 'System health & destinations', prose:
        'The mechanisms behind the headline. Disadvantaged persistent absence is the gap’s engine; child poverty is the upstream tide; teacher shortfall is the capacity constraint that recruitment, pay and funding all chase. NEET — the exit boundary — is modelled as three distinct stocks, because 61% of today’s NEETs are inactive, not unemployed: the unemployed segment responds to the Youth Guarantee and apprenticeships, the health-driven segment (the Milburn “fault line”) only to mental-health and CAMHS capacity, and the rest to retention and care support. The NEET field study pulls this thread fully.',
        eli5: 'The machinery behind the headline: poorer kids missing school (the main driver of the gap), poverty as the background tide, and whether there are enough teachers. The “no job or training” line is split into three: those looking for work, those too unwell to work (the fastest-growing group — job schemes don’t help them, health support does), and those out for other reasons like caring.',
        charts: [
          { title: 'Persistent absence', unit: '% missing ≥10%', dp: 1, series: [
            { label: 'All — your', color: C_YOU, values: withHist('persistentAbsence'), emphasis: true, band: bandFor('persistentAbsence') },
            { label: 'Disadvantaged — your', color: C_DIS, values: proj('persistentAbsenceDis'), dashed: true },
            { label: 'All — status quo', color: C_BASE, values: proj('persistentAbsence', vb), dashed: true }] },
          { title: 'Child poverty', unit: '% relative (AHC)', dp: 1, series: [
            { label: 'Your scenario', color: C_YOU, values: withHist('childPoverty'), emphasis: true, band: bandFor('childPoverty') },
            { label: 'Status quo', color: C_BASE, values: proj('childPoverty', vb), dashed: true }] },
          { title: 'NEET (16–24)', unit: '%', dp: 1, series: [
            { label: 'Headline — your', color: C_YOU, values: withHist('neet'), emphasis: true, band: bandFor('neet') },
            { label: 'Unemployed', color: '#2f6f97', values: proj('neetUnemployed') },
            { label: 'Inactive (health)', color: '#7a5aa6', values: proj('neetInactiveHealth'), band: bandFor('neetInactiveHealth') },
            { label: 'Inactive (other)', color: '#9a7b1f', values: proj('neetInactiveOther') },
            { label: 'Status quo', color: C_BASE, values: proj('neet', vb), dashed: true }] },
          { title: 'Teacher shortfall (6,500 pledge)', unit: 'k FTE — neg = surplus', dp: 1, zeroBased: true, series: [
            { label: 'Your scenario', color: C_YOU, values: proj('teacherShortfall'), emphasis: true, band: bandFor('teacherShortfall') },
            { label: 'Status quo', color: C_BASE, values: proj('teacherShortfall', vb), dashed: true }] }] },
      { key: 'cost', title: 'What it costs', prose:
        'The running total of additional spend versus the status quo. Watch the shape: per-pupil and programme levers are flat annual costs, but the three growth-rate levers — core funding, teacher pay and the high-needs uplift — compound year on year, so a few percent of sustained real growth becomes the largest line on the chart. Read it against the gap and attainment to judge value.',
        eli5: 'How much extra it all costs versus doing nothing. Watch the shape: most things are a flat yearly bill, but funding, pay and special-needs growth get pricier every single year they run — so they end up as the biggest line.',
        charts: [{ title: 'Total programme cost', unit: '£bn cumulative', dp: 1, zeroBased: true, series: [
          { label: 'Your scenario', color: C_YOU, values: proj('cumulativeCost'), emphasis: true },
          { label: 'Status quo', color: C_BASE, values: proj('cumulativeCost', vb), dashed: true }] }] },
    ];
    if (!app.viewSimB) return T;
    const b = app.viewSimB;
    return T.map((th) => ({ ...th, charts: th.charts.map((c) => {
      const primary = c.series.find((s) => s.emphasis) ?? c.series[0];
      return { ...c, series: [{ ...primary, label: 'Scenario A' }, { label: 'Scenario B', color: C_B, values: proj(CHART_PRIMARY[c.title], b), emphasis: true }] };
    }) }));
  });

  let expanded = $state<ChartDef | null>(null);
  const cmpLabel = $derived(app.compareB && app.viewSimB ? 'Scenario B' : 'status-quo path');
  function sumFor(c: ChartDef) {
    return chartSummary(CHART_PRIMARY[c.title], app.viewSim, app.compareB && app.viewSimB ? app.viewSimB : app.viewBase, app.horizon, cmpLabel);
  }
</script>

<svelte:head><title>The Briefing — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <span class="pe-eyebrow">The Briefing</span>
  <h1 class="pe-h1">State of the system</h1>
  <div class="pe-prose">
    {#if app.narrative === 'eli5'}
      <p>
        This is the overview: every headline measure of England’s schools in one place — the rich–poor gap, results, special needs,
        absence, poverty, young people out of work, teachers and money. Each chart shows your plan (thick line) against doing nothing
        (dashed grey); the further apart they are, the bigger the difference your choices make. The blue <b>{app.horizon} ▸</b> mark is
        the year you’re looking at. Click <b>⤢</b> on any chart to blow it up. The pages after this one each pull on a single thread.
        {#if app.compareB}Right now you’re comparing two of your own plans, <b>A</b> and <b>B</b>.{/if}
      </p>
    {:else}
      <p>
        The high-level readout across the five things the department is accountable for — equity, attainment, the SEND system, system
        health and money — your scenario against the do-nothing path. Solid line is your package; dashed grey is the status quo; dashed
        colour is disadvantaged pupils; green dashes mark a government target. The shaded band before {BASE_YEAR} is observed history
        (hidden in a regional view). The blue <b>{app.horizon} ▸</b> marker tracks the horizon selector and drives each chart’s short
        narrative; hover a chart and click <b>⤢</b> to expand it. Each Field Study that follows pulls one of these threads — the human
        scale, the geography, the world, the data, the exit boundary. {#if app.compareB}<b style="color:#9a3b2e">Scenario A</b> and
        <b style="color:#3a5fa8">Scenario B</b> are overlaid on each chart’s headline metric.{/if}
      </p>
    {/if}
  </div>

  {#if app.region !== 'all'}
    <div class="rgn-note">◉ Re-based onto <b>{app.regionName}</b>: attainment, the gap, absence, GLD &amp; NEET are regional; SEND, cost &amp; workforce stay national.</div>
  {/if}

  {#if app.showBands}
    <p class="mc-note">{app.narrative === 'eli5'
      ? 'The shaded fans show how unsure the model is: the line could plausibly land anywhere inside them.'
      : 'Shaded fans are P10–P90 from a 110-draw Monte Carlo across every effect-size band, plus a shared structural multiplier for correlated model uncertainty.'}
      <a class="mc-link" href="/projects/policy-engine/method#eq-mc">{app.narrative === 'eli5' ? 'how the fuzziness is worked out →' : 'the sampling equation →'}</a></p>
  {/if}

  {#if app.compareB && app.viewSimB}
    <div class="cmp-wrap">
      <CompareReadout simA={app.viewSim} simB={app.viewSimB} nameA={app.scenarioDisplayName} nameB={app.compareB.name} horizon={app.horizon} />
    </div>
  {/if}

  {#each themes as th (th.key)}
    <StorySection title={th.title}>
      {#snippet prose()}
        <p class="theme-prose">{app.narrative === 'eli5' ? th.eli5 : th.prose}</p>
      {/snippet}
      {#snippet data()}
        <div class="grid">
          {#each th.charts as c (c.title)}
            {@const sm = sumFor(c)}
            {@const movers = KEY_LEVERS[CHART_PRIMARY[c.title]] ?? []}
            <div class="cell">
              <button class="expand" onclick={() => (expanded = c)} aria-label="Expand {c.title}">⤢</button>
              <OutcomeChart title={dispTitle(c.title)} unit={c.unit} years={allYears} series={c.series} baseYear={BASE_YEAR}
                horizonYear={app.horizon} dp={c.dp} zeroBased={c.zeroBased} target={c.target} />
              <p class="summary tone-{sm.tone}">{app.narrative === 'eli5' ? sm.eli5 : sm.text}</p>
              {#if movers.length}
                <div class="hint">
                  <span class="hint-lab">▸ sliders that move this:</span>
                  {#each movers as id (id)}<button class="hint-chip" onclick={() => app.focusLever(id)} title="Jump to this slider in the levers drawer">{lname(id)}</button>{/each}
                </div>
              {/if}
              {#if MEASUREMENT[CHART_PRIMARY[c.title]]}
                <div class="mrow"><MeasurementPopover m={MEASUREMENT[CHART_PRIMARY[c.title]]} /></div>
              {/if}
            </div>
          {/each}
        </div>
      {/snippet}
    </StorySection>
  {/each}

  <a class="pe-next" href="/projects/policy-engine/population">Now in real children → Population</a>
</div>

{#if expanded}
  {@const sm = sumFor(expanded)}
  <ChartModal title={dispTitle(expanded.title)} unit={expanded.unit} years={allYears} series={expanded.series} baseYear={BASE_YEAR}
    horizonYear={app.horizon} target={expanded.target ?? null} dp={expanded.dp} zeroBased={expanded.zeroBased ?? false}
    narrative={app.narrative === 'eli5' ? sm.eli5 : sm.text} onClose={() => (expanded = null)} />
{/if}

<style>
  .rgn-note { margin: 0 0 6px; padding: 6px 10px; border-radius: var(--radius-round); font-size: 11px; color: rgba(28,22,17,0.7);
    background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); }
  .rgn-note b { color: var(--ink); }
  .theme-prose { margin: 0; font-size: 15px; line-height: 1.62; color: rgba(28,22,17,0.68); }
  .mc-note { margin: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; color: rgba(28,22,17,0.5); max-width: 88ch; }
  .mc-link { margin-left: 6px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .cmp-wrap { margin: 0 0 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 14px; align-items: start; }
  .cell { display: flex; flex-direction: column; position: relative; }
  .expand { position: absolute; top: 6px; right: 8px; z-index: 3; width: 22px; height: 22px; border-radius: var(--radius-round);
    border: 1px solid rgba(28,22,17,0.18); background: rgba(255,255,255,0.7); color: rgba(28,22,17,0.6); cursor: pointer;
    font-size: 12px; line-height: 1; opacity: 0; transition: opacity 0.14s; padding: 0; }
  .cell:hover .expand, .expand:focus-visible { opacity: 1; }
  .expand:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .summary { margin: 6px 2px 0; font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.66); border-left: 2px solid rgba(28,22,17,0.18); padding-left: 8px; }
  .summary.tone-good { border-left-color: var(--success); }
  .summary.tone-bad { border-left-color: var(--error); }
  .hint { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 7px 2px 0; }
  .hint-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.5); }
  .hint-chip { font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round); padding: 2px 9px; cursor: pointer; line-height: 1.3; }
  .hint-chip:hover { background: var(--accent-ink-tint-22); border-color: var(--accent-ink); }
  .mrow { margin: 5px 2px 0; }
  @media (max-width: 760px) { .expand { opacity: 1; } }
</style>
