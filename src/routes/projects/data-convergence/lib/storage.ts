// Scenario-aware persistence. V4 stores an array of named scenarios in
// localStorage, with one active at a time. Older v1/v2 single-bundle saves
// are silently migrated on first load.

import type { StrandConfig, OutputConfig, Cadence, Scenario, ScenarioStore } from './types';

const STORE_KEY = 'data-convergence:store:v4';
const LEGACY_V2_KEY = 'data-convergence:config:v2';
const LEGACY_V1_KEY = 'data-convergence:config:v1';

export function loadStore(): ScenarioStore | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return validateStore(parsed);
    }
    // Migration from legacy bundle keys.
    const legacy = localStorage.getItem(LEGACY_V2_KEY) ?? localStorage.getItem(LEGACY_V1_KEY);
    if (!legacy) return null;
    const bundle = JSON.parse(legacy);
    const strands = Array.isArray(bundle?.strands) ? bundle.strands.map(validateStrand).filter(Boolean) as StrandConfig[]
      : Array.isArray(bundle) ? bundle.map(validateStrand).filter(Boolean) as StrandConfig[]
      : [];
    const outputs = Array.isArray(bundle?.outputs) ? bundle.outputs.map(validateOutput).filter(Boolean) as OutputConfig[] : [];
    if (strands.length === 0) return null;
    const now = new Date().toISOString();
    const id = newId();
    return {
      activeId: id,
      scenarios: [{
        id,
        name: 'Saved scenario',
        strands,
        outputs,
        createdAt: now,
        updatedAt: now,
      }],
    };
  } catch {
    return null;
  }
}

export function saveStore(store: ScenarioStore) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function clearStore() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(LEGACY_V2_KEY);
    localStorage.removeItem(LEGACY_V1_KEY);
  } catch {
    // ignore
  }
}

export function validateStore(value: unknown): ScenarioStore | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.scenarios)) return null;
  const scenarios = v.scenarios.map(validateScenario).filter(Boolean) as Scenario[];
  if (scenarios.length === 0) return null;
  let activeId = typeof v.activeId === 'string' ? v.activeId : scenarios[0].id;
  if (!scenarios.some((s) => s.id === activeId)) activeId = scenarios[0].id;
  return { activeId, scenarios };
}

export function validateScenario(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const strands = Array.isArray(r.strands) ? r.strands.map(validateStrand).filter(Boolean) as StrandConfig[] : [];
  const outputs = Array.isArray(r.outputs) ? r.outputs.map(validateOutput).filter(Boolean) as OutputConfig[] : [];
  if (strands.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : undefined,
    strands,
    outputs,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  };
}

function validateStrand(raw: unknown): StrandConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (typeof r.startDate !== 'string' || typeof r.mergeDate !== 'string') return null;
  if (typeof r.mergeInto !== 'string') return null;
  const cadence: Cadence = (() => {
    const c = r.cadence;
    if (c === 'daily' || c === 'termly' || c === 'annual' || c === 'biannual' || c === 'adhoc' || c === 'continuous') return c;
    return 'annual';
  })();
  return {
    id: r.id,
    name: r.name,
    colour: typeof r.colour === 'string' ? r.colour : '#888888',
    startDate: r.startDate,
    mergeDate: r.mergeDate,
    mergeInto: r.mergeInto,
    users: Number(r.users) || 0,
    cadence,
    outputs: Array.isArray(r.outputs) ? (r.outputs as unknown[]).filter((x) => typeof x === 'string') as string[] : [],
    isReference: r.isReference === true,
    visible: r.visible !== false,
    schema: Array.isArray(r.schema) ? (r.schema as unknown[]).filter((x) => typeof x === 'string') as string[] : undefined,
  };
}

function validateOutput(raw: unknown): OutputConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: r.name,
    colour: typeof r.colour === 'string' ? r.colour : '#666666',
    side: r.side === 'above' || r.side === 'below' ? r.side : undefined,
    anchorDate: typeof r.anchorDate === 'string' ? r.anchorDate : undefined,
    visible: r.visible !== false,
  };
}

export function serialiseStore(store: ScenarioStore): string {
  return JSON.stringify(store, null, 2);
}

export function downloadJSON(filename: string, data: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Cryptographically-cheap unique id for new scenarios. */
export function newId(): string {
  return 'sc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
