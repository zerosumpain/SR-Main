import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { proposeAmendOps } from '$lib/workflows/build-from-prompt.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/native/workflows/:slug/ask { instruction }
 * → { summary, ops: AmendOp[], warnings: string[] }
 *
 * The model PROPOSES; nothing is applied. The phone shows the summary and the
 * ops in plain words, and applies them by POSTing the same ops to `/amend` —
 * where they meet the same screen they already passed here.
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  let body: { instruction?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 2000) : '';
  if (!instruction) return json({ error: 'Say what should change.', field: 'instruction' }, { status: 422 });

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  return proposeAmendOps(workflow.id, instruction);
});
