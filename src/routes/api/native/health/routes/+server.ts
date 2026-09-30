import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { listNativeRoutes, readSaveInput, saveNativeRoute, upstreamStatus } from '$lib/server/native-routes';

/**
 * GET  /api/native/health/routes — saved routes, newest first.
 * POST /api/native/health/routes — save a planned (or discovered) route; the
 *      body carries `[lat, lng, ele]` points, turned round for Health here.
 */
export const GET: RequestHandler = withDevice(async () => {
  try {
    return await listNativeRoutes();
  } catch (error) {
    console.error('[native] routes unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});

export const POST: RequestHandler = withDevice(async ({ request }) => {
  const input = readSaveInput(await request.json().catch(() => null));
  if (typeof input === 'string') return json({ error: input }, { status: 400 });

  try {
    return json(await saveNativeRoute(input), { status: 201 });
  } catch (error) {
    console.error('[native] route save failed', error);
    return upstreamStatus(error) === 400
      ? json({ error: 'Health would not save that route.' }, { status: 400 })
      : json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
