// scenarios.ts — preset policy packages + scenario store (localStorage, import/export).
// Mirrors the data-convergence store pattern. Self-contained.

import type { LeverState, Scenario, ScenarioStore } from './types';
import { baselineLevers, policyLevers } from './levers';

const STORAGE_KEY = 'whitehall-model-v1';

function id(): string {
  return 'sc_' + Math.random().toString(36).slice(2, 9);
}
function nowIso(): string {
  return new Date().toISOString();
}

/** Build a lever state from the baseline with named overrides. */
function withOverrides(over: Record<string, number>): LeverState {
  return { ...baselineLevers(), ...over };
}

/** Preset packages — each is a defensible "stance" a government could take. */
export interface Preset { name: string; description: string; levers: LeverState; }

export const PRESETS: Preset[] = [
  {
    name: 'Status quo',
    description: 'Every lever at its do-nothing-new baseline. The gap drifts wider as disadvantaged absence persists and EHCP demand climbs into the funding cliff.',
    levers: baselineLevers(),
  },
  {
    name: 'Announced policy',
    description: 'Every lever set to what the government has actually announced or funded (the 2025/26 White Paper, Children’s Wellbeing Act, Best Start, 6,500 teachers).',
    levers: policyLevers(),
  },
  {
    name: 'Early-years first',
    description: 'Front-load the Heckman curve: maximum early-education quality, disadvantaged access and EYPP. Biggest long-run gap effect — but it arrives with an ~11-year lag.',
    levers: withOverrides({ ey_quality: 100, ey_access: 100, eypp: 1200, poverty_action: 60 }),
  },
  {
    name: 'Attendance blitz',
    description: 'Treat absence as the emergency it is: full attendance-mentor coverage plus universal breakfast clubs. Targets the single mechanism EPI blames for the entire post-2019 widening.',
    levers: withOverrides({ attendance: 100, breakfast: 100, poverty_action: 50 }),
  },
  {
    name: 'SEND rescue',
    description: 'Pour money into inclusive mainstream provision and early SEND support, lift the high-needs block, and reform EHCPs gently — bending the deficit before the 2028 override cliff.',
    levers: withOverrides({ inclusion_fund: 2.0, send_early: 90, ehcp_reform: 40, high_needs: 6 }),
  },
  {
    name: 'Standards drive',
    description: 'Bet on the supply side: deliver the 6,500 teachers, restore pay competitiveness, max shortage-subject bursaries, and push curriculum reform and RISE.',
    levers: withOverrides({ teachers: 3.5, teacher_pay: 2.0, bursaries: 100, curriculum: 100, rise: 100 }),
  },
  {
    name: 'EHCP squeeze (cautionary)',
    description: 'Reform EHCPs hard to cut the deficit, WITHOUT matching inclusion investment. Watch the deficit ease while SEND attainment falls and tribunals climb — the failure mode the sector warns of.',
    levers: withOverrides({ ehcp_reform: 100, inclusion_fund: 0.1, send_early: 20, high_needs: 0 }),
  },
  {
    name: 'Tackle NEET (Milburn)',
    description: 'Act on the Milburn review’s "generational fault line": maximum post-16/skills and youth mental-health support, with attendance and early intervention upstream. Bends the NEET curve away from 1.25m.',
    levers: withOverrides({ post16_skills: 100, mental_health: 100, attendance: 80, send_early: 70, poverty_action: 50 }),
  },
  {
    name: 'Austerity',
    description: 'Real-terms squeeze: pupil premium frozen below inflation, pay cut, high-needs held flat, funding falling. A stress test of the do-less direction.',
    levers: withOverrides({ pupil_premium: 1000, teacher_pay: -1, high_needs: -1, school_funding: -1.5, eypp: 400 }),
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

export function downloadJSON(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
