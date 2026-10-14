import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { findIdeas } from '$lib/trips/ideas.server';
import { parseIdeasAsk } from '$lib/trips/intake';

/**
 * POST /api/trips/:id/ideas — `{ date, stage, afterStopId?, beforeStopId? }`:
 * up to three ideas for that open slot, each checked with the solver first.
 * Nothing is saved; "Add this" goes through POST /api/trips/:id/wishes.
 */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const parsed = parseIdeasAsk(await readJson(event));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return json(await findIdeas(trip, parsed.value, 'site'));
};
