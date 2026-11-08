import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { parseReplanBody } from '$lib/trips/intake';
import { jobAccepted, startJob, wantsAsync } from '$lib/trips/jobs.server';
import { replanOptions, tripReplan } from '$lib/trips/plan.server';

/**
 * POST /api/native/trips/:id/replan — `{ date, nowMin, position, atStopId,
 * doneStopIds, scope?, observation? }` → `{ options }` (+ `tripOptions`,
 * `narrative`, `quickReplies` for scope 'trip'). Read-only, so any family
 * member may ask; applying an option is an edit (events, `canEdit`).
 * v6: scope 'trip' with `"async": true` → 202 `{ job }` (poll
 * GET /api/native/trips/jobs/:jobId); the day scope stays synchronous.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const body = await event.request.json().catch(() => null);
  const parsed = parseReplanBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  if (parsed.value.scope !== 'trip') return { options: await replanOptions(ft.trip, parsed.value) };
  const run = async () => ({ options: await replanOptions(ft.trip, parsed.value), ...(await tripReplan(ft.trip, parsed.value)) });
  if (wantsAsync(body)) return jobAccepted(startJob(ft.caller.email, 'replan', run));
  return run();
});
