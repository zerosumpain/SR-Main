import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { setQuestionPush } from '$lib/trips/decisions.store.server';
import { familyTrip } from '$lib/trips/family.server';

/**
 * PUT /api/native/trips/:id/question-pushes — `{ on: boolean }`: v8.1, turn this
 * trip's question notifications on or off for the caller only. Any family
 * member (it is their own phone's notifications). 200 `{ on }`.
 */
export const PUT: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const body = (await event.request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== 'boolean') return json({ error: 'Send { "on": true } or { "on": false }.' }, { status: 400 });
  return json({ on: await setQuestionPush(ft.trip.id, ft.caller.email, body.on) });
});
