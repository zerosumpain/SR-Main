import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { converse } from '$lib/trips/converse.server';

/**
 * POST /api/trips/:id/converse — `{ text }`: one turn of the planning
 * conversation (v2). The planner answers and changes the trip through
 * validated operations; the trip re-solves once. → `ConverseResult` plus the
 * two stored messages.
 */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say something to the planner.' }, { status: 400 });
  return json(await converse(trip, { text, surface: 'site' }));
};
