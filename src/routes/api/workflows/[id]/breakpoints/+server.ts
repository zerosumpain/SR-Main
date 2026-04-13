import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engine } from '$lib/workflows';

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const { runId, nodeIds } = body;

  if (!runId || !Array.isArray(nodeIds)) {
    return json({ error: 'runId and nodeIds required' }, { status: 400 });
  }

  engine.setBreakpoints(runId, new Set<string>(nodeIds));
  return json({ ok: true, runId, nodeIds });
};
