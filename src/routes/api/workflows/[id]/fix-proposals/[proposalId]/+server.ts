import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  acceptFixProposal,
  dismissFixProposal,
  toFixProposalDTO,
  FixProposalNotFoundError,
  FixProposalNotPendingError,
} from '$lib/workflows/fix-proposals.server';
import { AmendOpError, WorkflowNotFoundError } from '$lib/canvas/amend.server';
import { NodeNotFoundError, SensitiveRefusalError } from '$lib/canvas/mutate.server';

/**
 * POST /api/workflows/:id/fix-proposals/:proposalId  { action: 'accept' | 'dismiss' }
 *
 * Accept applies the fix through applyAmendOps (update_node): the node's version
 * bumps and an audit row is written with actor `owner`. Dismiss records the
 * verdict so the same fix is not proposed again. Owner-only via the /api gate.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action;
  if (action !== 'accept' && action !== 'dismiss') {
    return json({ error: "action must be 'accept' or 'dismiss'" }, { status: 400 });
  }

  try {
    if (action === 'dismiss') {
      const proposal = await dismissFixProposal(params.id, params.proposalId);
      return json({ proposal: toFixProposalDTO(proposal), status: proposal.status });
    }
    const { proposal, amend } = await acceptFixProposal(params.id, params.proposalId);
    return json({
      proposal: toFixProposalDTO(proposal),
      status: proposal.status,
      outcomes: amend.outcomes.map((o) => ({ op: o.op, summary: o.summary, nodeId: o.nodeId })),
    });
  } catch (err) {
    if (err instanceof FixProposalNotFoundError || err instanceof WorkflowNotFoundError) {
      return json({ error: err.message }, { status: 404 });
    }
    if (err instanceof FixProposalNotPendingError) {
      return json({ error: err.message }, { status: 409 });
    }
    const cause = err instanceof AmendOpError ? err.cause : err;
    if (cause instanceof NodeNotFoundError) {
      return json({ error: 'That step no longer exists on this canvas — dismiss the fix instead.' }, { status: 409 });
    }
    if (cause instanceof SensitiveRefusalError) {
      return json(
        { error: `This step's config holds a credential (${cause.fields.join(', ')}), so it cannot be patched.`, fields: cause.fields },
        { status: 422 },
      );
    }
    throw err;
  }
};
