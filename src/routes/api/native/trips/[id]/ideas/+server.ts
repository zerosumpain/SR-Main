import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { findIdeas } from '$lib/trips/ideas.server';
import { parseIdeasAsk } from '$lib/trips/intake';

/**
 * POST /api/native/trips/:id/ideas — "Make a suggestion": ideas for a slot,
 * each checked with the solver. Read-only, any family member. The creator or
 * a parent adds one; anyone else suggests it (…/suggestions).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const parsed = parseIdeasAsk(await event.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return findIdeas(ft.trip, parsed.value, 'phone', { asOwner: ft.caller.isOwner, author: { email: ft.caller.email, id: ft.caller.personId } });
});
