import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { interpretNativeRoute } from '$lib/server/native-routes';

/**
 * POST /api/native/health/routes/interpret — "10 km hilly loop from the
 * station" into planner fields and geocoded places. It never plans; the phone
 * fills its form and the owner presses Plan.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
  if (!text) return json({ error: 'Say what route you want first.' }, { status: 400 });
  const f = body?.focus as { lat?: unknown; lng?: unknown } | undefined;
  const focus =
    typeof f?.lat === 'number' && typeof f?.lng === 'number' && Number.isFinite(f.lat) && Number.isFinite(f.lng)
      ? { lat: f.lat, lng: f.lng }
      : undefined;

  try {
    return await interpretNativeRoute(text, focus);
  } catch (error) {
    console.error('[native] route interpret failed', error);
    return json({ error: 'Could not read that. Try plainer wording, or use the form.' }, { status: 502 });
  }
});
