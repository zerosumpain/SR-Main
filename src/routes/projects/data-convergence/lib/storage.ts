// LocalStorage persistence + JSON import/export.
//
// V2 keeps strands + outputs together as a single bundle.

import type { StrandConfig, OutputConfig, Cadence } from './types';

const STORAGE_KEY = 'data-convergence:config:v2';

export interface ConfigBundle {
  strands: StrandConfig[];
  outputs: OutputConfig[];
}

export function loadConfig(): ConfigBundle | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateBundle(parsed);
  } catch {
    return null;
  }
}

export function saveConfig(bundle: ConfigBundle) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    // ignore
  }
}

export function clearConfig() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function validateBundle(value: unknown): ConfigBundle | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const strands = Array.isArray(v.strands) ? v.strands.map(validateStrand).filter(Boolean) as StrandConfig[] : [];
  const outputs = Array.isArray(v.outputs) ? v.outputs.map(validateOutput).filter(Boolean) as OutputConfig[] : [];
  if (strands.length === 0) return null;
  return { strands, outputs };
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
  };
}

export function serialiseConfig(bundle: ConfigBundle): string {
  return JSON.stringify(bundle, null, 2);
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
