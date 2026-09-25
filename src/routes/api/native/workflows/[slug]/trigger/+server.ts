import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { saveWorkflowTrigger, validTimezone } from '$lib/workflows/trigger-save.server';
import { findCanvas, loadWorkflowDetail } from '$lib/workflows/native/workflows.server';
import { nextRuns } from '$lib/workflows/native/dto';

/**
 * PUT /api/native/workflows/:slug/trigger
 *   { kind: 'manual' | 'cron', cron?, timezone?, enabled }
 * → { trigger: TriggerDTO }
 *
 * Saved by `saveWorkflowTrigger` — the body of the canvas's own trigger PUT —
 * so the column, the schedule row, the trigger node and the live cron job move
 * together. Webhook and event triggers carry secrets and cross-workflow wiring
 * and stay on the web.
 *
 * Pausing is `enabled: false`. The phone may leave `cron` out when it only
 * flips the switch; the stored expression is carried over.
 */
export const PUT: RequestHandler = withDevice(async ({ params, request }) => {
  let body: { kind?: unknown; cron?: unknown; timezone?: unknown; enabled?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (body.kind !== 'manual' && body.kind !== 'cron') {
    return json({ error: 'Only a manual or scheduled start can be set from the phone.', field: 'kind' }, { status: 422 });
  }
  if (body.timezone !== undefined && body.timezone !== null && !validTimezone(body.timezone)) {
    return json({ error: 'That is not a timezone.', field: 'timezone' }, { status: 422 });
  }

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  let cron = typeof body.cron === 'string' ? body.cron.trim() : '';
  let timezone = typeof body.timezone === 'string' ? body.timezone.trim() : undefined;
  if (body.kind === 'cron' && (!cron || timezone === undefined)) {
    const current = (await loadWorkflowDetail(workflow)).trigger;
    if (!cron) cron = current.cron ?? '';
    if (timezone === undefined && current.timezone) timezone = current.timezone;
  }
  if (body.kind === 'cron') {
    if (!cron) return json({ error: 'Choose when it should run.', field: 'cron' }, { status: 422 });
    if (nextRuns(cron, timezone ?? 'UTC', 1).length === 0) {
      return json({ error: 'That schedule never runs.', field: 'cron' }, { status: 422 });
    }
  }

  const saved = await saveWorkflowTrigger(workflow.id, {
    kind: body.kind,
    cron,
    timezone,
    enabled: body.enabled !== false,
  });
  if (!saved.ok) {
    return json({ error: saved.error }, { status: saved.status === 404 ? 404 : 422 });
  }
  const refreshed = await findCanvas(params.slug);
  return { trigger: (await loadWorkflowDetail(refreshed ?? workflow)).trigger };
});
