import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { getNativeSegment, isUpstreamNotFound, parseSegmentId } from '$lib/server/native-trails';

/**
 * GET /api/native/health/segments/[id] — one segment: its line, its conditions,
 * and the last hundred efforts on it with the best one marked.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const id = parseSegmentId(params.id);
  if (id === null) return json({ error: 'No such segment.' }, { status: 404 });

  try {
    return await getNativeSegment(id);
  } catch (error) {
    if (isUpstreamNotFound(error)) return json({ error: 'No such segment.' }, { status: 404 });
    console.error('[native] segment unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
