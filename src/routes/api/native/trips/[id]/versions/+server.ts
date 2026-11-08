import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { getVersions } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * GET /api/native/trips/:id/versions — v8: `{ versions: [{ version, source, createdAt, changes,
 * restorable }] }`. Any family member.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return getVersions(ft.trip);
});
