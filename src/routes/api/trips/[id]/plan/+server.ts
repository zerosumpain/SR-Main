import type { RequestHandler } from './$types';
import { ownerTrip, replanned } from '$lib/trips/api.server';

/** POST /api/trips/:id/plan — solve again now (e.g. after travel times were filled in). */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  return replanned(trip);
};
