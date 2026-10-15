// src/lib/trips/settings-cache.server.ts
//
// The trips' small JSON caches in `app_settings` (as ./guidance.server keeps
// leg guidance): one row per key, read whole, written whole. No table of its
// own, so nothing new to grant the runtime role.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';

export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return ((row?.value as T | undefined) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Every row under a trip's own keys (`trips.<kind>.<tripId>`), when the trip is deleted. */
export async function deleteTripSettings(tripId: string, kinds: string[]): Promise<void> {
  for (const kind of kinds) await db.delete(appSettings).where(eq(appSettings.key, `trips.${kind}.${tripId}`));
}
