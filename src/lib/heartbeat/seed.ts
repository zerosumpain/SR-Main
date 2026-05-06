import { db } from '$lib/db';
import { heartbeatActivities } from '$lib/db/schema';
import { listHandlers } from './registry';

/**
 * On first boot, insert one row per known handler so the admin UI shows
 * the catalogue and the engine has rows to drive. Idempotent — only
 * inserts handlers whose `name` isn't already present.
 */
export async function seedDefaultActivities(): Promise<void> {
  const existing = await db.select({ name: heartbeatActivities.name }).from(heartbeatActivities);
  const existingNames = new Set(existing.map((r) => r.name));
  const handlers = listHandlers().filter((h) => !existingNames.has(h.name));
  if (handlers.length === 0) return;
  console.log(`[heartbeat] seeding ${handlers.length} default activities`);
  for (const h of handlers) {
    await db.insert(heartbeatActivities).values({
      name: h.name,
      description: h.description,
      cadenceSeconds: h.defaultCadenceSeconds,
      enabled: h.defaultEnabled,
      activeHoursStart: h.defaultActiveHours?.start ?? null,
      activeHoursEnd: h.defaultActiveHours?.end ?? null,
      activeHoursTz: h.defaultActiveHours?.tz ?? null,
      config: h.defaultConfig ?? {},
      // Schedule the first tick now+0 so the engine picks it up on the next loop.
      nextTickAt: new Date(),
    }).onConflictDoNothing({ target: heartbeatActivities.name });
  }
}
