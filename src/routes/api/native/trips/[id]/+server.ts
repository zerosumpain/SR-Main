import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { etagMatches } from '$lib/trips/bundle';
import { familyTrip, tripCreator } from '$lib/trips/family.server';
import { tripBundle } from '$lib/trips/plan.server';

/**
 * GET /api/native/trips/:id — the whole trip for offline use (`TripBundle`)
 * for any family member, with `access` for this caller, `suggestions`,
 * `fullness`, leg `alternatives`, and the travellers only (never memory
 * text), the caller's own conversation thread, and the creator as
 * `createdById`/`createdByName` (no email). The ETag is per caller;
 * `If-None-Match` → 304.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const bundle = await tripBundle(ft.trip, { access: ft.access, viewerEmail: ft.caller.email, creator: await tripCreator(ft.trip) });
  const headers = { etag: bundle.etag, 'cache-control': 'private, no-cache' };
  if (etagMatches(event.request.headers.get('if-none-match'), bundle.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return json(bundle, { headers });
});
