import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { converse } from '$lib/trips/converse.server';
import { jobAccepted, startJob, wantsAsync } from '$lib/trips/jobs.server';

/**
 * POST /api/trips/:id/converse — `{ text }`: one turn of the planning
 * conversation (v2). The planner answers and changes the trip through
 * validated operations; the trip re-solves once. → `ConverseResult` plus the
 * two stored messages. v6: `"async": true` → 202 `{ job }` (poll
 * GET /api/trips/jobs/:jobId).
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Say something to the planner.' }, { status: 400 });
  const run = () => converse(trip, { text, surface: 'site', caller: { isOwner: true, canEdit: true, name: null, email: owner } });
  if (wantsAsync(body)) return jobAccepted(startJob(owner, 'converse', run));
  return json(await run());
};
