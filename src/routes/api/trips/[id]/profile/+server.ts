import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip } from '$lib/trips/api.server';
import { gatherProfile } from '$lib/trips/profile.server';

/**
 * POST /api/trips/:id/profile — gather "What I know about you" again from the
 * owner's JKAI memory, knowledge and family roster (v3). Owner only; what was
 * said in this trip's conversation is kept.
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const profile = await gatherProfile(trip, { asOwner: true, ownerEmail: owner });
  return json({ profile });
};
