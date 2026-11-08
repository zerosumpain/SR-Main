import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { findIdeas } from '$lib/trips/ideas.server';
import { parseIdeasAsk } from '$lib/trips/intake';
import { jobAccepted, startJob, wantsAsync } from '$lib/trips/jobs.server';

/**
 * POST /api/native/trips/:id/ideas — "Make a suggestion": ideas for a slot,
 * each checked with the solver. Read-only, any family member. The creator or
 * a parent adds one; anyone else suggests it (…/suggestions).
 * v6: `"async": true` → 202 `{ job }`; poll GET /api/native/trips/jobs/:jobId.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const body = await event.request.json().catch(() => null);
  const parsed = parseIdeasAsk(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const run = () => findIdeas(ft.trip, parsed.value, 'phone', { asOwner: ft.caller.isOwner, author: { email: ft.caller.email, id: ft.caller.personId } });
  if (wantsAsync(body)) return jobAccepted(startJob(ft.caller.email, 'ideas', run));
  return run();
});
