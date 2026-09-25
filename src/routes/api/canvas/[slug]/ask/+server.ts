import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { proposeAmendOps } from '$lib/workflows/build-from-prompt.server';
import { currentGraphVersion, findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/canvas/:slug/ask { instruction }
 * → { summary, ops, warnings, version }
 *
 * The canvas prompt bar. The model PROPOSES; nothing is applied — the same
 * `proposeAmendOps` the iPhone's /ask calls. `version` is the graph as it stood
 * when the proposal was made, so Apply can refuse if the canvas moved since.
 * Owner-only via the /api gate.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { instruction?: unknown };
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 2000) : '';
  if (!instruction) return json({ error: 'Say what should change.' }, { status: 422 });

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Canvas not found' }, { status: 404 });

  const version = await currentGraphVersion(workflow.id);
  const proposal = await proposeAmendOps(workflow.id, instruction);
  return json({ ...proposal, version });
};
