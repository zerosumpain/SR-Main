// src/lib/home/presence/location-hold.server.ts
//
// The owner's location hold — storage, and the one call every non-owner
// surface makes before it draws the household. The rules are in
// ./location-hold (PURE). Kept in `app_settings` (one row, already granted to
// Main's runtime role): there is only ever one hold, the owner's.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { deleteSetting, getSetting, setSetting } from '$lib/server/models/settings';
import { isOwnerEmail } from '$lib/server/access';
import { listMembers, type HouseholdMember } from './members';
import { getHomePlace } from './places';
import { activeLabels } from './types';
import type { HouseholdPresence, LivePosition } from './household';
import {
  applyHold,
  heldReading,
  HOLD_JITTER_MAX_MS,
  isActive,
  readHold,
  type HeldHousehold,
  type LocationHold,
} from './location-hold';

export const HOLD_KEY = 'owner_location_hold';

/** The hold on now, or null — none set, run out, or unreadable (a failed read is no hold). */
export async function getHold(now = new Date()): Promise<LocationHold | null> {
  try {
    const hold = readHold(await getSetting(HOLD_KEY));
    return isActive(hold, now) ? hold : null;
  } catch (error) {
    console.warn('[location-hold] read failed:', (error as Error).message);
    return null;
  }
}

export async function setHold(hold: LocationHold): Promise<void> {
  await setSetting(HOLD_KEY, hold);
}

export async function clearHold(): Promise<void> {
  await deleteSetting(HOLD_KEY);
}

/** The owner's household rows: whoever a hold moves. */
export function ownerSubjects(members: readonly HouseholdMember[]): string[] {
  return members.filter((m) => m.email && isOwnerEmail(m.email)).map((m) => m.subject);
}

/** What anyone but the owner sees while a hold is on, ready to apply. Null with no hold. */
export interface HoldContext {
  apply<T>(input: {
    presence: readonly HouseholdPresence[];
    positions: readonly LivePosition[];
    recent?: ReadonlyMap<string, readonly T[]>;
  }): HeldHousehold<T>;
}

/**
 * Read the hold and everything a held card needs (home, the places a fix
 * there would fall in). Null when no hold is on, the owner has no household
 * row, or the places cannot be read — a hold that cannot be drawn faithfully
 * is not drawn, rather than drawn with a tell.
 */
export async function loadHoldContext(
  members?: readonly HouseholdMember[],
  now = new Date(),
  jitterMs = Math.floor(Math.random() * HOLD_JITTER_MAX_MS),
): Promise<HoldContext | null> {
  const hold = await getHold(now);
  if (!hold) return null;
  try {
    const subjects = ownerSubjects(members ?? (await listMembers()));
    if (!subjects.length) return null;
    const [home, rows] = await Promise.all([
      getHomePlace(),
      db
        .select({
          id: daydreamPlaces.id, lat: daydreamPlaces.lat, lon: daydreamPlaces.lon, radiusM: daydreamPlaces.radiusM,
          label: daydreamPlaces.label, suggestedLabel: daydreamPlaces.suggestedLabel, status: daydreamPlaces.status,
        })
        .from(daydreamPlaces)
        .where(eq(daydreamPlaces.status, 'active')),
    ]);
    const labels = activeLabels(rows);
    const reading = heldReading(hold, home, rows.map((p) => ({ ...p, label: labels.get(p.id) ?? null })));
    return {
      apply: (input) =>
        applyHold({ ...input, recent: input.recent ?? new Map() }, hold, subjects, reading, now, jitterMs),
    };
  } catch (error) {
    console.error('[location-hold] could not build the held view:', (error as Error).message);
    return null;
  }
}
