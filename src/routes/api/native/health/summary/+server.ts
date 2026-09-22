import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { getNativeHealthSummary } from '$lib/server/native-health';

/**
 * GET /api/native/health/summary — /health, sized for a phone.
 *
 * Four figures, a readiness line, the week, and the personal records. The
 * derivation is SR-Health's; this is the door the phone can reach it through,
 * because the phone holds a device token minted by THIS site and the extracted
 * app's gateway refuses a client-supplied identity by design. The service lane
 * signs an identity for Main, and Main answers the phone.
 *
 * `?fresh=1` skips the one-minute cache. The pull-to-refresh gesture sends it;
 * a background refresh does not, because a phone waking every fifteen minutes
 * should not be why Health computes a thirty-day series again.
 *
 * A 503 rather than an empty body when Health is not answering: the app has a
 * designed state for "the health service is down" and an empty figure list
 * would render as four dashes, which reads as "you did nothing yesterday".
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  try {
    return await getNativeHealthSummary({ fresh: url.searchParams.get('fresh') === '1' });
  } catch (error) {
    console.error('[native] health summary unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
