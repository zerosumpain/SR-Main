// The `state` parameter on the Gmail connect round trip.
//
// Without one, the callback accepted any authorisation code handed to it by any
// signed-in browser: a page could start the flow against its own Google account
// and land the result in someone else's session. With members that matters —
// the callback now decides WHOSE mailbox a token becomes from the session — so
// the state binds the round trip to the session that started it.
//
// Stateless: an HMAC over the signed-in email, an expiry and a nonce, keyed on
// AUTH_SECRET. Nothing is stored, so a restart mid-consent costs nothing.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Long enough to read Google's consent screen, including the unverified-app warning. */
const TTL_MS = 15 * 60 * 1000;

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`gmail-connect:${body}`).digest('base64url');
}

function emailTag(email: string): string {
  // The email is not put in the URL in the clear; a hash is enough to bind it.
  return createHmac('sha256', 'gmail-connect-email').update(email.trim().toLowerCase()).digest('base64url').slice(0, 16);
}

export function signConnectState(secret: string, email: string, now = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot sign the Gmail connect state');
  const body = `${emailTag(email)}.${now + TTL_MS}.${randomBytes(9).toString('base64url')}`;
  return `${body}.${mac(secret, body)}`;
}

/** True only for a state this server signed, for this email, that has not expired. */
export function verifyConnectState(secret: string, state: string | null, email: string, now = Date.now()): boolean {
  if (!secret || !state) return false;
  const parts = state.split('.');
  if (parts.length !== 4) return false;
  const [tag, exp, nonce, sig] = parts;
  const body = `${tag}.${exp}.${nonce}`;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  if (!(Number(exp) > now)) return false;
  return tag === emailTag(email);
}
