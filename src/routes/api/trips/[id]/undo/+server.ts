import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { postUndo, siteDecider } from '$lib/trips/decisions.api.server';

/**
 * POST /api/trips/:id/undo — v8: `{ toVersion? }` (default: the version before the latest) → `{ planVersion,
 * changes, diff }` — a NEW version led by "Undone: …". 409 when that version has no snapshot.
 * Owner only (the site's session).
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  return postUndo(trip, siteDecider(owner, trip), await readJson(event));
};
