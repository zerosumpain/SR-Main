import { json } from '@sveltejs/kit';
import { planRoutes, suggestTarget } from '$lib/trails/planner';
import { ORS_PROFILES, OrsError, orsConfigured } from '$lib/trails/ors';
import type { PlannerSport } from '$lib/trails/ors';
import type { RequestHandler } from './$types';

// Owner-gated by hooks.server.ts (every /api/* path outside the explicit
// bypasses is owner-only), so there is no auth check here.

export const GET: RequestHandler = async ({ url }) => {
  const sport = url.searchParams.get('sport') ?? 'run';
  if (!(sport in ORS_PROFILES)) return json({ error: 'unknown sport' }, { status: 400 });

  const suggested = await suggestTarget(sport);
  return json({ configured: await orsConfigured(), ...suggested });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  const { startLat, startLng, finishLat, finishLng, sport } = body;

  if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
    return json({ error: 'startLat and startLng are required' }, { status: 400 });
  }
  if (!(sport in ORS_PROFILES)) {
    return json(
      { error: `sport must be one of: ${Object.keys(ORS_PROFILES).join(', ')}` },
      { status: 400 },
    );
  }

  const hasFinish = Number.isFinite(finishLat) && Number.isFinite(finishLng);

  try {
    const result = await planRoutes({
      start: [startLng, startLat],
      finish: hasFinish ? [finishLng, finishLat] : undefined,
      sport: sport as PlannerSport,
      targetDistanceM: Number.isFinite(body.targetDistanceM) ? body.targetDistanceM : undefined,
      targetGainPerKm: Number.isFinite(body.targetGainPerKm) ? body.targetGainPerKm : undefined,
      prefer: body.prefer === 'steady' || body.prefer === 'spiky' ? body.prefer : 'any',
      allowOutAndBack: body.allowOutAndBack === true,
      avoidFeatures: Array.isArray(body.avoidFeatures) ? body.avoidFeatures : undefined,
      candidates: Number.isFinite(body.candidates) ? body.candidates : undefined,
    });
    return json(result);
  } catch (err) {
    if (err instanceof OrsError) {
      // 429 from ORS is the free tier's ceiling, not a bug in the request —
      // pass the distinction through so the UI can say which it was.
      const status = err.status === 429 ? 429 : err.status && err.status < 500 ? 400 : 502;
      return json({ error: err.message, retryable: err.retryable }, { status });
    }
    console.error('[trails/plan] failed:', err);
    return json({ error: 'Route planning failed' }, { status: 500 });
  }
};
