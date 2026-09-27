import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowSchedules, workflows } from '$lib/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';

/**
 * GET — list all workflow_schedules joined with their workflow name.
 * PATCH — toggle enabled; the Workflows worker reconciles the change.
 */
export const GET: RequestHandler = async () => {
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .orderBy(asc(workflowSchedules.workflowId));

  const wfIds = Array.from(new Set(schedules.map((s) => s.workflowId)));
  const wfs = wfIds.length
    ? await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(inArray(workflows.id, wfIds))
    : [];
  const nameById = Object.fromEntries(wfs.map((w) => [w.id, w.name]));

  return json({
    schedules: schedules.map((s) => ({
      id: s.id,
      workflowId: s.workflowId,
      workflowName: nameById[s.workflowId] ?? '(unknown)',
      type: s.type,
      expression: (s.config as { expression?: string } | null)?.expression ?? null,
      enabled: s.enabled,
      lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt,
    })),
  });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'invalid body');
  const { id, enabled } = body as { id?: unknown; enabled?: unknown };
  if (typeof id !== 'string' || typeof enabled !== 'boolean') {
    throw error(400, 'id (string) and enabled (boolean) required');
  }

  const [row] = await db
    .update(workflowSchedules)
    .set({ enabled })
    .where(eq(workflowSchedules.id, id))
    .returning();
  if (!row) throw error(404, 'schedule not found');

  // SR-Workflows reconciles this durable change within one minute.

  return json({ ok: true, id, enabled });
};
