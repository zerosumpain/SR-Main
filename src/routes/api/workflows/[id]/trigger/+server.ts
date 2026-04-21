import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowSchedules } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { registerCronJob, unregisterCronJob } from '$lib/workflows/scheduler';
import { recordAudit } from '$lib/canvas/audit';

/**
 * PUT /api/workflows/:id/trigger
 *
 * Body: { kind, cron?, eventType?, sourceWorkflowId?, enabled? }
 *
 * Persists the trigger across three locations and keeps them in sync:
 *  - workflows.trigger                     — runtime metadata the
 *                                            webhook/scheduler endpoints
 *                                            read to decide whether to
 *                                            accept a fire.
 *  - workflowSchedules (cron / event)      — cron expression or event
 *                                            filter; the scheduler boots
 *                                            these on start.
 *  - the trigger node's config             — source of truth for the
 *                                            canvas inline menu; lets the
 *                                            user read back what's
 *                                            configured without hitting
 *                                            workflows.trigger directly.
 *
 * Live-registers or un-registers cron jobs so changes take effect
 * without a process restart.
 */
type TriggerKind = 'manual' | 'cron' | 'webhook' | 'event';

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const kindRaw = typeof body.kind === 'string' ? body.kind : 'manual';
  const kind: TriggerKind =
    kindRaw === 'cron' || kindRaw === 'webhook' || kindRaw === 'event' ? kindRaw : 'manual';
  const cron = typeof body.cron === 'string' ? body.cron.trim() : '';
  const eventType = typeof body.eventType === 'string' ? body.eventType : '';
  const sourceWorkflowId =
    typeof body.sourceWorkflowId === 'string' ? body.sourceWorkflowId : '';
  const enabled = body.enabled !== false;

  if (kind === 'cron' && !cron) {
    return json({ error: 'cron expression required when kind=cron' }, { status: 400 });
  }
  if (kind === 'event' && !eventType) {
    return json({ error: 'eventType required when kind=event' }, { status: 400 });
  }

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  // 1. Update workflows.trigger
  const triggerMetadata: Record<string, unknown> = { type: kind };
  if (kind === 'cron') triggerMetadata.cron = cron;
  if (kind === 'event') {
    triggerMetadata.eventType = eventType;
    if (sourceWorkflowId) triggerMetadata.sourceWorkflowId = sourceWorkflowId;
  }
  await db
    .update(workflows)
    .set({ trigger: triggerMetadata, updatedAt: new Date() })
    .where(eq(workflows.id, params.id));

  // 2. Clean up stale schedules for this workflow, live-unregister cron jobs
  const oldSchedules = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, params.id));
  for (const s of oldSchedules) {
    unregisterCronJob(s.id);
  }
  await db.delete(workflowSchedules).where(eq(workflowSchedules.workflowId, params.id));

  // 3. Recreate schedules for cron / event
  if (enabled && kind === 'cron') {
    const [sch] = await db
      .insert(workflowSchedules)
      .values({
        workflowId: params.id,
        type: 'cron',
        config: { expression: cron },
        enabled: true,
      })
      .returning();
    registerCronJob({ id: sch.id, workflowId: params.id, config: sch.config });
  } else if (enabled && kind === 'event') {
    const cfg: Record<string, unknown> = { eventType };
    if (sourceWorkflowId) cfg.sourceWorkflowId = sourceWorkflowId;
    await db.insert(workflowSchedules).values({
      workflowId: params.id,
      type: 'event',
      config: cfg,
      enabled: true,
    });
  }

  // 4. Mirror onto the trigger node's config so the canvas menu
  //    surfaces the same values without a second round-trip.
  const triggerNode = await db
    .select()
    .from(workflowNodes)
    .where(
      and(eq(workflowNodes.workflowId, params.id), eq(workflowNodes.type, 'trigger')),
    );
  const nodeConfig: Record<string, unknown> = { kind, enabled };
  if (cron) nodeConfig.cron = cron;
  if (eventType) nodeConfig.eventType = eventType;
  if (sourceWorkflowId) nodeConfig.sourceWorkflowId = sourceWorkflowId;
  for (const t of triggerNode) {
    await db.update(workflowNodes).set({ config: nodeConfig }).where(eq(workflowNodes.id, t.id));
  }

  await recordAudit({
    workflowId: params.id,
    entity: 'trigger',
    entityId: params.id,
    action: 'update',
    details: {
      old: (workflow.trigger as Record<string, unknown>) ?? null,
      new: {
        kind,
        cron: kind === 'cron' ? cron : null,
        eventType: kind === 'event' ? eventType : null,
        enabled,
      },
    },
  });

  return json({ trigger: triggerMetadata });
};
