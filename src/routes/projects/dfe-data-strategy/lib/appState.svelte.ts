// appState.svelte.ts — the shared, reactive state for the Keystone workbench. A single
// rune-backed store imported by the layout and every route. Holds the editable strategy
// state, the A/B comparison, saved scenarios, uploaded-artefact syntheses and UI state.
// The alignment result is a $derived of the strategy state (recomputes on every change).
// DOM/navigation-free (persistence + permalink live in +layout.svelte).

import { runAlignment, defaultState } from './engine';
import { CAPABILITY_IDS } from './capabilities';
import {
  PRESETS,
  type Preset,
  type SavedScenario,
  makeSaved,
  sameStance,
  stateFromPreset,
} from './scenarios';
import type { Origin, StrategyState } from '$lib/dfe-data-strategy/types';
import type { PolicyDraft } from '$lib/dfe-data-strategy/policy';

/** What a "draft policies" suggester was opened for. */
export interface SuggestTarget {
  kind: 'strategy' | 'pressure' | 'stakeholder';
  id: string;
  label: string;
}

/** The synthesis of an uploaded Office artefact (returned by /synth). */
export interface UploadSynthesis {
  id: string;
  filename: string;
  kind: string;
  summary: string;
  maturitySignals: { dimension: string; level: number; note: string }[];
  addressedPressures: string[]; // pressure ids the document already speaks to
  nudges: { kind: 'posture' | 'allocation'; id: string; value: number; rationale: string }[];
  warnings?: string[];
  at: number;
}

class AppState {
  // ---- core strategy state ----
  state = $state<StrategyState>(defaultState());
  compareB = $state<{ state: StrategyState; name: string } | null>(null);
  saved = $state<SavedScenario[]>([]);
  basePreset = $state<string | null>('Status quo');
  mounted = $state(false);

  // ---- uploaded artefacts (workbench session only; never indexed) ----
  uploads = $state<UploadSynthesis[]>([]);

  // ---- policy builder (shared so the influence map / landscape can add to it) ----
  policies = $state<PolicyDraft[]>([]);
  suggestTarget = $state<SuggestTarget | null>(null);
  private _pc = 0;
  openSuggest(t: SuggestTarget) {
    this.suggestTarget = t;
  }
  closeSuggest() {
    this.suggestTarget = null;
  }
  /** Add a draft policy (from the composer or a suggester); returns its id. */
  addPolicyDraft(title: string, statement: string): string {
    this._pc += 1;
    const id = `p${this._pc}-${statement.replace(/\W+/g, '').slice(0, 8)}`;
    this.policies = [{ id, title: title.trim() || statement.slice(0, 60), statement: statement.trim(), status: 'draft', at: this._pc }, ...this.policies];
    return id;
  }
  removePolicy(id: string) {
    this.policies = this.policies.filter((p) => p.id !== id);
  }
  setPolicy(id: string, patch: Partial<PolicyDraft>) {
    const i = this.policies.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.policies[i] = { ...this.policies[i], ...patch };
      this.policies = [...this.policies];
    }
  }

  // ---- UI state ----
  narrative = $state<'research' | 'eli5'>('research');
  drawerMode = $state<'closed' | 'peek' | 'full'>('closed');
  drawerUserSet = $state(false);
  highlightArea = $state<string | null>(null);
  showHelp = $state(false);
  originFilter = $state<'all' | Origin>('all');

  get drawerOpen() {
    return this.drawerMode === 'full';
  }
  toggleDrawer() {
    this.drawerMode = this.drawerMode === 'full' ? 'closed' : 'full';
    this.drawerUserSet = true;
  }
  closeDrawer() {
    this.drawerMode = 'closed';
    this.drawerUserSet = true;
  }
  peekDrawer() {
    this.drawerMode = 'peek';
    this.drawerUserSet = true;
  }
  openDrawer() {
    this.drawerMode = 'full';
    this.drawerUserSet = true;
  }
  focusArea(id: string) {
    this.openDrawer();
    this.highlightArea = id;
  }

  // ---- engine runs (derived) ----
  align = $derived(runAlignment(this.state));
  alignB = $derived(this.compareB ? runAlignment(this.compareB.state) : null);

  allocTotal = $derived(CAPABILITY_IDS.reduce((s, id) => s + (this.state.allocation[id] ?? 0), 0));

  // ---- scenario identity ----
  activePreset = $derived(PRESETS.find((p) => sameStance(this.state, p))?.name ?? null);
  matchedSaved = $derived(this.saved.find((s) => sameStance(this.state, s.state))?.name ?? null);

  changedFromBase = $derived.by(() => {
    const base = PRESETS.find((p) => p.name === this.basePreset);
    if (!base) return 0;
    let n = 0;
    for (const id of Object.keys(base.postures)) if (Math.round((this.state.postures[id] ?? 0) * 10) !== Math.round((base.postures[id] ?? 0) * 10)) n++;
    for (const id of CAPABILITY_IDS) if (Math.round(this.state.allocation[id] ?? 0) !== Math.round(base.allocation[id] ?? 0)) n++;
    return n;
  });

  scenarioName = $derived.by(() => {
    if (this.activePreset) return this.activePreset;
    if (this.matchedSaved) return this.matchedSaved;
    const n = this.changedFromBase;
    if (this.basePreset && n > 0) return `${this.basePreset} +${n} change${n === 1 ? '' : 's'}`;
    return 'Custom strategy';
  });

  scenarioDescription = $derived.by(() => {
    const eli = this.narrative === 'eli5';
    const p = PRESETS.find((x) => sameStance(this.state, x));
    if (p) return eli && p.eli5Desc ? p.eli5Desc : p.description;
    if (this.matchedSaved) return eli ? 'One of your saved strategies. Open the Levers to change it.' : 'One of your saved strategies — open the Levers drawer to see or change its settings.';
    const n = this.changedFromBase;
    if (this.basePreset && n > 0)
      return eli
        ? `You started from “${this.basePreset}” and changed ${n} setting${n === 1 ? '' : 's'}.`
        : `Started from “${this.basePreset}” with ${n} change${n === 1 ? '' : 's'} — open the Levers to see what differs, or reset to the stance.`;
    return eli ? 'Your own mix. Pick a ready-made stance above, or open the Levers.' : 'A custom strategy — your own combination of postures and allocation. Pick a named stance, or open the Levers drawer to tune it.';
  });

  // ---- mutations ----
  setPosture(id: string, v: number) {
    this.state = { ...this.state, postures: { ...this.state.postures, [id]: v } };
  }
  setAllocation(id: string, v: number) {
    this.state = { ...this.state, allocation: { ...this.state.allocation, [id]: Math.max(0, v) } };
  }
  setMaturity(kind: 'current' | 'target', id: string, v: number) {
    const key = kind === 'current' ? 'maturityCurrent' : 'maturityTarget';
    this.state = { ...this.state, [key]: { ...this.state[key], [id]: v } } as StrategyState;
  }
  applyPreset(p: Preset) {
    this.basePreset = p.name;
    this.state = stateFromPreset(p, this.state); // keep the lead's maturity assessment
  }
  resetAll() {
    this.basePreset = 'Status quo';
    this.state = defaultState();
  }
  resetToBase() {
    const base = PRESETS.find((p) => p.name === this.basePreset);
    if (base) this.state = stateFromPreset(base, this.state);
  }

  // ---- comparison ----
  pinAsB() {
    this.compareB = { state: structuredClone($state.snapshot(this.state)), name: this.scenarioName };
  }
  clearCompare() {
    this.compareB = null;
  }
  swapAB() {
    if (!this.compareB) return;
    const prevB = this.compareB;
    this.compareB = { state: structuredClone($state.snapshot(this.state)), name: this.scenarioName };
    this.state = prevB.state;
    this.basePreset = null;
  }

  // ---- saved ----
  saveCurrentAs(name: string) {
    this.saved = [makeSaved(name, $state.snapshot(this.state)), ...this.saved];
  }
  deleteSaved(id: string) {
    this.saved = this.saved.filter((s) => s.id !== id);
  }
  loadSavedScenario(s: SavedScenario) {
    this.basePreset = null;
    this.state = structuredClone(s.state);
  }
  pinSavedAsB(s: SavedScenario) {
    this.compareB = { state: structuredClone(s.state), name: s.name };
  }

  // ---- uploaded artefact syntheses ----
  addUpload(u: UploadSynthesis) {
    this.uploads = [u, ...this.uploads];
  }
  removeUpload(id: string) {
    this.uploads = this.uploads.filter((u) => u.id !== id);
  }
  applyNudges(u: UploadSynthesis) {
    const next = structuredClone($state.snapshot(this.state));
    for (const n of u.nudges) {
      if (n.kind === 'posture') next.postures[n.id] = Math.max(-1, Math.min(1, n.value));
      else if (n.kind === 'allocation') next.allocation[n.id] = Math.max(0, n.value);
    }
    this.basePreset = null;
    this.state = next;
  }
}

export const app = new AppState();
