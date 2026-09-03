// src/lib/daydream/effort.server.ts
//
// The owner's effort shares, in `app_settings`. Read by every activity the
// dial reaches, once per tick; a missing or malformed value is the default,
// never an error — an engine that stops because a slider was mis-saved is
// worse than one that runs at the shipped numbers.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { clampEffort, resolveEffort, type Effort, type ResolvedEffort } from './effort';

export const SETTINGS_EFFORT_KEY = 'daydream.effort';

export async function loadEffort(): Promise<Effort> {
  try {
    return clampEffort(await getSetting<Partial<Effort>>(SETTINGS_EFFORT_KEY));
  } catch {
    return clampEffort(null);
  }
}

export async function loadResolvedEffort(): Promise<ResolvedEffort> {
  return resolveEffort(await loadEffort());
}

export async function setEffort(raw: Partial<Effort>): Promise<Effort> {
  const next = clampEffort({ ...(await loadEffort()), ...raw });
  await setSetting(SETTINGS_EFFORT_KEY, next);
  return next;
}
