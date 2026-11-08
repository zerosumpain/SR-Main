import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { getFamilyLandgrabExplored, LANDGRAB_UNAVAILABLE } from '$lib/family/landgrab.server';

/**
 * GET /api/native/family/landgrab/explored — everything the family has
 * explored, all time, as one: no owner, no decay. The headline figures
 * (total, today's and this week's new ground), each person's part, the places
 * it spans, and a solid shape the phone fills — the family view of Landgrab,
 * beside the weekly game.
 *
 * SR-Health computes it (`/api/health/landgrab/family/explored`, over the
 * service lane) for exactly the household members Main names; every subject
 * becomes the steps board's id here and none is sent on — see
 * `$lib/family/landgrab.server`. Family only, as the steps board is. A 502
 * when Health does not answer, including before Health ships the endpoint.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  try {
    return await getFamilyLandgrabExplored(caller.email);
  } catch (error) {
    console.error('[native] landgrab explored unavailable', error);
    return json({ error: LANDGRAB_UNAVAILABLE }, { status: 502 });
  }
});
