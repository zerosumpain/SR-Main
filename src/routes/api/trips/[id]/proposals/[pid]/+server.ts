import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { postProposalDecision, siteDecider } from '$lib/trips/decisions.api.server';

/**
 * POST /api/trips/:id/proposals/:pid — v8: `{ action: 'accept' }` → `{ proposal, planVersion, changes,
 * diff, undo: { toVersion } }`, or `{ action: 'reject', reason, note? }` → `{ proposal }`. 409 when it is no
 * longer open; 409 `{ stale: true, proposal }` when the plan moved on and the re-check differs (show the
 * new difference, then accept again).
 * Owner only (the site's session).
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  return postProposalDecision(trip, siteDecider(owner, trip), event.params.pid, await readJson(event));
};
