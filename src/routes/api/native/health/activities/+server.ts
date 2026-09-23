import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { beforeToEpoch, getNativeActivities } from '$lib/server/native-trails';

/**
 * GET /api/native/health/activities?limit=30&before=<ISO> — the outings, newest
 * first, one page at a time.
 *
 * `before` is the `nextBefore` the previous page handed back. The list itself is
 * SR-Health's (`/api/trails/activities`), reached over the service lane; this
 * route only reshapes it — see `$lib/server/native-trails`.
 *
 * A 503 when Health is not answering, for the same reason as the summary: an
 * empty list would read as "you have never been outside".
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const limit = clampLimit(url.searchParams.get('limit'), 30, 200);
  const before = beforeToEpoch(url.searchParams.get('before'));
  try {
    return await getNativeActivities({ limit, before });
  } catch (error) {
    console.error('[native] activities unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
