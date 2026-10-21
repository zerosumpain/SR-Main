import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { postProposals, siteDecider } from '$lib/trips/decisions.api.server';

/**
 * POST /api/trips/:id/proposals — v8: `{ kind: 'swap'|'fill'|'day'|'nudge'|'shapes', target:
 * { stopId?, wishId?, date?, stage?, proposalId? }, nudge?, variant?, withDate?, async? }` → `{ proposals }`
 * (one stored group), from the research pack in a couple of seconds. No pack yet: 202 `{ job, note }` (the
 * live ideas search). `shapes`: 501 until the research work lands.
 * Owner only (the site's session).
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  return postProposals(trip, siteDecider(owner, trip), await readJson(event));
};
