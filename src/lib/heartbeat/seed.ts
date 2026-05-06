import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { listHandlers } from './registry';

/**
 * On first boot, insert one row per known system-scan handler so the admin
 * UI shows the catalogue and the engine has rows to drive. Idempotent —
 * only inserts handlers whose `name` isn't already present.
 */
export async function seedDefaultActions(): Promise<void> {
  const existing = await db.select({ name: heartbeatActions.name }).from(heartbeatActions);
  const existingNames = new Set(existing.map((r) => r.name));
  const handlers = listHandlers().filter((h) => !existingNames.has(h.name));
  if (handlers.length === 0) return;
  console.log(`[heartbeat] seeding ${handlers.length} default actions`);
  for (const h of handlers) {
    await db.insert(heartbeatActions).values({
      name: h.name,
      description: h.description,
      kind: 'system-scan',
      cadenceSeconds: h.defaultCadenceSeconds,
      status: h.defaultEnabled ? 'active' : 'paused',
      source: 'system',
      activeHoursStart: h.defaultActiveHours?.start ?? null,
      activeHoursEnd: h.defaultActiveHours?.end ?? null,
      activeHoursTz: h.defaultActiveHours?.tz ?? null,
      config: h.defaultConfig ?? {},
      // Schedule the first run at now+0 so the engine picks it up on the next loop.
      nextRunAt: new Date(),
    }).onConflictDoNothing({ target: heartbeatActions.name });
  }
}
