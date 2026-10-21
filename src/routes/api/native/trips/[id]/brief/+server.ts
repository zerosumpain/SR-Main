import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { patchBriefRoute, phoneDecider } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * PATCH /api/native/trips/:id/brief — v8: a `BriefPatch` → `{ brief, planVersion, changes }` (the
 * phone's brief). The creator or a parent; anyone else 403.
 */
export const PATCH: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return patchBriefRoute(ft.trip, phoneDecider(ft), await event.request.json().catch(() => null));
});
