import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startRun } from '$lib/workflows/start-run';
import { startTestRun, TestRunError } from '$lib/workflows/test-runs.server';

/**
 * POST /api/workflows/:id/run — the canvas Run button. Starts through the run kernel.
 *
 * `mode: 'test'` starts a TEST run instead: pins apply, side effects are stubbed
 * (bar `allowSideEffects` node ids), `input` defaults to a sample payload, and
 * `fromNodeId` runs that node and everything downstream with the rest seeded
 * from the latest run ("Run from here").
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : undefined;
  if (body.mode === 'test') {
    try {
      const started = await startTestRun({
        workflowId: params.id,
        input,
        allowSideEffects: Array.isArray(body.allowSideEffects) ? body.allowSideEffects.filter((x: unknown) => typeof x === 'string') : [],
        fromNodeId: typeof body.fromNodeId === 'string' ? body.fromNodeId : undefined,
      });
      if (!started) return json({ error: 'Workflow not found' }, { status: 404 });
      return json({ runId: started.runId, status: started.status, mode: 'test' }, { status: 201 });
    } catch (err) {
      if (err instanceof TestRunError) return json({ error: err.message }, { status: err.status });
      throw err;
    }
  }
  const breakpointNodeIds: string[] = Array.isArray(body.breakpoints) ? body.breakpoints : [];
  const started = await startRun({
    workflowId: params.id,
    trigger: 'manual',
    input: input ?? {},
    breakpoints: breakpointNodeIds.length > 0 ? new Set<string>(breakpointNodeIds) : undefined,
    selfHealing: body.selfHealing !== false,
    label: 'run',
  });
  if (!started) return json({ error: 'Workflow not found' }, { status: 404 });
  return json({ runId: started.runId, status: started.status }, { status: 201 });
};
