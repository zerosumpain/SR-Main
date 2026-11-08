import type { RequestHandler } from './$types';
import { ownerTrip } from '$lib/trips/api.server';
import { getVersions } from '$lib/trips/decisions.api.server';

/**
 * GET /api/trips/:id/versions — v8: `{ versions: [{ version, source, createdAt, changes, restorable }] }`,
 * newest first.
 * Owner only (the site's session).
 */
export const GET: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  return getVersions(trip);
};
