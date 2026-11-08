import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { postProposals, phoneDecider } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * POST /api/native/trips/:id/proposals — v8: as the site's (`{ kind, target, nudge?, variant?, withDate?,
 * async? }` → `{ proposals }`). The creator or a parent; anyone else 403 (they suggest instead).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return postProposals(ft.trip, phoneDecider(ft), await event.request.json().catch(() => null));
});
