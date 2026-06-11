// scenarios.ts — preset policy packages + scenario store (localStorage, import/export).
// Mirrors the data-convergence store pattern. Self-contained.

import type { LeverState, Scenario, ScenarioStore } from './types';
import { baselineLevers, policyLevers, LEVERS } from './levers';

const STORAGE_KEY = 'whitehall-model-v1';

function id(): string {
  return 'sc_' + Math.random().toString(36).slice(2, 9);
}
function nowIso(): string {
  return new Date().toISOString();
}

/** Preset packages — each is a defensible "stance" a government could take.
 *  `optimize` presets are computed live (against the engine) when applied: a greedy
 *  allocator maximises gap closure within the fixed annual `budget` (see lib/optimize.ts). */
export interface Preset { name: string; description: string; levers: LeverState; optimize?: boolean; budget?: number; eli5Name?: string; eli5Desc?: string; }

export const PRESETS: Preset[] = [
  {
    name: 'Status quo',
    eli5Name: 'Do nothing new',
    eli5Desc: 'Change nothing. The gap slowly gets worse as poorer kids keep missing school and special-needs costs pile up.',
    description: 'Every lever at its do-nothing-new baseline. The gap drifts wider as disadvantaged absence persists and EHCP demand climbs into the funding cliff.',
    levers: baselineLevers(),
  },
  {
    name: 'Announced policy',
    eli5Name: 'What the government promised',
    eli5Desc: 'Everything set to what the government has actually announced — the 2026 schools plans, special-needs reforms, free breakfasts and 6,500 teachers.',
    description: 'Every lever set to what the government has actually announced or funded (the 2025/26 White Paper, Children’s Wellbeing Act, Best Start, 6,500 teachers).',
    levers: policyLevers(),
  },
  {
    name: 'Best value',
    eli5Name: 'Best value per pound',
    eli5Desc: 'Spends a set budget on whatever closes the gap the most — the computer works out the best mix for the money, and skips poor-value spending.',
    description: 'Maximises closure of the disadvantage gap within the budget you set on the Best-value slider in the Levers drawer. A greedy optimiser allocates that budget to the levers the model rates most gap-efficient — attendance, early years, RISE, poverty action, FSM — and skips ones it can’t bank on (e.g. Pupil Premium, whose £→gap link is unproven in the evidence). Re-solved live to the selected budget and horizon, and only as good as those assumptions.',
    levers: baselineLevers(),
    optimize: true,
    budget: 5,
  },
];

// ----------------------------- store -----------------------------

export function buildScenario(name: string, levers: LeverState, description = ''): Scenario {
  const ts = nowIso();
  return { id: id(), name, description, levers: { ...levers }, createdAt: ts, updatedAt: ts };
}

export function defaultStore(): ScenarioStore {
  const baseline = buildScenario('My scenario', policyLevers(), 'Start from announced policy and adjust.');
  return { activeId: baseline.id, scenarios: [baseline] };
}

export function loadStore(): ScenarioStore | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateStore(JSON.parse(raw));
  } catch { return null; }
}

export function saveStore(store: ScenarioStore): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

export function clearStore(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function validateStore(obj: unknown): ScenarioStore | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.scenarios) || typeof o.activeId !== 'string') return null;
  const scenarios = (o.scenarios as unknown[]).filter((s): s is Scenario => {
    if (!s || typeof s !== 'object') return false;
    const sc = s as Record<string, unknown>;
    return typeof sc.id === 'string' && typeof sc.name === 'string' && !!sc.levers && typeof sc.levers === 'object';
  });
  if (scenarios.length === 0) return null;
  const activeId = scenarios.some((s) => s.id === o.activeId) ? (o.activeId as string) : scenarios[0].id;
  return { activeId, scenarios };
}

export function serialiseStore(store: ScenarioStore): string {
  return JSON.stringify(store, null, 2);
}

// ----------------------------- saved (named) scenarios -----------------------------
// A user-managed library of named scenarios, persisted to localStorage.

export interface SavedScenario { id: string; name: string; levers: LeverState; createdAt: string; }
const SAVED_KEY = 'epm-saved-scenarios-v1';

export function makeSaved(name: string, levers: LeverState): SavedScenario {
  return { id: 'sv_' + Math.random().toString(36).slice(2, 9), name: name.trim().slice(0, 60), levers: { ...levers }, createdAt: new Date().toISOString() };
}

export function loadSaved(): SavedScenario[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is SavedScenario =>
      s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' && !!s.levers && typeof s.levers === 'object');
  } catch { return []; }
}

export function persistSaved(list: SavedScenario[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function downloadJSON(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------- shareable permalink -----------------------------
// The lever state is encoded into the URL hash (`#s=<token>`) as a versioned,
// base64url-encoded payload containing only the levers that differ from baseline,
// so a typical scenario produces a short link. Decoding applies the payload onto
// the baseline (missing levers = baseline) and clamps every value to its range,
// so links stay robust if levers are added, removed or re-bounded later.

const PERMALINK_VERSION = 1;

function b64urlEncode(s: string): string {
  const b64 = typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
}

/** Encode a lever state to a compact URL-hash token (only the deltas from baseline). */
export function encodeLevers(levers: LeverState): string {
  const l: Record<string, number> = {};
  for (const lev of LEVERS) {
    const v = levers[lev.id];
    if (v !== undefined && v !== lev.baseline) l[lev.id] = v;
  }
  return b64urlEncode(JSON.stringify({ v: PERMALINK_VERSION, l }));
}

/** Decode a URL-hash token back to a full lever state (baseline + decoded deltas), or null. */
export function decodeLevers(token: string): LeverState | null {
  try {
    const obj = JSON.parse(b64urlDecode(token));
    if (!obj || typeof obj !== 'object' || !obj.l || typeof obj.l !== 'object') return null;
    const out = baselineLevers();
    for (const lev of LEVERS) {
      const raw = (obj.l as Record<string, unknown>)[lev.id];
      if (typeof raw === 'number' && isFinite(raw)) {
        out[lev.id] = Math.min(lev.max, Math.max(lev.min, raw));
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Read the `s=` token out of a location hash (`#s=…` or `#…&s=…`). */
export function tokenFromHash(hash: string): string | null {
  const m = hash.match(/(?:^#|[#&])s=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
