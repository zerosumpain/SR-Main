import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { heartbeatActivities, heartbeatPulses } from '$lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { listHandlers } from '$lib/heartbeat/registry';
import { getRecentHeartbeatPulses } from '$lib/heartbeat/audit';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(heartbeatActivities).orderBy(heartbeatActivities.cadenceSeconds);

  // Aggregate counts per outcome for a quick at-a-glance summary.
  const counts = await db
    .select({
      activityId: heartbeatPulses.activityId,
      outcome: heartbeatPulses.outcome,
      c: sql<number>`count(*)::int`,
    })
    .from(heartbeatPulses)
    .where(sql`${heartbeatPulses.ts} > NOW() - INTERVAL '24 hours'`)
    .groupBy(heartbeatPulses.activityId, heartbeatPulses.outcome);

  const countsByActivity: Record<string, Record<string, number>> = {};
  for (const c of counts) {
    if (!countsByActivity[c.activityId]) countsByActivity[c.activityId] = {};
    countsByActivity[c.activityId][c.outcome] = c.c;
  }

  const handlerDefaults = Object.fromEntries(
    listHandlers().map((h) => [h.name, {
      description: h.description,
      defaultCadenceSeconds: h.defaultCadenceSeconds,
      defaultEnabled: h.defaultEnabled,
      defaultActiveHours: h.defaultActiveHours ?? null,
      defaultConfig: h.defaultConfig ?? {},
    }]),
  );

  return json({
    activities: rows.map((r) => ({
      ...r,
      handlerKnown: !!handlerDefaults[r.name],
      countsLast24h: countsByActivity[r.id] ?? {},
    })),
    handlerDefaults,
    recentPulses: getRecentHeartbeatPulses().slice(0, 50),
  });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'invalid body');
  const { id, ...patch } = body as Record<string, unknown>;
  if (typeof id !== 'string') throw error(400, 'id required');

  const allowed: Record<string, unknown> = {};
  if (typeof patch.enabled === 'boolean') allowed.enabled = patch.enabled;
  if (typeof patch.cadenceSeconds === 'number') {
    if (patch.cadenceSeconds < 30 || patch.cadenceSeconds > 86400) {
      throw error(400, 'cadenceSeconds must be between 30 and 86400');
    }
    allowed.cadenceSeconds = Math.round(patch.cadenceSeconds);
    // Re-anchor next_tick_at so the new cadence takes effect from now.
    allowed.nextTickAt = new Date(Date.now() + Math.round(patch.cadenceSeconds) * 1000);
  }
  if ('activeHoursStart' in patch) allowed.activeHoursStart = patch.activeHoursStart || null;
  if ('activeHoursEnd' in patch) allowed.activeHoursEnd = patch.activeHoursEnd || null;
  if ('activeHoursTz' in patch) allowed.activeHoursTz = patch.activeHoursTz || null;
  if (patch.config && typeof patch.config === 'object') allowed.config = patch.config;
  if (Object.keys(allowed).length === 0) throw error(400, 'no fields to update');
  allowed.updatedAt = new Date();

  const [row] = await db
    .update(heartbeatActivities)
    .set(allowed)
    .where(eq(heartbeatActivities.id, id))
    .returning();
  if (!row) throw error(404, 'activity not found');
  return json({ ok: true, activity: row });
};
