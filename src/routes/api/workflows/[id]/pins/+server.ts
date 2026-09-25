import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPins, pinFromRun, removePin, samplePayload, setPin, TestRunError } from '$lib/workflows/test-runs.server';

/**
 * Pinned test data for a workflow's nodes.
 *
 * GET    → { pins: { [nodeId]: NodePin }, samplePayload }
 * PUT    { nodeId, fromRunId }        → pin what that step produced in that run
 * PUT    { nodeId, output, handle? }  → pin a hand-edited output
 * DELETE ?nodeId=                     → unpin
 */
const fail = (err: unknown) => {
  if (err instanceof TestRunError) return json({ error: err.message }, { status: err.status });
  throw err;
};

export const GET: RequestHandler = async ({ params }) => {
  const [pins, payload] = await Promise.all([listPins(params.id), samplePayload(params.id)]);
  return json({ pins, samplePayload: payload });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body.nodeId !== 'string') return json({ error: 'nodeId required' }, { status: 400 });
  try {
    const pin = typeof body.fromRunId === 'string'
      ? await pinFromRun(params.id, body.nodeId, body.fromRunId)
      : await setPin(params.id, body.nodeId, { output: body.output, handle: typeof body.handle === 'string' ? body.handle : null });
    return json({ pin });
  } catch (err) {
    return fail(err);
  }
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const nodeId = url.searchParams.get('nodeId');
  if (!nodeId) return json({ error: 'nodeId required' }, { status: 400 });
  return json({ removed: await removePin(params.id, nodeId) });
};
