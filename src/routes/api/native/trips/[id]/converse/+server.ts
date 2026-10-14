import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { nativeTripOwner, NOT_YOURS } from '$lib/trips/access.server';
import { converse } from '$lib/trips/converse.server';
import { parseObservation } from '$lib/trips/intake';
import { getTrip } from '$lib/trips/store.server';

/**
 * POST /api/native/trips/:id/converse — `{ text, position?, observation? }`:
 * the "Edit plan" conversation on the phone (v2, surface 'phone'). Owner only
 * (D2). → `ConverseResult` plus the two stored messages.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const owner = nativeTripOwner(identity, role);
  if (!owner) return json({ error: NOT_YOURS }, { status: 403 });
  const trip = await getTrip(owner, event.params.id);
  if (!trip) return json({ error: 'No such trip.' }, { status: 404 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say something to the planner.' }, { status: 400 });
  const observation = parseObservation(body?.observation);
  if (!observation.ok) return json({ error: observation.error }, { status: 400 });
  const p = body?.position as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  const position = p && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  return converse(trip, { text, surface: 'phone', observation: observation.value, position });
});
