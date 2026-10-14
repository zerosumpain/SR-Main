import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip, suggest } from '$lib/trips/family.server';
import { parseSuggestionInput } from '$lib/trips/intake';
import { draftFrom } from '$lib/trips/ops';
import { suggestionWire } from '$lib/trips/store.server';

/**
 * POST /api/native/trips/:id/suggestions — `{ date, stage, wish, note?, fitText? }`:
 * a family member suggests something for a slot (canSuggest). Pending until a
 * parent decides; the parents are pushed. 201 `{ suggestion }`.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  if (!ft.access.canSuggest) return json({ error: 'You cannot suggest for this trip.' }, { status: 403 });
  const parsed = parseSuggestionInput(await event.request.json().catch(() => null), draftFrom);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const s = await suggest(ft.trip, ft.caller, parsed.value);
  return json({ suggestion: suggestionWire(s) }, { status: 201 });
});
