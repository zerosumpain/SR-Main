import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/native/workflows/:slug/run { input? } → 202 { runId }
 *
 * Started by the `workflow_run` tool through the site-tool seam, which starts
 * it through the run kernel (`$lib/workflows/start-run`) like every other path.
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  let input: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      const body = JSON.parse(text) as { input?: unknown };
      if (body?.input && typeof body.input === 'object' && !Array.isArray(body.input)) {
        input = body.input as Record<string, unknown>;
      }
    } catch {
      return json({ error: 'Expected a JSON body.' }, { status: 400 });
    }
  }

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  const res = await executeSiteTool('workflow_run', { id: workflow.id, input });
  const runId = (res.data as { runId?: unknown } | undefined)?.runId;
  if (!res.success || typeof runId !== 'string') {
    console.error(`[native] run of ${params.slug} did not start: ${res.error ?? 'no runId'}`);
    return json({ error: 'The run did not start.' }, { status: 500 });
  }
  return json({ runId }, { status: 202 });
});
