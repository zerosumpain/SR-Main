import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { getNativeActivity, isActivityId, isUpstreamNotFound } from '$lib/server/native-trails';

/**
 * GET /api/native/health/activities/[id] — one outing: its route, profile,
 * heart rate, splits, physiology, highlights and the segments it crossed.
 *
 * The id is `source:opaque` (`apple:UUID`). SvelteKit has already decoded the
 * path segment; it is checked against that shape before anything goes upstream,
 * and re-encoded on the way out so the colon cannot be read as anything but
 * part of the id.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const { id } = params;
  if (!isActivityId(id)) return json({ error: 'No such activity.' }, { status: 404 });

  try {
    return await getNativeActivity(id);
  } catch (error) {
    if (isUpstreamNotFound(error)) return json({ error: 'No such activity.' }, { status: 404 });
    console.error('[native] activity unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
