import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { parseEventsBody } from '$lib/trips/intake';
import { applyEvents } from '$lib/trips/plan.server';

/** Events that change the trip: only someone who may edit it sends these (v5). */
const EDITS = new Set(['option-applied', 'skipped', 'stop-added']);

/**
 * POST /api/native/trips/:id/events — `{ events, basePlanVersion }` →
 * `{ accepted, planVersion }`, idempotent on `clientId`. Any family member may
 * report arrived / left / delayed; applying an option, skipping or adding a
 * stop needs `canEdit` (403 otherwise, nothing recorded).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const parsed = parseEventsBody(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  if (!ft.access.canEdit && parsed.value.events.some((e) => EDITS.has(e.kind))) {
    return json({ error: 'Only whoever made the trip, or a parent, can change it — make a suggestion instead.' }, { status: 403 });
  }
  return applyEvents(ft.trip, parsed.value.events);
});
