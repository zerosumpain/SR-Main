import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { getNativeSegments } from '$lib/server/native-trails';

/**
 * GET /api/native/health/segments?limit=100 — the stretches you keep coming
 * back to, most recently done first.
 *
 * Health returns every segment in one list; the ordering and the cap are the
 * phone's and are applied in `$lib/server/native-trails`.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const limit = clampLimit(url.searchParams.get('limit'), 100, 500);
  try {
    return await getNativeSegments({ limit });
  } catch (error) {
    console.error('[native] segments unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
