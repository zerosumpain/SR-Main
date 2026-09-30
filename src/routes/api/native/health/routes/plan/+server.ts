import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import {
  isSport,
  planNativeRoute,
  readPlanInput,
  suggestNativeDistance,
  upstreamStatus,
} from '$lib/server/native-routes';

/**
 * GET  /api/native/health/routes/plan?sport=run — the distance Health would
 *      suggest from the last eight weeks, to fill the form with.
 * POST /api/native/health/routes/plan — plan to a spec; the top three
 *      candidates, scored, at full geometry.
 *
 * Health's own error text (openrouteservice's) stays on the server: a phone
 * gets one sentence per kind of failure.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const sport = url.searchParams.get('sport') ?? 'run';
  if (!isSport(sport)) return json({ error: 'Pick a sport.' }, { status: 400 });
  try {
    return await suggestNativeDistance(sport);
  } catch (error) {
    console.error('[native] route suggestion unavailable', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});

export const POST: RequestHandler = withDevice(async ({ request }) => {
  const input = readPlanInput(await request.json().catch(() => null));
  if (typeof input === 'string') return json({ error: input }, { status: 400 });

  try {
    const plan = await planNativeRoute(input);
    if (!plan.candidates.length) {
      return json({ error: 'No route came back from there. Try moving the start or a different distance.' }, { status: 422 });
    }
    return plan;
  } catch (error) {
    const status = upstreamStatus(error);
    console.error('[native] route plan failed', error);
    if (status === 429) {
      return json({ error: 'The route planner is busy. Try again in a minute.' }, { status: 429 });
    }
    if (status === 400) {
      return json({ error: 'Could not plan from there. Try moving the start or a different distance.' }, { status: 422 });
    }
    return json({ error: 'The route planner is not answering right now.' }, { status: 503 });
  }
});
