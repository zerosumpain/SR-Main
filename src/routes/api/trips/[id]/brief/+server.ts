import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { patchBriefRoute, siteDecider } from '$lib/trips/decisions.api.server';

/**
 * PATCH /api/trips/:id/brief — v8: a `BriefPatch` (dates, destination, pace, modes, travellers, stay,
 * confirm, remove) → `{ brief, planVersion, changes }`; every fact it touches becomes the person's own.
 * Owner only (the site's session).
 */
export const PATCH: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  return patchBriefRoute(trip, siteDecider(owner, trip), await readJson(event));
};
