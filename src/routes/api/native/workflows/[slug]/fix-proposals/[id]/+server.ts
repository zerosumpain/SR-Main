import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import {
  acceptFixProposal,
  dismissFixProposal,
  listFixProposals,
  toFixProposalDTO,
  FixProposalNotFoundError,
  FixProposalNotPendingError,
} from '$lib/workflows/fix-proposals.server';
import { AmendOpError, WorkflowNotFoundError } from '$lib/canvas/amend.server';
import { NodeNotFoundError, SensitiveRefusalError } from '$lib/canvas/mutate.server';
import { nativeOpRefusal } from '$lib/workflows/native/amend.server';
import { currentGraphVersion, findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/native/workflows/:slug/fix-proposals/:id { action: 'accept' | 'dismiss' }
 * → { proposal, status, version, outcomes? }
 *
 * Accept applies the fix permanently through `acceptFixProposal` — the canvas
 * banner's own path: `applyAmendOps` update_node, a version bump and an audit
 * row. Before that it passes the phone's own screen: a heal that would switch
 * on a destructive tool (`allowDestructive`) is refused here, exactly as the
 * same edit would be refused at `/amend`; the canvas can still accept it.
 *
 *   404 — no such proposal on this workflow
 *   409 — already accepted or dismissed, or the step is gone
 *   422 { error, field? } — the phone may not apply this fix
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  let body: { action?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (body.action !== 'accept' && body.action !== 'dismiss') {
    return json({ error: "action must be 'accept' or 'dismiss'", field: 'action' }, { status: 422 });
  }

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  try {
    if (body.action === 'dismiss') {
      const proposal = await dismissFixProposal(workflow.id, params.id);
      return {
        proposal: toFixProposalDTO(proposal),
        status: proposal.status,
        version: await currentGraphVersion(workflow.id),
      };
    }

    const pending = (await listFixProposals(workflow.id)).find((p) => p.id === params.id);
    if (pending) {
      const refused = nativeOpRefusal([{ op: 'update_node', nodeId: pending.nodeId, config: { ...pending.changes } }]);
      if (refused) return json(refused, { status: 422 });
    }

    const { proposal, amend } = await acceptFixProposal(workflow.id, params.id);
    return {
      proposal: toFixProposalDTO(proposal),
      status: proposal.status,
      version: await currentGraphVersion(workflow.id),
      outcomes: amend.outcomes.map((o) => ({ op: o.op, summary: o.summary, ...(o.nodeId ? { nodeId: o.nodeId } : {}) })),
    };
  } catch (err) {
    if (err instanceof FixProposalNotFoundError || err instanceof WorkflowNotFoundError) {
      return json({ error: 'That fix is no longer on this workflow.' }, { status: 404 });
    }
    if (err instanceof FixProposalNotPendingError) {
      return json({ error: 'That fix has already been dealt with.' }, { status: 409 });
    }
    const cause = err instanceof AmendOpError ? err.cause : err;
    if (cause instanceof NodeNotFoundError) {
      return json({ error: 'That step no longer exists — dismiss the fix instead.' }, { status: 409 });
    }
    if (cause instanceof SensitiveRefusalError) {
      return json(
        { error: `This step holds what looks like a key in "${cause.fields[0]}", so it cannot be patched.`, field: cause.fields[0] },
        { status: 422 },
      );
    }
    throw err;
  }
});
