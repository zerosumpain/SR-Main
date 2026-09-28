import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimit } from '$lib/server/rate-limit';
import { isOwnerEmail } from '$lib/server/access';
import { createPairingCode } from '$lib/server/native-auth';
import { ensureAppRequest, verifyAppleIdentityToken } from '$lib/server/registration';

/**
 * POST /api/native/register/apple { identityToken, nonce, name? } — Sign in with Apple
 * from the app's Welcome screen. Answers `{ code }`, a one-time pairing code
 * the phone redeems at /api/native/pair like any other.
 *
 * Unauthenticated, like /api/native/pair, so it carries its own ceiling per
 * address. What makes it safe is the token: signed by Apple for THIS app
 * (`aud` is the bundle id) with an email Apple vouches for, checked against
 * Apple's keys ($lib/server/registration). The person is recorded as a
 * request for the owner, exactly as a Google sign-in is; someone already
 * allowed is simply connected. Never the owner: see below.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let addr = 'unknown';
  try {
    addr = getClientAddress();
  } catch {
    /* behind a proxy with no address: one shared bucket */
  }
  const limit = rateLimit(`native-register:${addr}`, { capacity: 6, refillPerSecond: 0.02 });
  if (!limit.allowed) return json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });

  let body: { identityToken?: unknown; name?: unknown; nonce?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'That sign-in did not arrive.' }, { status: 400 });
  }
  const token = typeof body.identityToken === 'string' ? body.identityToken : '';
  if (!token || token.length > 8192) return json({ error: 'That sign-in did not arrive.' }, { status: 400 });

  const nonce = typeof body.nonce === 'string' ? body.nonce.slice(0, 200) : '';
  const identity = await verifyAppleIdentityToken(token, { nonce }).catch((err) => {
    console.error('[native/register/apple] verify failed:', err);
    return null;
  });
  if (!identity) return json({ error: 'Apple could not confirm that sign-in. Try again.' }, { status: 401 });

  // The owner's phone opens every owner route; it is paired from an owner
  // web session (a QR), never from an Apple sign-in, whatever Apple vouches.
  if (isOwnerEmail(identity.email)) {
    return json({ error: 'Pair the owner’s iPhone from the website.' }, { status: 403 });
  }
  const name = typeof body.name === 'string' ? body.name : null;
  await ensureAppRequest({ email: identity.email, name, via: 'apple' });
  const { code } = await createPairingCode(identity.email);
  return json({ code });
};
