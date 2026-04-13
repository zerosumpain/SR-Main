import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engine } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const { nodeId, modifiedInput } = body;

  if (!nodeId) {
    return json({ error: 'nodeId required' }, { status: 400 });
  }

  const resolver = engine.getBreakpointResolver(params.runId, nodeId);
  if (!resolver) {
    return json({ error: 'No breakpoint found for this node in this run' }, { status: 404 });
  }

  engine.resumeBreakpoint(params.runId, nodeId, modifiedInput);
  return json({ ok: true });
};
