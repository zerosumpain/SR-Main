// LocalStorage persistence + JSON import/export for the strand config.
// No server-side calls; the visualisation is entirely client-driven.

import type { StrandConfig } from './types';

const STORAGE_KEY = 'data-convergence:config:v1';

/** Read the saved config, or return null if nothing has been saved yet. */
export function loadConfig(): StrandConfig[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateConfig(parsed);
  } catch {
    return null;
  }
}

/** Persist a config snapshot. Failures are swallowed (quota, private mode, …). */
export function saveConfig(config: StrandConfig[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

/** Clear saved config (used by "reset to defaults"). */
export function clearConfig() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Permissive validator — anything that smells right we accept; we coerce types. */
export function validateConfig(value: unknown): StrandConfig[] | null {
  if (!Array.isArray(value)) return null;
  const out: StrandConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    if (typeof r.startDate !== 'string' || typeof r.mergeDate !== 'string') continue;
    if (typeof r.mergeInto !== 'string') continue;
    out.push({
      id: r.id,
      name: r.name,
      colour: typeof r.colour === 'string' ? r.colour : '#888888',
      startDate: r.startDate,
      mergeDate: r.mergeDate,
      mergeInto: r.mergeInto,
      users: Number(r.users) || 0,
      frequency: Number(r.frequency) || 1,
      frequencyPeriod:
        r.frequencyPeriod === 'day' ||
        r.frequencyPeriod === 'week' ||
        r.frequencyPeriod === 'month' ||
        r.frequencyPeriod === 'quarter'
          ? r.frequencyPeriod
          : 'day',
    });
  }
  return out;
}

/** Pretty-printed JSON for the export blob. */
export function serialiseConfig(config: StrandConfig[]): string {
  return JSON.stringify(config, null, 2);
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
