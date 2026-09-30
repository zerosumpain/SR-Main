import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { deleteNativeRoute, getNativeRoute, isRouteId } from '$lib/server/native-routes';
import { isUpstreamNotFound } from '$lib/server/native-trails';

/**
 * GET    /api/native/health/routes/[id] — one saved route at following
 *        precision, with its waypoints. The phone keeps this copy on disk so a
 *        route can be followed with no signal.
 * DELETE /api/native/health/routes/[id]
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  if (!isRouteId(params.id)) return json({ error: 'No such route.' }, { status: 404 });
  try {
    return await getNativeRoute(params.id);
  } catch (error) {
    if (isUpstreamNotFound(error)) return json({ error: 'No such route.' }, { status: 404 });
    console.error('[native] route unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});

export const DELETE: RequestHandler = withDevice(async ({ params }) => {
  if (!isRouteId(params.id)) return json({ error: 'No such route.' }, { status: 404 });
  try {
    return await deleteNativeRoute(params.id);
  } catch (error) {
    if (isUpstreamNotFound(error)) return json({ error: 'No such route.' }, { status: 404 });
    console.error('[native] route delete failed', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
