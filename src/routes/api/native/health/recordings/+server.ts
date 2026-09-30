import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { readRecording, saveNativeRecording, upstreamStatus } from '$lib/server/native-routes';

/**
 * POST /api/native/health/recordings — a route walked on the phone, saved as
 * an activity (Health's `/api/trails/recordings`, the same save
 * /health/record makes). Idempotent on `clientId`: the phone queues a walk
 * with no signal and retries, and Health upserts `recorded:<clientId>`.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const input = readRecording(await request.json().catch(() => null));
  if (typeof input === 'string') return json({ error: input }, { status: 400 });

  try {
    return json(await saveNativeRecording(input), { status: 201 });
  } catch (error) {
    console.error('[native] recording save failed', error);
    return upstreamStatus(error) === 400
      ? json({ error: 'Health would not save that walk.' }, { status: 400 })
      : json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
