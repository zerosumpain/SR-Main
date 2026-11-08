import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { postProposalDecision, phoneDecider } from '$lib/trips/decisions.api.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * POST /api/native/trips/:id/proposals/:pid — v8: accept (`{ action: 'accept' }`) or turn down
 * (`{ action: 'reject', reason, note? }`), as the site's. The creator or a parent; anyone else 403.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  return postProposalDecision(ft.trip, phoneDecider(ft), event.params.pid, await event.request.json().catch(() => null));
});
