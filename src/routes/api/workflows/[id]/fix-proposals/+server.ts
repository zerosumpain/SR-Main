import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listFixProposals, toFixProposalDTO } from '$lib/workflows/fix-proposals.server';

/**
 * GET /api/workflows/:id/fix-proposals
 *
 * Pending self-heal fixes for this workflow — heals whose retry succeeded
 * during a run and that the owner has not yet applied or dismissed. Owner-only
 * through the /api gate in hooks.server.ts, like every /api/workflows route.
 */
export const GET: RequestHandler = async ({ params }) => {
  const proposals = await listFixProposals(params.id);
  return json({ proposals: proposals.map(toFixProposalDTO) });
};
