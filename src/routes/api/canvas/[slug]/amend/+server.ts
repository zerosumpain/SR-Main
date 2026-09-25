import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AmendOp } from '$lib/canvas/amend.server';
import { applyNativeAmend } from '$lib/workflows/native/amend.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/canvas/:slug/amend { ops, expectedVersion? }
 * → { version, outcomes }
 *
 * Applies a proposal the owner reviewed in the canvas prompt bar. The ops go
 * through the same screen as the chat's `workflow_amend` and the iPhone's
 * /amend (`validateAmendOps` + the no-destructive/no-credential refusals), then
 * `applyAmendOps` in one audited transaction with actor `owner`.
 *   409 — the canvas changed since the proposal was made
 *   422 — an op the validator refuses
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { ops?: unknown; expectedVersion?: unknown };
  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    return json({ error: 'Nothing to change.' }, { status: 422 });
  }
  if (body.ops.length > 50) return json({ error: 'Too many changes at once.' }, { status: 422 });

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Canvas not found' }, { status: 404 });

  const result = await applyNativeAmend({
    workflowId: workflow.id,
    ops: body.ops as AmendOp[],
    expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
    actor: 'owner',
  });
  if (!result.ok) {
    const { status, ok: _ok, ...rest } = result;
    return json(rest, { status });
  }
  return json({ version: result.version, outcomes: result.outcomes });
};
