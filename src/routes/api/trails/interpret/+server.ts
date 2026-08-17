import { json } from '@sveltejs/kit';
import { InterpretError, interpretCommission } from '$lib/trails/interpret';
import { geocode, orsConfigured, OrsError } from '$lib/trails/ors';
import { formatDistance } from '$lib/trails/format';
import type { RequestHandler } from './$types';

// Owner-gated by hooks.server.ts, like the rest of /api/trails.

/**
 * Free text in; planner fields + geocoded places + a plain-language reading
 * back out. The client applies the fields to the form it already has — this
 * endpoint never plans anything itself.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
  if (!text) return json({ error: 'Say what route you want first.' }, { status: 400 });

  const focus =
    Number.isFinite(body?.focus?.lat) && Number.isFinite(body?.focus?.lng)
      ? ([body.focus.lng, body.focus.lat] as [number, number])
      : undefined;

  let parsed;
  try {
    parsed = await interpretCommission(text);
  } catch (err) {
    const reason = err instanceof InterpretError ? err.message : 'the model call failed';
    console.warn('[trails/interpret] failed:', (err as Error)?.message);
    return json(
      { error: `Could not read that (${reason}) — try plainer wording, or use the form below.` },
      { status: 502 },
    );
  }

  // Geocoding is best-effort: a place the geocoder cannot find becomes a note,
  // not a failure — the rest of the commission still applies.
  const interpretation: string[] = [];
  let start: { lat: number; lng: number; label: string } | null = null;
  let finish: { lat: number; lng: number; label: string } | null = null;

  if ((parsed.startPlace || parsed.finishPlace) && (await orsConfigured())) {
    for (const which of ['startPlace', 'finishPlace'] as const) {
      const place = parsed[which];
      if (!place) continue;
      try {
        const hit = await geocode(place, { focus });
        if (hit) {
          const value = { lat: hit.lngLat[1], lng: hit.lngLat[0], label: hit.label };
          if (which === 'startPlace') start = value;
          else finish = value;
        } else {
          interpretation.push(`Could not find “${place}” — set that point on the map.`);
        }
      } catch (err) {
        if (err instanceof OrsError) {
          interpretation.push(`Could not look up “${place}” (${err.status ?? 'geocoder error'}).`);
        } else {
          throw err;
        }
      }
    }
  } else if (parsed.startPlace || parsed.finishPlace) {
    interpretation.push('No openrouteservice key, so named places cannot be looked up.');
  }

  if (parsed.sport) interpretation.push(`Sport: ${parsed.sport.replace('_', ' ')}.`);
  if (parsed.targetKm) interpretation.push(`Distance: ${formatDistance(parsed.targetKm * 1000)}.`);
  if (parsed.climbPerKm) interpretation.push(`Climb: about ${parsed.climbPerKm} m/km.`);
  if (parsed.prefer && parsed.prefer !== 'any') {
    interpretation.push(parsed.prefer === 'spiky' ? 'One big climb.' : 'Steady climbing.');
  }
  if (parsed.allowOutAndBack) interpretation.push('Out-and-back sections allowed.');
  if (start) interpretation.push(`Start: ${start.label}.`);
  if (finish) interpretation.push(`Finish: ${finish.label}.`);
  if (!interpretation.length) {
    interpretation.push('Nothing concrete read from that — the form keeps its current values.');
  }

  return json({ parsed, start, finish, interpretation });
};
