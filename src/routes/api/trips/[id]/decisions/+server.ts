import type { RequestHandler } from './$types';
import { ownerTrip } from '$lib/trips/api.server';
import { getDecisions, siteDecider } from '$lib/trips/decisions.api.server';

/**
 * GET /api/trips/:id/decisions — v8: the brief (with where each fact came from), the open
 * questions and proposals, and the research pack's summary (./decisions.bundle.server `DecisionsWire`).
 * Owner only (the site's session).
 */
export const GET: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  return getDecisions(trip, siteDecider(owner, trip));
};
