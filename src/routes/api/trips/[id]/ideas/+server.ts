import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { findIdeas } from '$lib/trips/ideas.server';
import { parseIdeasAsk } from '$lib/trips/intake';
import { jobAccepted, startJob, wantsAsync } from '$lib/trips/jobs.server';

/**
 * POST /api/trips/:id/ideas — `{ date, stage, afterStopId?, beforeStopId? }`:
 * up to three ideas for that open slot, each checked with the solver first.
 * Nothing is saved; "Add this" goes through POST /api/trips/:id/wishes.
 * v6: `"async": true` → 202 `{ job }` (poll GET /api/trips/jobs/:jobId).
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = await readJson(event);
  const parsed = parseIdeasAsk(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const run = () => findIdeas(trip, parsed.value, 'site', { asOwner: true, author: { email: owner, id: null } });
  if (wantsAsync(body)) return jobAccepted(startJob(owner, 'ideas', run));
  return json(await run());
};
