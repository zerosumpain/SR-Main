import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startRun } from '$lib/workflows/start-run';

/** POST /api/workflows/:id/run — the canvas Run button. Starts through the run kernel. */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const breakpointNodeIds: string[] = Array.isArray(body.breakpoints) ? body.breakpoints : [];
  const started = await startRun({
    workflowId: params.id,
    trigger: 'manual',
    input: body.input || {},
    breakpoints: breakpointNodeIds.length > 0 ? new Set<string>(breakpointNodeIds) : undefined,
    selfHealing: body.selfHealing !== false,
    label: 'run',
  });
  if (!started) return json({ error: 'Workflow not found' }, { status: 404 });
  return json({ runId: started.runId, status: started.status }, { status: 201 });
};
