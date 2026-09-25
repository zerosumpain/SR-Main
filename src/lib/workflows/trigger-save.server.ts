import { db } from '$lib/db';
import { workflows, workflowNodes, workflowSchedules } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { registerCronJob, unregisterCronJob } from '$lib/workflows/scheduler';
import { recordAudit } from '$lib/canvas/audit';
import { getWebhookSecret, type TriggerLike } from '$lib/workflows/webhook-secret';

/**
 * Save a workflow's trigger — the body of `PUT /api/workflows/:id/trigger`,
 * lifted out so the iPhone's `PUT /api/native/workflows/:slug/trigger` and the
 * describe-it builder write a schedule through the SAME three-place sync
 * rather than a second copy of it.
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
export type TriggerKind = 'manual' | 'cron' | 'webhook' | 'event';

export interface TriggerSaveInput {
  kind?: unknown;
  cron?: unknown;
  /**
   * IANA zone for a cron. Absent → the scheduler's default (`cronTimezone`),
   * exactly as before this field existed. Stored on the schedule row, which is
   * the only place `registerCronJob` reads it from.
   */
  timezone?: unknown;
  eventType?: unknown;
  sourceWorkflowId?: unknown;
  enabled?: unknown;
  secret?: unknown;
}

export type TriggerSaveResult =
  | { ok: true; trigger: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

/** A zone Intl accepts, or null. Unlike `cronTimezone` this does not fall back: a caller asked for it. */
export function validTimezone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return null;
  }
}

export async function saveWorkflowTrigger(
  workflowId: string,
  body: TriggerSaveInput,
): Promise<TriggerSaveResult> {
  const kindRaw = typeof body.kind === 'string' ? body.kind : 'manual';
  const kind: TriggerKind =
    kindRaw === 'cron' || kindRaw === 'webhook' || kindRaw === 'event' ? kindRaw : 'manual';
  const cron = typeof body.cron === 'string' ? body.cron.trim() : '';
  const eventType = typeof body.eventType === 'string' ? body.eventType : '';
  const sourceWorkflowId =
    typeof body.sourceWorkflowId === 'string' ? body.sourceWorkflowId : '';
  const enabled = body.enabled !== false;
  // D4 — optional webhook secret. When the caller sends a `secret` string we
  // honour it verbatim (empty string clears it); when the field is absent we
  // preserve whatever is already stored so unrelated trigger saves don't drop
  // the secret. Only meaningful for kind=webhook.
  const secretProvided = typeof body.secret === 'string';
  const secretInput = secretProvided ? (body.secret as string).trim() : '';

  const timezoneProvided = typeof body.timezone === 'string' && body.timezone.trim() !== '';
  const timezone = timezoneProvided ? validTimezone(body.timezone) : null;

  if (kind === 'cron' && !cron) {
    return { ok: false, status: 400, error: 'cron expression required when kind=cron' };
  }
  if (kind === 'cron' && timezoneProvided && !timezone) {
    return { ok: false, status: 400, error: `unknown timezone "${String(body.timezone)}"` };
  }
  if (kind === 'event' && !eventType) {
    return { ok: false, status: 400, error: 'eventType required when kind=event' };
  }

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!workflow) return { ok: false, status: 404, error: 'Workflow not found' };

  // Resolve the effective webhook secret: an explicit `secret` in the body wins
  // (empty string clears it); otherwise carry forward the stored value.
  const existingSecret = getWebhookSecret(workflow.trigger as TriggerLike | null);
  const secret = secretProvided ? secretInput : existingSecret;

  // 1. Update workflows.trigger
  const triggerMetadata: Record<string, unknown> = { type: kind };
  if (kind === 'cron') {
    triggerMetadata.cron = cron;
    if (timezone) triggerMetadata.timezone = timezone;
  }
  if (kind === 'event') {
    triggerMetadata.eventType = eventType;
    if (sourceWorkflowId) triggerMetadata.sourceWorkflowId = sourceWorkflowId;
  }
  // Secret is only carried for webhook triggers (dropped when switching kind).
  if (kind === 'webhook' && secret) triggerMetadata.secret = secret;
  await db
    .update(workflows)
    .set({ trigger: triggerMetadata, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));

  // 2. Clean up stale schedules for this workflow, live-unregister cron jobs
  const oldSchedules = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, workflowId));
  for (const s of oldSchedules) {
    unregisterCronJob(s.id);
  }
  await db.delete(workflowSchedules).where(eq(workflowSchedules.workflowId, workflowId));

  // 3. Recreate schedules for cron / event
  if (enabled && kind === 'cron') {
    const [sch] = await db
      .insert(workflowSchedules)
      .values({
        workflowId,
        type: 'cron',
        config: timezone ? { expression: cron, timezone } : { expression: cron },
        enabled: true,
      })
      .returning();
    registerCronJob({ id: sch.id, workflowId, config: sch.config });
  } else if (enabled && kind === 'event') {
    const cfg: Record<string, unknown> = { eventType };
    if (sourceWorkflowId) cfg.sourceWorkflowId = sourceWorkflowId;
    await db.insert(workflowSchedules).values({
      workflowId,
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
      and(eq(workflowNodes.workflowId, workflowId), eq(workflowNodes.type, 'trigger')),
    );
  const nodeConfig: Record<string, unknown> = { kind, enabled };
  if (cron) nodeConfig.cron = cron;
  if (kind === 'cron' && timezone) nodeConfig.timezone = timezone;
  if (eventType) nodeConfig.eventType = eventType;
  if (sourceWorkflowId) nodeConfig.sourceWorkflowId = sourceWorkflowId;
  // Mirror the secret so the canvas trigger panel can read it back and offer
  // copy / send-test without a second round-trip.
  if (kind === 'webhook' && secret) nodeConfig.secret = secret;
  for (const t of triggerNode) {
    await db.update(workflowNodes).set({ config: nodeConfig }).where(eq(workflowNodes.id, t.id));
  }

  await recordAudit({
    workflowId,
    entity: 'trigger',
    entityId: workflowId,
    action: 'update',
    details: {
      old: (workflow.trigger as Record<string, unknown>) ?? null,
      new: {
        kind,
        cron: kind === 'cron' ? cron : null,
        ...(kind === 'cron' && timezone ? { timezone } : {}),
        eventType: kind === 'event' ? eventType : null,
        enabled,
        // Record only whether a secret is set — never the value itself.
        hasSecret: kind === 'webhook' ? Boolean(secret) : false,
      },
    },
  });

  return { ok: true, trigger: triggerMetadata };
}
