import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { postUndo, phoneDecider } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * POST /api/native/trips/:id/undo — v8: `{ toVersion? }` → `{ planVersion, changes, diff }`. The creator
 * or a parent; anyone else 403.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return postUndo(ft.trip, phoneDecider(ft), await event.request.json().catch(() => null));
});
