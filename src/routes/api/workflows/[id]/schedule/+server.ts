import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowSchedules } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { reloadSchedule } from '$lib/workflows/scheduler';

export const GET: RequestHandler = async ({ params }) => {
  const [schedule] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, params.id))
    .limit(1);

  return json({ schedule: schedule ?? null });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();

  const { type, config, enabled = true } = body as {
    type: 'cron' | 'event';
    config: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!type || !config) throw error(400, 'type and config are required');

  // Upsert schedule — delete existing then insert
  await db.delete(workflowSchedules).where(eq(workflowSchedules.workflowId, params.id));

  const [schedule] = await db
    .insert(workflowSchedules)
    .values({ workflowId: params.id, type, config, enabled })
    .returning();

  // Hot-reload the cron job if it's a cron type
  if (type === 'cron') {
    await reloadSchedule(schedule.id);
  }

  return json({ schedule });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [existing] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, params.id))
    .limit(1);

  if (existing) {
    // Unregister cron job before deleting
    const { unregisterCronJob } = await import('$lib/workflows/scheduler');
    unregisterCronJob(existing.id);
    await db.delete(workflowSchedules).where(eq(workflowSchedules.id, existing.id));
  }

  return json({ success: true });
};
