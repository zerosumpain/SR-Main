import { json } from '@sveltejs/kit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { rateLimit } from '$lib/server/rate-limit';

/**
 * POST /api/native/review-demo { code } — the App Review demo switch.
 *
 * App Review Guideline 2.1 accepts "a fully-featured demo mode" in place of a
 * reviewer account, and a real account is ruled out here: anyone the family
 * lane admits can see the household's live locations. So the reviewer types a
 * code into the app's "I have a pairing code" box, the app asks this route
 * whether it is THE review code, and on `{ demo: true }` runs entirely on the
 * synthetic fixtures it ships with — no network, no uploads.
 *
 * What this route is NOT: a credential. It mints nothing, writes nothing and
 * reads nothing but one env var. A leaked review code opens a phone full of
 * made-up data on the phone that typed it, and nothing on this site.
 *
 *  * The code lives in `APP_REVIEW_DEMO_CODE` on the server, never in the app
 *    binary. Unset (or blank) means the route does not exist: 404, so a probe
 *    cannot tell a disabled switch from a missing one.
 *  * Compared in constant time, over fixed-width digests so a length mismatch
 *    cannot short-circuit either.
 *  * Unauthenticated like /api/native/pair (a reviewer holds no token), so it
 *    carries its own per-address ceiling, the same as /pair's.
 *  * A wrong code is 401 with the same sentence as a bad pairing code: the
 *    app then tries the ordinary pairing path with it.
 */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const expected = (env.APP_REVIEW_DEMO_CODE ?? '').trim();
  if (!expected) return json({ error: 'Not found' }, { status: 404 });

  let addr = 'unknown';
  try {
    addr = getClientAddress();
  } catch {
    /* behind a proxy with no address: one shared bucket */
  }
  const limit = rateLimit(`native-review-demo:${addr}`, { capacity: 10, refillPerSecond: 0.05 });
  if (!limit.allowed) {
    return json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'That pairing code is not valid.' }, { status: 400 });
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > 200) return json({ error: 'That pairing code is not valid.' }, { status: 400 });

  if (!safeEqual(code, expected)) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }
  return json({ demo: true });
};
