import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import type { AmendOp } from '$lib/canvas/amend.server';
import { applyNativeAmend } from '$lib/workflows/native/amend.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/native/workflows/:slug/amend { ops: AmendOp[], expectedVersion? }
 * → { version, outcomes: [{ op, summary, nodeId?, edgeId? }] }
 *
 * Every edit the phone makes — a step's settings, a rename, adding, removing,
 * rewiring — is one of the six `applyAmendOps` shapes, screened by the same
 * validator as the chat's `workflow_amend`. All or nothing.
 *
 *   409 { error, version }  — `expectedVersion` is not the graph as stored
 *   422 { error, field? }   — an op the validator or the phone's policy refuses
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  let body: { ops?: unknown; expectedVersion?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    return json({ error: 'Nothing to change.', field: 'ops' }, { status: 422 });
  }
  if (body.ops.length > 50) {
    return json({ error: 'Too many changes at once.', field: 'ops' }, { status: 422 });
  }

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  const result = await applyNativeAmend({
    workflowId: workflow.id,
    ops: body.ops as AmendOp[],
    expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
  });
  if (!result.ok) {
    const { status, ok: _ok, ...rest } = result;
    return json(rest, { status });
  }
  return { version: result.version, outcomes: result.outcomes };
});
