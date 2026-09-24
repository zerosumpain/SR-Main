import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { getNativeHealthHub } from '$lib/server/native-health-hub';

/**
 * GET /api/native/health/hub — everything /health concludes, for the phone:
 * the one-line read, readiness and its factors, the instruments, forecasts,
 * ranked moves, tripwires, segments, today's plan, experiments and the verdict.
 *
 * The summary route stays as it is: Today and the notification fingerprint
 * read it, and it answers in one small request. This is the deep read the
 * Health tab makes after the hero has drawn.
 *
 * `?fresh=1` skips the minute's cache, as on the summary. A 503 when Health is
 * not answering, for the same reason: the app has a designed state for it.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  try {
    return await getNativeHealthHub({ fresh: url.searchParams.get('fresh') === '1' });
  } catch (error) {
    console.error('[native] health hub unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
