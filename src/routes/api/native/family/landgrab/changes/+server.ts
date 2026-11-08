import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import {
  BAD_WEEK,
  getFamilyLandgrabChanges,
  isWeekShape,
  LANDGRAB_UNAVAILABLE,
  upstreamStatus,
} from '$lib/family/landgrab.server';

/**
 * GET /api/native/family/landgrab/changes?week=YYYY-MM-DD — the map of one
 * week: the hexes that changed hands, and the outing that took each group of
 * them, with its trace already trimmed by SR-Health.
 *
 * SR-Health answers (`/api/health/landgrab/family/changes`, over the service
 * lane); every subject becomes the person's id here and none is sent on — see
 * `$lib/family/landgrab.server`. Family only, as the steps board is.
 *
 * A malformed `week` is refused here; whether it is a Monday in the last
 * twelve weeks is Health's call, and its 400 passes through. Anything else
 * Health does — down, slow, not yet shipped — is a 502.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const week = event.url.searchParams.get('week');
  if (!isWeekShape(week)) return json({ error: BAD_WEEK }, { status: 400 });
  try {
    return await getFamilyLandgrabChanges(week);
  } catch (error) {
    if (upstreamStatus(error) === 400) return json({ error: BAD_WEEK }, { status: 400 });
    console.error('[native] landgrab changes unavailable', error);
    return json({ error: LANDGRAB_UNAVAILABLE }, { status: 502 });
  }
});
