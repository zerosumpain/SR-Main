// Shared helpers for the /api/admin/datastore/* thin wrappers.
// Underscore-prefixed → ignored by SvelteKit routing (not an endpoint).
//
// All datastore admin routes act as the `owner` actor (the /api/admin/* prefix is
// owner-gated in hooks.server.ts) and map DatastoreError codes onto the pinned
// HTTP statuses: not_found→404, forbidden→403, validation→400, conflict→409,
// limit→413. Anything else is a 500.

import { json } from '@sveltejs/kit';
import { DatastoreError } from '$lib/datastore';
import type { DatastoreErrorCode } from '$lib/datastore';

export const ACTOR = 'owner';

export function statusForCode(code: DatastoreErrorCode): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'forbidden':
      return 403;
    case 'validation':
      return 400;
    case 'conflict':
      return 409;
    case 'limit':
      return 413;
    default:
      return 400;
  }
}

/** Turn any thrown value into a JSON error Response (DatastoreError → pinned status). */
export function datastoreErrorResponse(err: unknown): Response {
  if (err instanceof DatastoreError) {
    return json({ error: err.message, code: err.code }, { status: statusForCode(err.code) });
  }
  console.error('[admin/datastore] unexpected error:', err);
  return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
}
