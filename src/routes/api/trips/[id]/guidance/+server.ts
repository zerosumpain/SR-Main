import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { startGuidance } from '$lib/trips/guidance.server';
import { isLocalDate } from '$lib/trips/intake';

/**
 * POST /api/trips/:id/guidance — `{ dates?: string[] }`: make guidance for
 * those days (default: every day of the plan) in the background. 202.
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { dates?: unknown } | null;
  const dates = Array.isArray(body?.dates) ? body.dates.filter(isLocalDate).slice(0, 40) : null;
  startGuidance(owner, trip.id, dates?.length ? dates : 'all');
  return json({ started: true }, { status: 202 });
};
