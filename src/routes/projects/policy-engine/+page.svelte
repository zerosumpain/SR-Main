<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import LeverRail from './components/LeverRail.svelte';
  import OutcomeChart, { type ChartSeries } from './components/OutcomeChart.svelte';
  import Scorecard from './components/Scorecard.svelte';
  import CostPanel from './components/CostPanel.svelte';
  import Sensitivity from './components/Sensitivity.svelte';
  import ScenarioBar from './components/ScenarioBar.svelte';
  import Methodology from './components/Methodology.svelte';
  import AgeIdentification from './components/AgeIdentification.svelte';
  import ScenarioReadout from './components/ScenarioReadout.svelte';
  import CompareReadout from './components/CompareReadout.svelte';
  import ChartModal from './components/ChartModal.svelte';
  import SavedScenarios from './components/SavedScenarios.svelte';
  import PopulationPanel from './components/PopulationPanel.svelte';
  import { runSim } from './lib/engine';
  import { runMonteCarlo } from './lib/montecarlo';
  import { baselineLevers, policyLevers, LEVERS, AGE_BANDS, LEVERS_BY_ID } from './lib/levers';
  import { PRESETS, type Preset, downloadJSON, encodeLevers, decodeLevers, tokenFromHash,
           loadSaved, persistSaved, makeSaved, type SavedScenario } from './lib/scenarios';
  import { HISTORY, BASE_YEAR, BASELINE, TARGETS } from './lib/params';
  import { chartSummary } from './lib/summaries';
  import { SOURCES } from './lib/sources';
  import { optimizeGapWithinBudget, allocationBreakdown, type AllocRow } from './lib/optimize';
  import type { LeverState } from './lib/types';

  const STORAGE = 'whitehall-model-levers-v1';

  // ---- state ----
  let levers = $state<LeverState>(policyLevers());
  let horizon = $state(2040);
  let showBands = $state(false);
  let tab = $state<'outcomes' | 'population' | 'scorecard' | 'cost' | 'sensitivity' | 'method'>('outcomes');
  let mounted = $state(false);
  let importErr = $state<string | null>(null);
  let copied = $state(false);
  let lastHash = '';

  onMount(() => {
    // A shared permalink (#s=…) is authoritative; otherwise fall back to localStorage.
    const token = tokenFromHash(location.hash);
    const fromLink = token ? decodeLevers(token) : null;
    if (fromLink) {
      levers = fromLink;
    } else {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') levers = { ...policyLevers(), ...parsed };
        }
      } catch { /* ignore */ }
    }
    saved = loadSaved();
    mounted = true;
  });

  function setUrl(url: string) {
    try { replaceState(url, {}); }
    catch { try { history.replaceState(history.state, '', url); } catch { /* ignore */ } }
  }

  $effect(() => {
    if (!mounted) return;
    try { localStorage.setItem(STORAGE, JSON.stringify(levers)); } catch { /* quota */ }
    // Keep the address bar shareable: sync the scenario into the URL hash once it differs
    // from the default (announced policy). Default state keeps a clean, hash-free URL.
    const enc = equalLevers(levers, policyLevers()) ? '' : encodeLevers(levers);
    if (enc !== lastHash) {
      lastHash = enc;
      setUrl(enc ? `#s=${enc}` : location.pathname + location.search);
    }
  });

  function shareUrl(): string {
    return `${location.origin}${location.pathname}#s=${encodeLevers(levers)}`;
  }
  function copyLink() {
    const url = shareUrl();
    const done = () => { copied = true; setTimeout(() => (copied = false), 1700); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => { prompt('Copy this scenario link:', url); });
    } else {
      prompt('Copy this scenario link:', url);
    }
  }

  // ---- engine runs ----
  const sim = $derived(runSim(levers));
  const baseSim = $derived(runSim(baselineLevers()));
  const mc = $derived(showBands ? runMonteCarlo(levers, 180) : null);

  // ---- preset matching ----
  function equalLevers(a: LeverState, b: LeverState): boolean {
    return LEVERS.every((l) => (a[l.id] ?? l.baseline) === (b[l.id] ?? l.baseline));
  }
  const activePreset = $derived(PRESETS.find((p) => equalLevers(levers, p.levers))?.name ?? null);
  let expanded = $state<number | null>(null); // index of the expanded chart, or null

  // ---- saved (named) scenarios ----
  let saved = $state<SavedScenario[]>([]);
  const matchedSaved = $derived(saved.find((s) => equalLevers(levers, s.levers))?.name ?? null);
  function saveCurrentAs(name: string) { saved = [makeSaved(name, levers), ...saved]; persistSaved(saved); }
  function deleteSaved(id: string) { saved = saved.filter((s) => s.id !== id); persistSaved(saved); }
  function loadSavedScenario(s: SavedScenario) { optimizeResult = null; levers = { ...s.levers }; }
  function pinSavedAsB(s: SavedScenario) { compareB = { levers: { ...s.levers }, name: s.name }; }

  // ---- side-by-side comparison ----
  let compareB = $state<{ levers: LeverState; name: string } | null>(null);
  const simB = $derived(compareB ? runSim(compareB.levers) : null);
  const C_B = '#3a5fa8'; // Scenario B line colour

  function pinAsB() { compareB = { levers: { ...levers }, name: scenarioName }; }
  function clearCompare() { compareB = null; }
  function swapAB() {
    if (!compareB) return;
    const prevB = compareB;
    compareB = { levers: { ...levers }, name: scenarioName };
    optimizeResult = null;
    levers = { ...prevB.levers };
  }

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

  // maps each chart to the primary YearResult key used for its dynamic summary
  const CHART_PRIMARY: Record<string, string> = {
    'Disadvantage attainment gap': 'gapKS4',
    'Attainment 8': 'attainment8',
    'Grade 5+ in English & Maths': 'grade5EM',
    'KS2 reading + writing + maths': 'ks2RWM',
    'Good Level of Development (age 5)': 'gld',
    'EHCP prevalence': 'ehcpPct',
    'High-needs (SEND) deficit': 'highNeedsDeficitStock',
    'SEND (EHCP) Attainment 8': 'ehcpAttainment8',
    'Persistent absence': 'persistentAbsence',
    'Child poverty': 'childPoverty',
    'NEET (16–24)': 'neet',
    'Teacher shortfall (6,500 pledge)': 'teacherShortfall',
    'Total programme cost': 'cumulativeCost',
  };

  const charts = $derived.by<ChartDef[]>(() => {
    const base: ChartDef[] = [
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
    {
      title: 'Total programme cost', unit: '£bn cumulative', dp: 1, zeroBased: true,
      series: [
        { label: 'Your scenario', color: C_YOU, values: proj('cumulativeCost'), emphasis: true },
        { label: 'Status quo', color: C_BASE, values: proj('cumulativeCost', baseSim), dashed: true },
      ],
    },
    ];
    // Compare mode: overlay Scenario A (current) vs Scenario B (pinned) on each chart's primary metric.
    if (!simB) return base;
    const b = simB;
    return base.map((c) => {
      const primary = c.series.find((s) => s.emphasis) ?? c.series[0];
      const key = CHART_PRIMARY[c.title];
      return {
        ...c,
        series: [
          { ...primary, label: 'Scenario A' },
          { label: 'Scenario B', color: C_B, values: proj(key, b), emphasis: true },
        ],
      };
    });
  });

  // ---- actions ----
  function setLever(id: string, v: number) { optimizeResult = null; levers = { ...levers, [id]: v }; }
  function resetLever(id: string) {
    optimizeResult = null;
    const L = LEVERS.find((l) => l.id === id)!;
    levers = { ...levers, [id]: L.baseline };
  }
  // ---- budget-constrained optimiser ("Best value") ----
  let optimizeBudget = $state(PRESETS.find((p) => p.optimize)?.budget ?? 5); // £bn/yr, adjustable
  let optimizeResult = $state<
    { baselineGap: number; gap: number; cost: number; closed: number; horizon: number; budget: number; breakdown: AllocRow[]; alloc: LeverState } | null
  >(null);
  let optimizeApplied = $state(false);
  let tipOpen = $state(false);
  const scenarioName = $derived(activePreset ?? matchedSaved ?? (optimizeApplied ? 'Optimised allocation' : 'Custom scenario'));

  // Compute (preview) the budget-optimal allocation WITHOUT changing the sliders.
  function previewOptimize() {
    const r = optimizeGapWithinBudget(optimizeBudget, horizon);
    optimizeResult = {
      baselineGap: r.baselineGap, gap: r.gap, cost: r.cost, closed: r.baselineGap - r.gap,
      horizon, budget: optimizeBudget, breakdown: allocationBreakdown(r.levers, horizon), alloc: r.levers,
    };
    optimizeApplied = false;
  }
  // Commit the previewed allocation to the sliders (the charts then reflect the optimum).
  function applyOptimized() {
    if (!optimizeResult) return;
    levers = { ...optimizeResult.alloc };
    optimizeApplied = true;
  }
  // change the horizon; re-preview the optimum if the optimiser is currently active
  function setHorizon(h: number) {
    horizon = h;
    if (optimizeResult) previewOptimize();
  }

  function applyPreset(p: Preset) {
    if (p.optimize) { previewOptimize(); }
    else { optimizeResult = null; levers = { ...p.levers }; }
  }
  function resetAll() { optimizeResult = null; levers = policyLevers(); }
  function resetAgeId() {
    optimizeResult = null;
    const next = { ...levers };
    for (const b of AGE_BANDS) next[b.leverId] = LEVERS_BY_ID[b.leverId].baseline;
    levers = next;
  }
  const railLeverCount = LEVERS.filter((l) => l.group !== 'identification').length;
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
        optimizeResult = null;
        levers = { ...policyLevers(), ...incoming };
        importErr = null;
      } catch (e) { importErr = e instanceof Error ? e.message : 'Bad file'; }
    };
    input.click();
  }

  const TABS = [
    { id: 'outcomes', label: 'Outcomes' },
    { id: 'population', label: 'Population' },
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'cost', label: 'Cost' },
    { id: 'sensitivity', label: 'Sensitivity' },
    { id: 'method', label: 'Method & calculations' },
  ] as const;
</script>

<svelte:head>
  <title>Education Policy Modelling — England Schools Simulator</title>
  <meta name="description" content="An interactive, research-backed simulation of England education policy 2025–2040: move policy sliders (SEND/EHCP reform, pupil premium, attendance, early years, the 6,500 teachers pledge, curriculum reform) and watch the disadvantage gap, attainment, SEND deficit and NEET respond — with cited sources, assumptions and uncertainty bands." />
  <meta property="og:title" content="Education Policy Modelling — England Schools Simulator" />
  <meta property="og:description" content="Move the policy levers, watch the outcomes. A research-backed system-dynamics model of England's schools, 2025–2040." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>

  <header class="head">
    <a class="back" href="/projects">← Field studies</a>
    <span class="tagline">FIELD STUDY №4 · ENGLAND SCHOOLS · 2025–2040</span>
    <h1>Education Policy Modelling</h1>
    <p class="sub">
      A research-backed simulation of England's schools system. Move the policy levers — SEND &amp; EHCP
      reform, pupil premium, attendance, early years, the 6,500-teacher pledge, curriculum reform, school
      funding — and watch the disadvantage gap, attainment, the SEND deficit and NEET respond. Every effect
      size is sourced or flagged as an assumption.
    </p>
    <p class="disclaimer">
      ⓘ <b>Evidence-backed but a model, not an official forecast.</b> Every figure is sourced or labelled an
      explicit assumption — see <button class="inline-link" type="button" onclick={() => (tab = 'method')}>method,
      calculations &amp; sources</button> for full transparency. Built autonomously with Claude Code in combination
      with other AI models.
    </p>
  </header>

  <div class="toolbar">
    <div class="tb-grp" role="group" aria-label="Horizon">
      <span class="tb-lab">Horizon</span>
      <div class="seg">
        {#each [2030, 2035, 2040] as h}
          <button class:active={horizon === h} onclick={() => setHorizon(h)}>{h}</button>
        {/each}
      </div>
    </div>
    <div class="tb-grp">
      <span class="tb-lab">View</span>
      <button class="tgl" class:on={showBands} onclick={() => (showBands = !showBands)} title="Monte-Carlo P10–P90 uncertainty bands">
        Uncertainty {showBands ? 'on' : 'off'}
      </button>
    </div>
    <div class="tb-grp">
      <span class="tb-lab">Compare</span>
      {#if !compareB}
        <button class="tb-btn" onclick={pinAsB} title="Pin the current scenario as B, then change A to compare them">Pin current as B</button>
      {:else}
        <span class="cmp-badge"><i></i>B: {compareB.name}</span>
        <button class="tb-btn" onclick={swapAB} title="Swap A and B">⇄ Swap</button>
        <button class="tb-btn danger" onclick={clearCompare} title="Stop comparing">✕</button>
      {/if}
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-grp">
      <span class="tb-lab">Scenario</span>
      <SavedScenarios {saved} suggestedName={scenarioName} onSave={saveCurrentAs} onLoad={loadSavedScenario} onPin={pinSavedAsB} onDelete={deleteSaved} />
      <button class="tb-btn share" class:ok={copied} onclick={copyLink} title="Copy a shareable link that restores this exact scenario">
        {copied ? '✓ Copied' : '↗ Copy link'}
      </button>
      <button class="tb-btn" onclick={exportJson}>Export</button>
      <button class="tb-btn" onclick={importJson}>Import</button>
      <button class="tb-btn danger" onclick={resetAll}>Reset</button>
    </div>
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
        <span class="rail-sub">{railLeverCount} levers · ⓘ for evidence · | = announced policy</span>
      </div>
      <LeverRail {levers} onChange={setLever} onResetLever={resetLever} />
      <AgeIdentification {levers} onChange={setLever} onReset={resetAgeId} />
    </aside>

    <!-- The right column is pinned to the viewport and follows the long lever rail down the page;
         its head (scenario switcher + readout + tabs) stays visible while the charts scroll beneath. -->
    <main class="work-col">
      <div class="work-head">
        <div class="scen">
          <ScenarioBar activeName={activePreset} onApply={applyPreset} />
          <div class="opt-ctl" title="Set the annual budget, then click the 'Best value' preset (or drag this slider) to preview the gap-optimal allocation — then 'Apply to sliders'">
            <span class="oc-lab">Best-value budget</span>
            <input class="oc-slider" type="range" min="1" max="15" step="0.5" value={optimizeBudget}
                   oninput={(e) => (optimizeBudget = Number((e.currentTarget as HTMLInputElement).value))}
                   onchange={() => previewOptimize()} aria-label="Best-value optimiser budget" />
            <span class="oc-val">£{optimizeBudget.toFixed(1)}bn/yr</span>
          </div>
          {#if optimizeResult}
            <span class="opt-note-wrap" class:open={tipOpen}>
              <button class="opt-note" type="button" onclick={() => (tipOpen = !tipOpen)}
                      aria-expanded={tipOpen} title="Show the optimised allocation breakdown">
                {optimizeApplied ? '✓ applied:' : '◷ best £' + optimizeResult.budget.toFixed(1) + 'bn would'}
                close {optimizeResult.closed.toFixed(1)} mo of the gap ({optimizeResult.baselineGap.toFixed(1)}→{optimizeResult.gap.toFixed(1)})
                by {optimizeResult.horizon} for £{optimizeResult.cost.toFixed(1)}bn/yr <span class="tip-caret">▾</span>
              </button>
              <span class="opt-tip" role="tooltip">
                <span class="tip-head">Optimised allocation · £{optimizeResult.cost.toFixed(2)}bn/yr across {optimizeResult.breakdown.length} levers</span>
                {#each optimizeResult.breakdown as row (row.id)}
                  <span class="tip-row">
                    <i style="background:{row.colour}"></i>
                    <span class="tip-label">{row.label}</span>
                    <b>{row.display}</b>
                    <em>£{row.costBn.toFixed(2)}bn</em>
                  </span>
                {/each}
                {#if optimizeResult.budget - optimizeResult.cost > 0.05}
                  <span class="tip-foot">£{(optimizeResult.budget - optimizeResult.cost).toFixed(1)}bn of the £{optimizeResult.budget.toFixed(1)}bn budget left unspent — no remaining lever closes the gap at acceptable value.</span>
                {/if}
              </span>
            </span>
            <button class="opt-apply" onclick={applyOptimized} disabled={optimizeApplied}
                    title="Set every slider to this optimised allocation">
              {optimizeApplied ? '✓ Applied' : 'Apply to sliders →'}
            </button>
          {/if}
          {#if importErr}<span class="imp-err">Import failed: {importErr}</span>{/if}
        </div>

        <div class="readout-shell">
          {#if compareB && simB}
            <CompareReadout simA={sim.years} simB={simB.years} nameA={scenarioName} nameB={compareB.name} {horizon} />
          {:else}
            <ScenarioReadout sim={sim.years} baseSim={baseSim.years} {horizon} {scenarioName} />
          {/if}
        </div>

        <nav class="tabs">
          {#each TABS as t}
            <button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
          {/each}
        </nav>
      </div>

      <div class="work-scroll">
      {#if tab === 'outcomes'}
        <p class="tab-intro">
          {#if compareB}
            <b style="color:#9a3b2e">Scenario A</b> (your current levers) vs <b style="color:#3a5fa8">Scenario B</b>
            (pinned: {compareB.name}) — overlaid on each chart's headline metric. Use <b>⇄ Swap</b> or <b>✕</b> in the
            toolbar to swap or stop. The side-by-side table above gives every outcome for A, B and the difference.
          {:else}
            Solid line = your policy package; dashed grey = the status-quo (do-nothing) trajectory; dashed colour =
            disadvantaged pupils; green dashes = a government target. Pin a scenario as <b>B</b> in the toolbar to compare two side by side.
          {/if}
          The shaded band before {BASE_YEAR} is observed history; the blue <b>{horizon} ▸</b> marker tracks the horizon
          selector and drives each summary. Hover a chart and click <b>⤢</b> to expand it with its narrative for export.
          {#if showBands}Shaded fans are Monte-Carlo P10–P90 uncertainty.{/if}
        </p>
        <div class="chart-grid">
          {#each charts as c, i (c.title)}
            {@const sm = chartSummary(CHART_PRIMARY[c.title], sim.years, compareB && simB ? simB.years : baseSim.years, horizon, compareB && simB ? 'Scenario B' : 'status-quo path')}
            <div class="chart-cell">
              <button class="expand-btn" onclick={() => (expanded = i)} title="Expand chart with its narrative" aria-label="Expand {c.title}">⤢</button>
              <OutcomeChart title={c.title} unit={c.unit} years={allYears} series={c.series}
                            baseYear={BASE_YEAR} horizonYear={horizon} dp={c.dp} zeroBased={c.zeroBased} target={c.target} />
              <p class="chart-summary tone-{sm.tone}">{sm.text}</p>
            </div>
          {/each}
        </div>
      {:else if tab === 'population'}
        <PopulationPanel sim={sim.years} baseSim={baseSim.years} {horizon} {scenarioName}
                         compare={compareB && simB ? { sim: simB.years, name: compareB.name } : null} />
      {:else if tab === 'scorecard'}
        <Scorecard sim={sim.years} baseSim={baseSim.years} {horizon} />
      {:else if tab === 'cost'}
        <CostPanel sim={sim.years} baseSim={baseSim.years} {horizon} />
      {:else if tab === 'sensitivity'}
        <Sensitivity {levers} {horizon} />
      {:else if tab === 'method'}
        <Methodology />
      {/if}
      </div>
    </main>
  </div>

  {#if expanded !== null}
    {@const c = charts[expanded]}
    {@const sm = chartSummary(CHART_PRIMARY[c.title], sim.years, compareB && simB ? simB.years : baseSim.years, horizon, compareB && simB ? 'Scenario B' : 'status-quo path')}
    <ChartModal title={c.title} unit={c.unit} years={allYears} series={c.series} baseYear={BASE_YEAR}
                horizonYear={horizon} target={c.target} dp={c.dp} zeroBased={c.zeroBased ?? false}
                narrative={sm.text} onClose={() => (expanded = null)} />
  {/if}

  <footer class="foot">
    <details class="sources-foot">
      <summary>Sources ({SOURCES.length}) — every input is research-backed</summary>
      <ul>
        {#each SOURCES as s}
          <li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>
        {/each}
      </ul>
    </details>
    <p class="foot-disc">
      Education Policy Modelling · <code>/projects/policy-engine</code> · a decision-support tool, <b>not an official
      forecast</b>. Evidence-backed (see the {SOURCES.length} sources above and the Method &amp; calculations tab for
      every assumption and limitation), but figures are estimates. Built autonomously with Claude Code in combination
      with other AI models.
    </p>
  </footer>
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: #f1ead6; --paper-deep: #e7decc; --ink: #1c1611; --ink-soft: rgba(28,22,17,0.62);
    position: relative; min-height: 100vh; background:
      radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), var(--paper);
    color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif;
    /* clip (not hidden) so the sticky work column isn't trapped in a scroll container,
       while still preventing horizontal overflow. Falls back to hidden where clip is unsupported. */
    overflow-x: hidden; overflow-x: clip;
  }
  .paper-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }
  .head { position: relative; z-index: 1; max-width: 82ch; padding: 20px 28px 12px; }
  .back { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); text-decoration: none; }
  .back:hover { color: var(--ink); }
  .tagline { display: block; margin-top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; color: var(--ink-soft); text-transform: uppercase; }
  h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(26px, 4vw, 40px); line-height: 0.98; letter-spacing: -0.02em; margin: 5px 0 7px; }
  .sub { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink-soft); max-width: 78ch; }
  .disclaimer { margin: 8px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.66); max-width: 82ch; }
  .disclaimer b { color: var(--ink); }
  .inline-link { background: transparent; border: none; padding: 0; color: #2f6f97; cursor: pointer; font: inherit; border-bottom: 1px dashed currentColor; }
  .inline-link:hover { color: #1c4a66; }

  /* --- rethought control toolbar --- */
  .toolbar { position: relative; z-index: 1; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 9px 28px; background: rgba(28,22,17,0.04); border-top: 1px solid rgba(28,22,17,0.08); border-bottom: 1px solid rgba(28,22,17,0.08); }
  .tb-grp { display: inline-flex; align-items: center; gap: 6px; }
  .tb-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .tb-spacer { flex: 1; }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 6px; }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 5px 11px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; }
  .seg button.active { background: var(--ink); color: var(--paper); }
  .tgl { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); color: var(--ink); padding: 5px 10px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .tgl.on { background: #2f6f97; color: #fff; border-color: #2f6f97; }
  .tb-btn { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 5px 10px; color: var(--ink);
    font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em; cursor: pointer; }
  .tb-btn:hover { background: rgba(28,22,17,0.06); }
  .tb-btn.share { border-color: #2f6f97; color: #2f6f97; }
  .tb-btn.share.ok { border-color: #2f7d4f; color: #2f7d4f; }
  .tb-btn.danger { border-color: rgba(177,69,94,0.4); color: #b1455e; }
  .tb-btn.danger:hover { background: rgba(177,69,94,0.08); }
  .cmp-badge { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: #3a5fa8; background: rgba(58,95,168,0.1); border: 1px solid rgba(58,95,168,0.3); border-radius: 5px; padding: 4px 8px; }
  .cmp-badge i { width: 9px; height: 3px; border-radius: 2px; background: #3a5fa8; }

  .scen { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; }
  .readout-shell { margin-top: 8px; }
  .imp-err { color: #8a2d22; font-size: 11px; }
  .opt-note-wrap { position: relative; display: inline-block; }
  .opt-note {
    color: #2f7d4f; font-size: 11px; font-family: 'JetBrains Mono', monospace; background: none;
    border: none; padding: 0; cursor: pointer; text-align: left; line-height: 1.4;
  }
  .opt-note:hover { text-decoration: underline; text-decoration-style: dotted; }
  .tip-caret { font-size: 8px; opacity: 0.7; }
  .opt-tip {
    display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
    min-width: min(290px, calc(100vw - 28px)); max-width: min(360px, calc(100vw - 28px)); background: var(--paper-deep, #e7decc);
    border: 1px solid rgba(28,22,17,0.25); border-radius: 7px; padding: 9px 11px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18); flex-direction: column; gap: 3px;
  }
  .opt-note-wrap:hover .opt-tip, .opt-note-wrap.open .opt-tip { display: flex; }
  .tip-head { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12px; color: var(--ink); margin-bottom: 4px; }
  .tip-row { display: grid; grid-template-columns: 10px 1fr auto auto; align-items: baseline; gap: 7px; font-size: 11px; color: rgba(28,22,17,0.8); }
  .tip-row i { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
  .tip-label { min-width: 0; }
  .tip-row b { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--ink); white-space: nowrap; }
  .tip-row em { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-style: normal; color: #2f7d4f; white-space: nowrap; min-width: 52px; text-align: right; }
  .tip-foot { margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(28,22,17,0.14); font-size: 10px; line-height: 1.4; color: rgba(28,22,17,0.6); }
  .opt-apply {
    font-family: 'DM Sans', system-ui, sans-serif; font-size: 11px; padding: 4px 11px; border-radius: 14px;
    border: 1px solid #2f7d4f; background: #2f7d4f; color: #fff; cursor: pointer; white-space: nowrap;
  }
  .opt-apply:hover:not(:disabled) { background: #276b43; }
  .opt-apply:disabled { background: rgba(47,125,79,0.14); color: #2f7d4f; border-color: rgba(47,125,79,0.3); cursor: default; }
  .opt-ctl { display: inline-flex; align-items: center; gap: 7px; padding: 3px 9px; border: 1px solid rgba(47,125,79,0.35); border-radius: 14px; background: rgba(47,125,79,0.06); }
  .oc-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #2f7d4f; white-space: nowrap; }
  .oc-slider { -webkit-appearance: none; appearance: none; width: 96px; height: 4px; border-radius: 3px; background: rgba(47,125,79,0.25); outline: none; cursor: pointer; }
  .oc-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
  .oc-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; border: none; cursor: pointer; }
  .oc-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: #2f7d4f; white-space: nowrap; min-width: 64px; }
  .cliff {
    position: relative; z-index: 1; margin: 0; padding: 8px 28px; font-size: 12px; line-height: 1.45;
    background: rgba(177, 69, 94, 0.1); color: #8a2d3a; border-bottom: 1px solid rgba(177,69,94,0.25);
  }
  .cliff b { color: #6f2230; }

  /* Rail flows with the page — no independent scrollbar (per request). */
  .body { position: relative; z-index: 1; display: grid; grid-template-columns: 340px 1fr; gap: 0; align-items: start; }
  .rail-col { align-self: start; padding: 14px 14px 40px; border-right: 1px solid rgba(28,22,17,0.1); }
  .rail-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .rail-head span:first-child { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; }
  .rail-sub { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); letter-spacing: 0.02em; }

  /* Right column: pinned to the viewport, follows the long rail down the page. The head
     (scenario switcher + readout + tabs) stays visible; the charts scroll beneath it and
     dynamically fill the remaining viewport height, so there is no dead space beside the rail. */
  .work-col { min-width: 0; display: flex; flex-direction: column; }
  .work-head {
    position: sticky; top: 0; z-index: 6; background: var(--paper);
    border-bottom: 1px solid rgba(28,22,17,0.12); padding: 10px 22px 8px;
    box-shadow: 0 7px 16px -12px rgba(0,0,0,0.3);
  }
  .work-scroll { padding: 14px 22px 50px; min-width: 0; }
  @media (min-width: 981px) {
    .work-col { position: sticky; top: 0; height: 100vh; }
    .work-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  }
  /* More obvious tabs — boxed/segmented pills. */
  .tabs { display: flex; gap: 4px; margin: 8px 0 0; flex-wrap: wrap; background: rgba(28,22,17,0.06); padding: 4px; border-radius: 9px; }
  .tabs button { background: transparent; border: 1px solid transparent; padding: 7px 14px; font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--ink-soft); cursor: pointer; border-radius: 6px; transition: background 0.12s, color 0.12s; }
  .tabs button:hover { background: rgba(255,255,255,0.5); color: var(--ink); }
  .tabs button.active { background: var(--ink); color: var(--paper); font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
  .tab-intro { margin: 0 0 12px; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 100ch; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 12px; align-items: start; }
  .chart-cell { display: flex; flex-direction: column; position: relative; }
  .expand-btn { position: absolute; top: 6px; right: 8px; z-index: 3; width: 22px; height: 22px; border-radius: 5px;
    border: 1px solid rgba(28,22,17,0.18); background: rgba(255,255,255,0.7); color: rgba(28,22,17,0.6); cursor: pointer;
    font-size: 12px; line-height: 1; opacity: 0; transition: opacity 0.14s; padding: 0; }
  .chart-cell:hover .expand-btn, .expand-btn:focus-visible { opacity: 1; }
  .expand-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .chart-summary { margin: 5px 2px 0; font-size: 10.5px; line-height: 1.45; color: rgba(28,22,17,0.62); border-left: 2px solid rgba(28,22,17,0.18); padding-left: 7px; }
  .chart-summary.tone-good { border-left-color: #2f7d4f; }
  .chart-summary.tone-bad { border-left-color: #b1455e; }

  .foot { position: relative; z-index: 1; padding: 14px 28px 22px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: 3px; color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .foot-disc { margin: 10px 0 0; font-size: 11px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 96ch; }
  .foot-disc b { color: var(--ink-soft); }
  .sources-foot { font-size: 11.5px; }
  .sources-foot summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); padding: 4px 0; }
  .sources-foot summary:hover { color: var(--ink); }
  .sources-foot ul { margin: 8px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 4px 18px; list-style: square; }
  .sources-foot li { font-size: 11px; line-height: 1.4; color: rgba(28,22,17,0.7); }
  .sources-foot a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }

  /* Below the split-view breakpoint the rail stacks above the work column (single page scroll);
     the work-head still sticks to the viewport top, so the scenarios stay visible while scrolling. */
  @media (max-width: 980px) {
    .body { grid-template-columns: 1fr; }
    .rail-col { border-right: none; border-bottom: 1px solid rgba(28,22,17,0.1); }
    .toolbar { gap: 10px 14px; }
    .tb-spacer { flex-basis: 100%; height: 0; }
    .expand-btn { opacity: 1; }
  }
  @media (max-width: 600px) {
    .head { padding: 16px 14px 10px; }
    .toolbar { padding: 9px 14px; }
    .work-head { padding: 9px 14px 7px; }
    .work-scroll { padding: 14px 14px 40px; }
    .rail-col { padding: 14px 14px 30px; }
    .foot { padding: 14px 14px 22px; }
    .cliff { padding: 8px 14px; }
    h1 { font-size: clamp(22px, 7vw, 30px); }
    .tabs { gap: 3px; padding: 3px; }
    .tabs button { padding: 6px 10px; font-size: 12px; }
    .opt-ctl { flex-wrap: wrap; }
  }
</style>
