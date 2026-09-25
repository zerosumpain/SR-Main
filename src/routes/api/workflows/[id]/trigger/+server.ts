import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveWorkflowTrigger } from '$lib/workflows/trigger-save.server';

/**
 * PUT /api/workflows/:id/trigger
 *
 * Body: { kind, cron?, timezone?, eventType?, sourceWorkflowId?, filter?, enabled?, secret? }
 *
 * The three-place sync (workflows.trigger, workflow_schedules, the trigger
 * node's config) and the live cron (un)registration live in
 * `$lib/workflows/trigger-save.server`, shared with the iPhone's native lane.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const result = await saveWorkflowTrigger(params.id, body ?? {});
  if (!result.ok) return json({ error: result.error }, { status: result.status });
  return json({ trigger: result.trigger });
};
