import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { listHandlers } from '$lib/heartbeat/registry';
import { getRecentHeartbeatPulses } from '$lib/heartbeat/audit';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(heartbeatActions).orderBy(heartbeatActions.cadenceSeconds);

  // 24h pulse counts + cost per action.
  const counts = await db
    .select({
      actionId: heartbeatPulses.actionId,
      outcome: heartbeatPulses.outcome,
      c: sql<number>`count(*)::int`,
      cost: sql<string>`sum(${heartbeatPulses.costUsd})::text`,
    })
    .from(heartbeatPulses)
    .where(sql`${heartbeatPulses.ts} > NOW() - INTERVAL '24 hours'`)
    .groupBy(heartbeatPulses.actionId, heartbeatPulses.outcome);

  const countsByAction: Record<string, Record<string, number>> = {};
  const cost24hByAction: Record<string, number> = {};
  for (const c of counts) {
    if (!countsByAction[c.actionId]) countsByAction[c.actionId] = {};
    countsByAction[c.actionId][c.outcome] = c.c;
    cost24hByAction[c.actionId] = (cost24hByAction[c.actionId] ?? 0) + Number(c.cost ?? 0);
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
    actions: rows.map((r) => ({
      ...r,
      totalCostUsd: Number(r.totalCostUsd),
      handlerKnown: r.kind !== 'system-scan' || !!handlerDefaults[r.name],
      countsLast24h: countsByAction[r.id] ?? {},
      cost24hUsd: cost24hByAction[r.id] ?? 0,
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
  if (typeof patch.status === 'string' && ['active', 'paused', 'done', 'failed'].includes(patch.status)) {
    allowed.status = patch.status;
    if (patch.status === 'active') {
      // Re-anchor next_run_at so a paused-then-resumed action runs soon.
      allowed.nextRunAt = new Date(Date.now() + 1000);
    }
  }
  if (typeof patch.cadenceSeconds === 'number') {
    if (patch.cadenceSeconds < 30 || patch.cadenceSeconds > 86400) {
      throw error(400, 'cadenceSeconds must be between 30 and 86400');
    }
    allowed.cadenceSeconds = Math.round(patch.cadenceSeconds);
    allowed.nextRunAt = new Date(Date.now() + Math.round(patch.cadenceSeconds) * 1000);
  }
  if (typeof patch.goal === 'string') allowed.goal = patch.goal;
  if (typeof patch.prompt === 'string') allowed.prompt = patch.prompt;
  if ('activeHoursStart' in patch) allowed.activeHoursStart = patch.activeHoursStart || null;
  if ('activeHoursEnd' in patch) allowed.activeHoursEnd = patch.activeHoursEnd || null;
  if ('activeHoursTz' in patch) allowed.activeHoursTz = patch.activeHoursTz || null;
  if (patch.config && typeof patch.config === 'object') allowed.config = patch.config;
  if (Object.keys(allowed).length === 0) throw error(400, 'no fields to update');
  allowed.updatedAt = new Date();

  const [row] = await db
    .update(heartbeatActions)
    .set(allowed)
    .where(eq(heartbeatActions.id, id))
    .returning();
  if (!row) throw error(404, 'action not found');
  return json({ ok: true, action: row });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) throw error(400, 'id required');
  const [row] = await db.delete(heartbeatActions).where(eq(heartbeatActions.id, id)).returning();
  if (!row) throw error(404, 'action not found');
  return json({ ok: true, deleted: row.id });
};
