import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { listFixProposals, toFixProposalDTO } from '$lib/workflows/fix-proposals.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * GET /api/native/workflows/:slug/fix-proposals → { proposals: [FixProposalDTO] }
 *
 * Pending self-heal fixes — heals whose retry succeeded and that nobody has
 * applied or dismissed. Same module and wire shape as the canvas banner's
 * `GET /api/workflows/:id/fix-proposals`; the detail carries the same list.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });
  const proposals = await listFixProposals(workflow.id);
  return { proposals: proposals.map(toFixProposalDTO) };
});
