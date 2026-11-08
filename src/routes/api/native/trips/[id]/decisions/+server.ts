import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { getDecisions, phoneDecider } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * GET /api/native/trips/:id/decisions — v8: the brief (no memory text on the phone), the open questions
 * this caller may answer, the open proposals they may act on (editors only), the research pack's summary.
 * Any family member.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return getDecisions(ft.trip, phoneDecider(ft));
});
