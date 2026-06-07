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
  showBands = $state(false);
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
  mc = $derived(this.showBands ? runMonteCarlo(this.levers, 180) : null);

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
    const p = PRESETS.find((x) => this.eq(this.levers, x.levers));
    if (p) return p.description;
    if (this.matchedSaved) return `One of your saved scenarios. Open the Levers drawer to see or change its settings.`;
    if (this.optimizeApplied && this.optimizeResult) return `The budget-optimal allocation: the most disadvantage-gap closed for £${this.optimizeResult.budget.toFixed(1)}bn/yr, solved live against the engine.`;
    return 'A custom package — your own combination of levers. Pick a named stance, or open the Levers drawer to tune it.';
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
