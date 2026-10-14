import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { converse } from '$lib/trips/converse.server';
import { familyTrip } from '$lib/trips/family.server';
import { parseObservation } from '$lib/trips/intake';

/**
 * POST /api/native/trips/:id/converse — `{ text, position?, observation? }`.
 * The creator or a parent changes the trip through the planner; any other
 * family member gets advice only (no ops applied). Only the owner's turns use
 * the owner's memory.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say something to the planner.' }, { status: 400 });
  const observation = parseObservation(body?.observation);
  if (!observation.ok) return json({ error: observation.error }, { status: 400 });
  const p = body?.position as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  const position = p && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  return converse(ft.trip, {
    text,
    surface: 'phone',
    observation: observation.value,
    position,
    caller: { isOwner: ft.caller.isOwner, canEdit: ft.access.canEdit, name: ft.caller.name, email: ft.caller.email, personId: ft.caller.personId },
  });
});
