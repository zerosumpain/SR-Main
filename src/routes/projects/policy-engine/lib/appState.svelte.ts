// appState.svelte.ts — the shared, reactive application state for the (multi-page) policy engine.
// A single rune-backed store imported by the layout and every route page, so the scenario, horizon,
// region and comparison persist as you move between Overview / Build / Outcomes / Population / Regions
// / Method. DOM- and navigation-free (persistence + permalink live in +layout.svelte). Self-contained.

import { runSim } from './engine';
import { runMonteCarlo } from './montecarlo';
import { baselineLevers, policyLevers, LEVERS, AGE_BANDS, LEVERS_BY_ID } from './levers';
import { PRESETS, type Preset, makeSaved, type SavedScenario } from './scenarios';
import { regionalise, REGION_OPTIONS, regionScale } from './regions';
import { optimizeGapWithinBudget, allocationBreakdown, type AllocRow } from './optimize';
import type { LeverState, YearResult } from './types';

export interface OptimizeResult {
  baselineGap: number; gap: number; cost: number; closed: number; horizon: number;
  budget: number; breakdown: AllocRow[]; alloc: LeverState;
}

class AppState {
  // ---- core scenario state ----
  levers = $state<LeverState>(policyLevers());
  horizon = $state(2040);
  showBands = $state(true);   // uncertainty bands on by default
  region = $state('all');
  compareB = $state<{ levers: LeverState; name: string } | null>(null);
  saved = $state<SavedScenario[]>([]);
  mounted = $state(false);

  // ---- UI state ----
  narrative = $state<'research' | 'eli5'>('research');   // narrative register, site-wide
  drawerOpen = $state(false);                            // levers sidebar docked open
  drawerUserSet = $state(false);                         // user has manually opened/closed it (suppresses route default)
  toggleDrawer() { this.drawerOpen = !this.drawerOpen; this.drawerUserSet = true; }
  closeDrawer() { this.drawerOpen = false; this.drawerUserSet = true; }
  openDrawer() { this.drawerOpen = true; this.drawerUserSet = true; }
  showHelp = $state(false);                              // onboarding / how-to-use overlay

  // ---- optimiser ("Best value") ----
  optimizeBudget = $state(PRESETS.find((p) => p.optimize)?.budget ?? 5);
  optimizeResult = $state<OptimizeResult | null>(null);
  optimizeApplied = $state(false);

  // ---- engine runs ----
  sim = $derived(runSim(this.levers));
  baseSim = $derived(runSim(baselineLevers()));
  simB = $derived(this.compareB ? runSim(this.compareB.levers) : null);
  mc = $derived(this.showBands ? runMonteCarlo(this.levers, 110) : null); // lazy: only computes on pages that read it (Outcomes)

  // ---- geographic re-basing ----
  viewSim = $derived(this.region === 'all' ? this.sim.years : regionalise(this.sim.years, this.region, this.levers));
  viewBase = $derived(this.region === 'all' ? this.baseSim.years : regionalise(this.baseSim.years, this.region, baselineLevers()));
  viewSimB = $derived(!this.simB ? null : this.region === 'all' ? this.simB.years : regionalise(this.simB.years, this.region, this.compareB!.levers));
  regionName = $derived(REGION_OPTIONS.find((o) => o.code === this.region)?.name ?? 'England (all)');
  scale = $derived(regionScale(this.region));

  // ---- scenario identity ----
  activePreset = $derived(PRESETS.find((p) => this.eq(this.levers, p.levers))?.name ?? null);
  matchedSaved = $derived(this.saved.find((s) => this.eq(this.levers, s.levers))?.name ?? null);
  scenarioName = $derived(this.activePreset ?? this.matchedSaved ?? (this.optimizeApplied ? 'Optimised allocation' : 'Custom scenario'));
  scenarioDescription = $derived.by(() => {
    const eli = this.narrative === 'eli5';
    const p = PRESETS.find((x) => this.eq(this.levers, x.levers));
    if (p) return eli && p.eli5Desc ? p.eli5Desc : p.description;
    if (this.matchedSaved) return eli ? 'One of your saved setups. Open the Levers to see or change it.' : 'One of your saved scenarios. Open the Levers drawer to see or change its settings.';
    if (this.optimizeApplied && this.optimizeResult) return eli
      ? `The best mix the computer could find for about £${this.optimizeResult.budget.toFixed(1)}bn a year.`
      : `The budget-optimal allocation: the most disadvantage-gap closed for £${this.optimizeResult.budget.toFixed(1)}bn/yr, solved live against the engine.`;
    return eli ? 'Your own mix of policies. Pick a ready-made one above, or open the Levers to build it.' : 'A custom package — your own combination of levers. Pick a named stance, or open the Levers drawer to tune it.';
  });
  // ELI5-aware display name (the canonical scenarioName stays for matching/identity)
  scenarioDisplayName = $derived.by(() => {
    if (this.narrative !== 'eli5') return this.scenarioName;
    const p = PRESETS.find((x) => this.eq(this.levers, x.levers));
    if (p?.eli5Name) return p.eli5Name;
    if (this.matchedSaved) return this.matchedSaved;
    if (this.optimizeApplied) return 'Best mix found';
    return 'Your own mix';
  });

  insolvencyYear = $derived(this.sim.years.find((y) => y.insolvencyRisk)?.year ?? null);
  horizonDeficit = $derived(this.sim.years.find((y) => y.year === this.horizon)?.highNeedsDeficitStock ?? 0);

  eq(a: LeverState, b: LeverState): boolean {
    return LEVERS.every((l) => (a[l.id] ?? l.baseline) === (b[l.id] ?? l.baseline));
  }

  // ---- lever actions ----
  setLever(id: string, v: number) { this.optimizeResult = null; this.levers = { ...this.levers, [id]: v }; }
  resetLever(id: string) { this.optimizeResult = null; this.levers = { ...this.levers, [id]: LEVERS_BY_ID[id].baseline }; }
  resetAll() { this.optimizeResult = null; this.levers = policyLevers(); }
  resetAgeId() {
    this.optimizeResult = null;
    const next = { ...this.levers };
    for (const b of AGE_BANDS) next[b.leverId] = LEVERS_BY_ID[b.leverId].baseline;
    this.levers = next;
  }
  setHorizon(h: number) { this.horizon = h; if (this.optimizeResult) this.previewOptimize(); }

  applyPreset(p: Preset) {
    if (p.optimize) { this.previewOptimize(); }
    else { this.optimizeResult = null; this.levers = { ...p.levers }; }
  }

  // ---- optimiser ----
  previewOptimize() {
    const r = optimizeGapWithinBudget(this.optimizeBudget, this.horizon);
    this.optimizeResult = {
      baselineGap: r.baselineGap, gap: r.gap, cost: r.cost, closed: r.baselineGap - r.gap,
      horizon: this.horizon, budget: this.optimizeBudget,
      breakdown: allocationBreakdown(r.levers, this.horizon), alloc: r.levers,
    };
    this.optimizeApplied = false;
  }
  applyOptimized() { if (this.optimizeResult) { this.levers = { ...this.optimizeResult.alloc }; this.optimizeApplied = true; } }

  // ---- comparison ----
  pinAsB() { this.compareB = { levers: { ...this.levers }, name: this.scenarioName }; }
  clearCompare() { this.compareB = null; }
  swapAB() {
    if (!this.compareB) return;
    const prevB = this.compareB;
    this.compareB = { levers: { ...this.levers }, name: this.scenarioName };
    this.optimizeResult = null;
    this.levers = { ...prevB.levers };
  }

  // ---- saved scenarios ----
  saveCurrentAs(name: string) { this.saved = [makeSaved(name, this.levers), ...this.saved]; }
  deleteSaved(id: string) { this.saved = this.saved.filter((s) => s.id !== id); }
  loadSavedScenario(s: SavedScenario) { this.optimizeResult = null; this.levers = { ...s.levers }; }
  pinSavedAsB(s: SavedScenario) { this.compareB = { levers: { ...s.levers }, name: s.name }; }
}

export const app = new AppState();
