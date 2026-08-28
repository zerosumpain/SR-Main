import { json } from '@sveltejs/kit';
import { saveRecording } from '$lib/trails/recordings';
import { describeSaveError } from '$lib/trails/api-errors';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'invalid JSON body' }, { status: 400 });

  try {
    const result = await saveRecording({
      clientId: String(body.clientId ?? ''),
      name: typeof body.name === 'string' ? body.name.slice(0, 200) : undefined,
      sport: String(body.sport ?? 'run'),
      startedAt: Number(body.startedAt),
      finishedAt: Number(body.finishedAt),
      track: Array.isArray(body.track) ? body.track : [],
      heartRate: Array.isArray(body.heartRate) ? body.heartRate : undefined,
      movingS: Number.isFinite(body.movingS) ? body.movingS : null,
      routeId: typeof body.routeId === 'string' ? body.routeId : null,
    });
    return json(result, { status: 201 });
  } catch (err) {
    console.error('[trails/recordings] save failed:', err);
    return json({ error: describeSaveError(err) }, { status: 400 });
  }
};
