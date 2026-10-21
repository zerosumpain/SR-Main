import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip } from '$lib/trips/api.server';
import { setQuestionPush } from '$lib/trips/decisions.store.server';

/**
 * PUT /api/trips/:id/question-pushes — `{ on: boolean }`: v8.1, turn this trip's
 * question notifications on or off for the owner. 200 `{ on }`.
 */
export const PUT: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = (await event.request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== 'boolean') return json({ error: 'Send { "on": true } or { "on": false }.' }, { status: 400 });
  return json({ on: await setQuestionPush(trip.id, owner, body.on) });
};
