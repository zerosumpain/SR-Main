// Pull the trail Home Assistant already recorded into daydream_trail.
//
// Owner-gated, POST-only, and deliberately manual: it writes a month of history
// in one go and re-clusters the place graph afterwards, which is not something
// that should happen as a side effect of a service restart.
//
// Idempotent — see backfill.ts. Re-running corrects a day rather than
// duplicating it, and it never writes over the window live observation owns.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { backfillFromHomeAssistant, DEFAULT_BACKFILL_DAYS } from '$lib/daydream/backfill';
import { refreshPlaces } from '$lib/daydream/places';
import { errMsg } from '$lib/daydream/types';

/**
 * Service-to-service auth, alongside the owner session.
 *
 * Same shape as `/api/policy-engine/*` and `/api/claude-changelog/ingest`: a
 * shared secret in an Authorization header, checked in the handler, with an
 * EXACT-path bypass in hooks.server.ts. Exact, never a prefix — a prefix would
 * silently hand the exemption to every future `/api/daydream/*` route, which is
 * how an endpoint ends up unauthenticated without anyone choosing it.
 *
 * Without this the only way to run a backfill was a human clicking a button,
 * which makes a verified capability wait on someone's attention.
 */
function bearerOk(request: Request): boolean {
  const secret = env.DAYDREAM_MAINTENANCE_SECRET || '';
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (supplied.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= supplied.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  // A signed-in owner reaches here through the normal gate; a script presents
  // the bearer token instead. Anything else has already been turned away by
  // hooks, but the handler does not rely on that.
  const session = await locals.auth?.();
  if (!session && !bearerOk(request)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body is fine — the defaults are the intended behaviour.
  }

  const days = Number(body.days);
  const dryRun = body.dryRun === true;

  try {
    const result = await backfillFromHomeAssistant({
      days: Number.isFinite(days) && days > 0 ? days : DEFAULT_BACKFILL_DAYS,
      entity: typeof body.entity === 'string' ? body.entity : undefined,
    });

    // Places are derived FROM the trail, so a backfill that did not re-cluster
    // would leave a month of history sitting there with nothing reading it —
    // and the hourly refresh would not run for another hour.
    const places = dryRun ? null : await refreshPlaces();

    return json({ ok: true, backfill: result, places });
  } catch (err) {
    console.error('[daydream] backfill failed:', errMsg(err));
    return json({ error: errMsg(err) }, { status: 500 });
  }
};
