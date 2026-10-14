import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { parseReplanBody } from '$lib/trips/intake';
import { replanOptions, tripReplan } from '$lib/trips/plan.server';

/**
 * POST /api/native/trips/:id/replan — `{ date, nowMin, position, atStopId,
 * doneStopIds, scope?, observation? }` → `{ options }` (+ `tripOptions`,
 * `narrative`, `quickReplies` for scope 'trip'). Read-only, so any family
 * member may ask; applying an option is an edit (events, `canEdit`).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const parsed = parseReplanBody(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const options = await replanOptions(ft.trip, parsed.value);
  if (parsed.value.scope !== 'trip') return { options };
  return { options, ...(await tripReplan(ft.trip, parsed.value)) };
});
