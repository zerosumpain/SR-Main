// POST /api/daydream/observe — the push half of the daydream trail.
//
// A Home Assistant automation fires on `person.john` GPS change and posts here.
// Shared-secret header, same shape as /api/live-walk, which is why this path is
// listed in PUBLIC_PATHS: it must be reachable without a session, and the
// secret is what stands in for one.
//
// **Only this exact path is public.** The prefix match in `isPublicPath` is
// `pathname === p || pathname.startsWith(p + '/')`, so listing `/api/daydream`
// would hand the whole tree to anonymous traffic — including the thoughts and
// feedback endpoints that land in later merges and are owner-only. The
// snapshot in .github/public-routes.txt exists to make exactly that mistake
// visible in review.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { recordFix } from '$lib/daydream/observe';
import { DEFAULT_SUBJECT, INGEST_SECRET_ENV, errMsg } from '$lib/daydream/types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Broadcast-Key',
};

export const OPTIONS: RequestHandler = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

/**
 * Constant-time-ish comparison. Not a defence against a determined attacker
 * with timing oracles — the secret is 32 bytes of entropy over TLS — but it
 * costs nothing and keeps the obvious footgun out of the diff.
 */
function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const POST: RequestHandler = async ({ request }) => {
  const secret = env[INGEST_SECRET_ENV] || '';

  // Fail LOUDLY when unset rather than degrading quietly to the poll floor.
  // Twenty-six VPS-only variables have already gone missing here without a
  // sound; a 503 with the variable's name in it is diagnosable, a silent 401
  // looks like a broken automation and gets debugged at the wrong end.
  if (!secret) {
    console.error(
      `[daydream] ${INGEST_SECRET_ENV} is not set — the push ingest is closed. ` +
        `The trail will fall back to the 10-minute poll floor, at much lower fidelity.`,
    );
    return json(
      { error: `${INGEST_SECRET_ENV} not configured on this host` },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  if (!secretMatches(request.headers.get('X-Broadcast-Key'), secret)) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, { status: 400, headers: CORS_HEADERS });
  }

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : null;

  const lat = num(body.lat ?? body.latitude);
  const lon = num(body.lon ?? body.lng ?? body.longitude);

  if (lat == null || lon == null) {
    return json(
      { error: 'lat and lon are required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const fix = await recordFix(
      {
        lat,
        lon,
        accuracyM: num(body.accuracyM ?? body.gps_accuracy ?? body.accuracy),
        at: typeof body.at === 'string' ? body.at : null,
        batteryPct: num(body.batteryPct ?? body.battery_level),
        haState: typeof body.state === 'string' ? body.state : null,
        readingAgeS: num(body.readingAgeS),
      },
      'push',
      typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : DEFAULT_SUBJECT,
    );

    // Deliberately terse: the caller is an HA automation, not a person, and
    // echoing the position back would put coordinates in HA's logbook for no
    // reason.
    return json(
      { ok: true, id: fix.id, mode: fix.mode, atKnownPlace: fix.placeId != null },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const reason = errMsg(err);
    console.error('[daydream] push ingest rejected a fix:', reason);
    return json({ error: reason }, { status: 400, headers: CORS_HEADERS });
  }
};
