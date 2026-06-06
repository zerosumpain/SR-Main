<script lang="ts">
  import { onMount } from 'svelte';
  import LeverRail from './components/LeverRail.svelte';
  import OutcomeChart, { type ChartSeries } from './components/OutcomeChart.svelte';
  import Scorecard from './components/Scorecard.svelte';
  import CostPanel from './components/CostPanel.svelte';
  import Sensitivity from './components/Sensitivity.svelte';
  import ScenarioBar from './components/ScenarioBar.svelte';
  import Methodology from './components/Methodology.svelte';
  import { runSim } from './lib/engine';
  import { runMonteCarlo } from './lib/montecarlo';
  import { baselineLevers, policyLevers, LEVERS } from './lib/levers';
  import { PRESETS, type Preset, downloadJSON } from './lib/scenarios';
  import { HISTORY, BASE_YEAR, BASELINE, TARGETS } from './lib/params';
  import type { LeverState } from './lib/types';

  const STORAGE = 'whitehall-model-levers-v1';

  // ---- state ----
  let levers = $state<LeverState>(policyLevers());
  let horizon = $state(2040);
  let showBands = $state(false);
  let tab = $state<'outcomes' | 'scorecard' | 'cost' | 'sensitivity' | 'method'>('outcomes');
  let mounted = $state(false);
  let importErr = $state<string | null>(null);

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') levers = { ...policyLevers(), ...parsed };
      }
    } catch { /* ignore */ }
    mounted = true;
  });

  $effect(() => {
    if (!mounted) return;
    try { localStorage.setItem(STORAGE, JSON.stringify(levers)); } catch { /* quota */ }
  });

  // ---- engine runs ----
  const sim = $derived(runSim(levers));
  const baseSim = $derived(runSim(baselineLevers()));
  const mc = $derived(showBands ? runMonteCarlo(levers, 180) : null);

  // ---- preset matching ----
  function equalLevers(a: LeverState, b: LeverState): boolean {
    return LEVERS.every((l) => (a[l.id] ?? l.baseline) === (b[l.id] ?? l.baseline));
  }
  const activePreset = $derived(PRESETS.find((p) => equalLevers(levers, p.levers))?.name ?? null);

  // DSG statutory override ends March 2028 — flag if the deficit breaches the insolvency threshold
  const insolvencyYear = $derived(sim.years.find((y) => y.insolvencyRisk)?.year ?? null);
  const horizonDeficit = $derived(sim.years.find((y) => y.year === horizon)?.highNeedsDeficitStock ?? 0);

  // ---- chart helpers ----
  const HY = HISTORY.year;
  const padNaN = HY.map(() => Number.NaN);
  const allYears = $derived([...HY, ...sim.years.map((y) => y.year)]);
  function withHist(key: string): number[] {
    return [...(HISTORY[key] ?? padNaN), ...sim.years.map((y) => (y as any)[key] as number)];
  }
  function proj(key: string, source = sim): number[] {
    return [...padNaN, ...source.years.map((y) => (y as any)[key] as number)];
  }
  function bandFor(key: string): { p10: number[]; p90: number[] } | null {
    if (!mc || !mc.bands[key]) return null;
    return { p10: [...padNaN, ...mc.bands[key].p10], p90: [...padNaN, ...mc.bands[key].p90] };
  }

  const C_YOU = '#9a3b2e';   // your scenario (primary)
  const C_DIS = '#b4632e';   // disadvantaged
  const C_BASE = 'rgba(28,22,17,0.34)'; // status quo
  const C_ALT = '#3f7d6e';   // secondary metric

  interface ChartDef { title: string; unit: string; dp: number; zeroBased?: boolean; target?: { value: number; label: string } | null; series: ChartSeries[]; }

  const charts = $derived.by<ChartDef[]>(() => [
    {
      title: 'Disadvantage attainment gap', unit: 'months behind', dp: 1,
      target: { value: BASELINE.gapKS4 / 2, label: 'halve (WP)' },
      series: [
        { label: 'At 16 (KS4) — your scenario', color: C_YOU, values: withHist('gapKS4'), emphasis: true, band: bandFor('gapKS4') },
        { label: 'At 16 — status quo', color: C_BASE, values: proj('gapKS4', baseSim), dashed: true },
        { label: 'At 11 (KS2) — your scenario', color: C_ALT, values: withHist('gapKS2') },
      ],
    },
    {
      title: 'Attainment 8', unit: 'score (0–90)', dp: 1, target: { value: TARGETS.attainment8, label: 'WP target 50' },
      series: [
        { label: 'All pupils — your', color: C_YOU, values: withHist('attainment8'), emphasis: true, band: bandFor('attainment8') },
        { label: 'Disadvantaged — your', color: C_DIS, values: proj('attainment8Dis'), dashed: true },
        { label: 'All — status quo', color: C_BASE, values: proj('attainment8', baseSim), dashed: true },
      ],
    },
    {
      title: 'Grade 5+ in English & Maths', unit: '%', dp: 1,
      series: [
        { label: 'All — your', color: C_YOU, values: withHist('grade5EM'), emphasis: true, band: bandFor('grade5EM') },
        { label: 'Disadvantaged — your', color: C_DIS, values: proj('grade5EMDis'), dashed: true },
        { label: 'All — status quo', color: C_BASE, values: proj('grade5EM', baseSim), dashed: true },
      ],
    },
    {
      title: 'KS2 reading + writing + maths', unit: '% expected std', dp: 1, target: { value: TARGETS.ks2RWM, label: 'above 2019' },
      series: [
        { label: 'All — your', color: C_YOU, values: withHist('ks2RWM'), emphasis: true, band: bandFor('ks2RWM') },
        { label: 'Disadvantaged — your', color: C_DIS, values: proj('ks2RWMDis'), dashed: true },
        { label: 'All — status quo', color: C_BASE, values: proj('ks2RWM', baseSim), dashed: true },
      ],
    },
    {
      title: 'Good Level of Development (age 5)', unit: '%', dp: 1, target: { value: TARGETS.gld, label: 'Best Start 75%' },
      series: [
        { label: 'All — your', color: C_YOU, values: withHist('gld'), emphasis: true, band: bandFor('gld') },
        { label: 'Disadvantaged — your', color: C_DIS, values: proj('gldDis'), dashed: true },
        { label: 'All — status quo', color: C_BASE, values: proj('gld', baseSim), dashed: true },
      ],
    },
    {
      title: 'EHCP prevalence', unit: '% of pupils', dp: 2, target: { value: TARGETS.ehcpPctGov, label: 'gov aspiration 4.7%' },
      series: [
        { label: 'Your scenario', color: C_YOU, values: withHist('ehcpPct'), emphasis: true, band: bandFor('ehcpPct') },
        { label: 'Status quo', color: C_BASE, values: proj('ehcpPct', baseSim), dashed: true },
      ],
    },
    {
      title: 'High-needs (SEND) deficit', unit: '£bn — override ends 2028', dp: 1, zeroBased: true,
      series: [
        { label: 'Your scenario', color: C_YOU, values: withHist('highNeedsDeficitStock'), emphasis: true, band: bandFor('highNeedsDeficitStock') },
        { label: 'Status quo', color: C_BASE, values: proj('highNeedsDeficitStock', baseSim), dashed: true },
      ],
    },
    {
      title: 'SEND (EHCP) Attainment 8', unit: 'score', dp: 1,
      series: [
        { label: 'Your scenario', color: C_YOU, values: proj('ehcpAttainment8'), emphasis: true },
        { label: 'Status quo', color: C_BASE, values: proj('ehcpAttainment8', baseSim), dashed: true },
      ],
    },
    {
      title: 'Persistent absence', unit: '% missing ≥10%', dp: 1,
      series: [
        { label: 'All — your', color: C_YOU, values: withHist('persistentAbsence'), emphasis: true, band: bandFor('persistentAbsence') },
        { label: 'Disadvantaged — your', color: C_DIS, values: proj('persistentAbsenceDis'), dashed: true },
        { label: 'All — status quo', color: C_BASE, values: proj('persistentAbsence', baseSim), dashed: true },
      ],
    },
    {
      title: 'Child poverty', unit: '% relative (AHC)', dp: 1,
      series: [
        { label: 'Your scenario', color: C_YOU, values: withHist('childPoverty'), emphasis: true, band: bandFor('childPoverty') },
        { label: 'Status quo', color: C_BASE, values: proj('childPoverty', baseSim), dashed: true },
      ],
    },
    {
      title: 'NEET (16–24)', unit: '%', dp: 1,
      series: [
        { label: 'Your scenario', color: C_YOU, values: withHist('neet'), emphasis: true, band: bandFor('neet') },
        { label: 'Status quo', color: C_BASE, values: proj('neet', baseSim), dashed: true },
      ],
    },
    {
      title: 'Teacher shortfall (6,500 pledge)', unit: 'k FTE — neg = surplus', dp: 1, zeroBased: true,
      series: [
        { label: 'Your scenario', color: C_YOU, values: proj('teacherShortfall'), emphasis: true, band: bandFor('teacherShortfall') },
        { label: 'Status quo', color: C_BASE, values: proj('teacherShortfall', baseSim), dashed: true },
      ],
    },
  ]);

  // ---- actions ----
  function setLever(id: string, v: number) { levers = { ...levers, [id]: v }; }
  function resetLever(id: string) {
    const L = LEVERS.find((l) => l.id === id)!;
    levers = { ...levers, [id]: L.baseline };
  }
  function applyPreset(p: Preset) { levers = { ...p.levers }; }
  function resetAll() { levers = policyLevers(); }
  function exportJson() {
    downloadJSON(`whitehall-model-${(activePreset ?? 'custom').replace(/\s+/g, '-').toLowerCase()}.json`, JSON.stringify({ levers }, null, 2));
  }
  function importJson() {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const incoming = (obj && obj.levers) ? obj.levers : obj;
        if (!incoming || typeof incoming !== 'object') throw new Error('No levers found.');
        levers = { ...policyLevers(), ...incoming };
        importErr = null;
      } catch (e) { importErr = e instanceof Error ? e.message : 'Bad file'; }
    };
    input.click();
  }

  const TABS = [
    { id: 'outcomes', label: 'Outcomes' },
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'cost', label: 'Cost' },
    { id: 'sensitivity', label: 'Sensitivity' },
    { id: 'method', label: 'Method & sources' },
  ] as const;
</script>

<svelte:head>
  <title>The Whitehall Model — England Education Policy Simulator</title>
  <meta name="description" content="An interactive, research-backed simulation of England education policy 2025–2040: move policy sliders (SEND/EHCP reform, pupil premium, attendance, early years, the 6,500 teachers pledge, curriculum reform) and watch the disadvantage gap, attainment, SEND deficit and NEET respond — with cited sources, assumptions and uncertainty bands." />
  <meta property="og:title" content="The Whitehall Model — England Education Policy Simulator" />
  <meta property="og:description" content="Move the policy levers, watch the outcomes. A research-backed system-dynamics model of England's schools, 2025–2040." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>

  <header class="head">
    <div class="head-l">
      <a class="back" href="/projects">← Field studies</a>
      <span class="tagline">FIELD STUDY №4 · POLICY SIMULATION ENGINE</span>
      <h1>The Whitehall Model</h1>
      <p class="sub">
        A research-backed simulation of England's schools system, 2025–2040. Move the policy levers —
        SEND &amp; EHCP reform, pupil premium, attendance, early years, the 6,500-teacher pledge, curriculum
        reform, school funding — and watch the disadvantage gap, attainment, the SEND deficit and NEET
        respond. Every effect size is sourced or flagged as an assumption.
      </p>
    </div>
    <div class="head-r">
      <div class="io">
        <div class="seg" role="group" aria-label="Horizon">
          {#each [2030, 2035, 2040] as h}
            <button class:active={horizon === h} onclick={() => (horizon = h)}>{h}</button>
          {/each}
        </div>
        <button class="tgl" class:on={showBands} onclick={() => (showBands = !showBands)} title="Monte-Carlo P10–P90 uncertainty bands">
          Uncertainty {showBands ? 'on' : 'off'}
        </button>
      </div>
      <div class="io">
        <button class="link" onclick={exportJson}>Export</button>
        <button class="link" onclick={importJson}>Import</button>
        <button class="link" onclick={resetAll}>Reset</button>
      </div>
    </div>
  </header>

  <div class="scen">
    <ScenarioBar activeName={activePreset} onApply={applyPreset} />
    {#if importErr}<span class="imp-err">Import failed: {importErr}</span>{/if}
  </div>

  {#if insolvencyYear}
    <div class="cliff" role="alert">
      ⚠ <b>SEND funding cliff:</b> the DSG statutory override ends March 2028. On this trajectory the
      high-needs deficit breaches the insolvency threshold by <b>{insolvencyYear}</b> (£{horizonDeficit.toFixed(0)}bn
      by {horizon}) — councils would face s.114 bankruptcy. Raise high-needs funding, or reform/inclusion to bend demand.
    </div>
  {/if}

  <div class="body">
    <aside class="rail-col">
      <div class="rail-head">
        <span>Policy levers</span>
        <span class="rail-sub">{LEVERS.length} levers · ⓘ for evidence · | = announced policy</span>
      </div>
      <LeverRail {levers} onChange={setLever} onResetLever={resetLever} />
    </aside>

    <main class="out-col">
      <nav class="tabs">
        {#each TABS as t}
          <button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
        {/each}
      </nav>

      {#if tab === 'outcomes'}
        <p class="tab-intro">
          Solid line = your policy package; dashed grey = the status-quo (do-nothing) trajectory; dashed colour =
          disadvantaged pupils; green dashes = a government target. The shaded band before {BASE_YEAR} is observed history.
          {#if showBands}Shaded fans are Monte-Carlo P10–P90 uncertainty.{/if}
        </p>
        <div class="chart-grid">
          {#each charts as c (c.title)}
            <OutcomeChart title={c.title} unit={c.unit} years={allYears} series={c.series}
                          baseYear={BASE_YEAR} dp={c.dp} zeroBased={c.zeroBased} target={c.target} />
          {/each}
        </div>
      {:else if tab === 'scorecard'}
        <Scorecard sim={sim.years} baseSim={baseSim.years} {horizon} />
      {:else if tab === 'cost'}
        <CostPanel sim={sim.years} baseSim={baseSim.years} {horizon} />
      {:else if tab === 'sensitivity'}
        <Sensitivity {levers} {horizon} />
      {:else if tab === 'method'}
        <Methodology />
      {/if}
    </main>
  </div>

  <footer class="foot">
    <span>The Whitehall Model · <code>/projects/policy-engine</code> · built autonomously from a single prompt ·
      a decision-support tool, not a forecast — see Method &amp; sources for assumptions and limitations.</span>
  </footer>
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: #f1ead6; --paper-deep: #e7decc; --ink: #1c1611; --ink-soft: rgba(28,22,17,0.62);
    position: relative; min-height: 100vh; background:
      radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), var(--paper);
    color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; overflow-x: hidden;
  }
  .paper-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }
  .head { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 22px 28px 14px; border-bottom: 1px solid rgba(28,22,17,0.1); }
  .head-l { max-width: 78ch; min-width: 0; }
  .back { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); text-decoration: none; }
  .back:hover { color: var(--ink); }
  .tagline { display: block; margin-top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; color: var(--ink-soft); text-transform: uppercase; }
  h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(26px, 4vw, 40px); line-height: 0.98; letter-spacing: -0.02em; margin: 5px 0 7px; }
  .sub { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink-soft); max-width: 76ch; }
  .head-r { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
  .io { display: flex; gap: 5px; align-items: center; }
  .seg { display: inline-flex; background: rgba(28,22,17,0.06); padding: 2px; border-radius: 6px; }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 5px 9px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; }
  .seg button.active { background: var(--ink); color: var(--paper); }
  .tgl { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.2); color: var(--ink); padding: 5px 9px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .tgl.on { background: #2f6f97; color: #fff; border-color: #2f6f97; }
  .link { background: transparent; border: none; border-bottom: 1px dashed rgba(28,22,17,0.4); padding: 2px 5px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
  .link:hover { background: rgba(28,22,17,0.05); }

  .scen { position: relative; z-index: 1; padding: 10px 28px; border-bottom: 1px solid rgba(28,22,17,0.08); display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .imp-err { color: #8a2d22; font-size: 11px; }
  .cliff {
    position: relative; z-index: 1; margin: 0; padding: 8px 28px; font-size: 12px; line-height: 1.45;
    background: rgba(177, 69, 94, 0.1); color: #8a2d3a; border-bottom: 1px solid rgba(177,69,94,0.25);
  }
  .cliff b { color: #6f2230; }

  .body { position: relative; z-index: 1; display: grid; grid-template-columns: 340px 1fr; gap: 0; align-items: start; }
  .rail-col { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding: 14px 14px 40px; border-right: 1px solid rgba(28,22,17,0.1); }
  .rail-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .rail-head span:first-child { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; }
  .rail-sub { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); letter-spacing: 0.02em; }

  .out-col { padding: 14px 22px 50px; min-width: 0; }
  .tabs { display: flex; gap: 3px; border-bottom: 1px solid rgba(28,22,17,0.14); margin-bottom: 12px; flex-wrap: wrap; }
  .tabs button { background: transparent; border: none; padding: 8px 13px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--ink-soft); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button:hover { color: var(--ink); }
  .tabs button.active { color: var(--ink); border-bottom-color: var(--ink); font-weight: 500; }
  .tab-intro { margin: 0 0 12px; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 90ch; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }

  .foot { position: relative; z-index: 1; padding: 12px 28px 18px; border-top: 1px solid rgba(28,22,17,0.08); font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: 3px; color: var(--ink-soft); }

  @media (max-width: 880px) {
    .body { grid-template-columns: 1fr; }
    .rail-col { position: relative; max-height: none; border-right: none; border-bottom: 1px solid rgba(28,22,17,0.1); }
    .head { flex-direction: column; align-items: flex-start; }
    .head-r { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; flex-wrap: wrap; }
  }
</style>
