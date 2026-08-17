import { json } from '@sveltejs/kit';
import { listRoutes, saveRoute } from '$lib/trails/routes-service';
import { describeSaveError } from '$lib/trails/api-errors';
import { ORS_PROFILES } from '$lib/trails/ors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json({ routes: await listRoutes() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  if (!Array.isArray(body.coordinates) || body.coordinates.length < 2) {
    return json({ error: 'coordinates must be an array of at least two points' }, { status: 400 });
  }
  if (typeof body.sport !== 'string' || !(body.sport in ORS_PROFILES)) {
    return json({ error: 'unknown sport' }, { status: 400 });
  }

  try {
    const id = await saveRoute({
      name: String(body.name ?? '').slice(0, 200),
      sport: body.sport,
      coordinates: body.coordinates,
      distanceM: Number.isFinite(body.distanceM) ? body.distanceM : undefined,
      ascentM: Number.isFinite(body.ascentM) ? body.ascentM : null,
      descentM: Number.isFinite(body.descentM) ? body.descentM : null,
      durationS: Number.isFinite(body.durationS) ? body.durationS : null,
      score: Number.isFinite(body.score) ? body.score : null,
      scoreBreakdown: body.scoreBreakdown ?? null,
      targetDistanceM: Number.isFinite(body.targetDistanceM) ? body.targetDistanceM : null,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
      source: body.source === 'imported' ? 'imported' : 'planned',
    });
    return json({ id }, { status: 201 });
  } catch (err) {
    console.error('[trails/routes] save failed:', err);
    return json({ error: describeSaveError(err) }, { status: 400 });
  }
};
