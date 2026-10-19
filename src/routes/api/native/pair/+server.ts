import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { identifyDevice, peekPairingCode, redeemPairingCode, revokeDevice } from '$lib/server/native-auth';
import { isOwnerEmail } from '$lib/server/native-handler';
import { loadMember } from '$lib/server/grants';
import { satisfies } from '$lib/access/catalogue';
import { rateLimit } from '$lib/server/rate-limit';
import { canonicalEmail, isRegistrant } from '$lib/server/registration';
import { verifyPairIdentity } from '$lib/server/pair-identity';
import { memberByEmail } from '$lib/home/presence/members';

/**
 * POST /api/native/pair — exchange a one-time code for a device token.
 *
 * The one path under `/api/native` that answers a caller holding no credential,
 * because obtaining one is the whole point of it. Everything protecting it is
 * therefore in here rather than in `withDevice`:
 *
 *  * the code is single-use and deleted on redemption (`redeemPairingCode`);
 *  * it expires in ten minutes, and minting a new one kills the old;
 *  * the holder is re-checked, so a code minted by an address that has since
 *    left the list — or by a member who has since lost news and chat — buys
 *    nothing (`mayHoldDevice`);
 *  * and the whole endpoint is rate-limited by client address, because it is the
 *    only unauthenticated write on the site and 256 bits of entropy deserve a
 *    ceiling on guesses anyway.
 *
 * Every rejection is the same sentence and the same status. "Expired" and
 * "wrong" are different facts, and telling them apart tells a guesser whether
 * to keep going.
 *
 * A SCANNED code (the QR at /welcome) is the exception that must say more. It
 * was minted for whoever was signed in to the browser showing it, so the phone
 * must prove who IT is signed in as — its own site credential as a Bearer, or
 * an `identity` from a fresh sign-in in the app ($lib/server/pair-identity) —
 * and be that same person. Otherwise the code stays live and the phone is told
 * whose code it is. Only someone holding a real, live code ever reaches those
 * answers, so they tell a guesser nothing.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let clientAddr = '';
  try {
    clientAddr = getClientAddress();
  } catch {
    clientAddr = 'unknown';
  }
  const limit = rateLimit(`native-pair:${clientAddr}`, { capacity: 10, refillPerSecond: 0.05 });
  if (!limit.allowed) {
    return json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { code?: unknown; label?: unknown; identity?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'That pairing code is not valid.' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const label = typeof body.label === 'string' ? body.label : null;
  if (!code) return json({ error: 'That pairing code is not valid.' }, { status: 400 });

  const found = await peekPairingCode(code);
  if (!found) return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  // The credential this phone already held, replaced once the new one exists.
  let previousDevice: string | null = null;
  if (found.kind === 'scan') {
    const held = await identifyDevice(request);
    const asserted = held ? null : verifyPairIdentity(body.identity, code, env.AUTH_SECRET);
    const signedInAs = held?.ownerEmail ?? asserted;
    if (!signedInAs) {
      return json(
        { error: 'Sign in on this phone first, so the code can check it is yours.', signIn: true },
        { status: 428 },
      );
    }
    if ((await canonicalEmail(signedInAs)) !== found.ownerEmail) {
      const [codeFor, phoneIs] = await Promise.all([firstName(found.ownerEmail), firstName(signedInAs)]);
      return json(
        {
          error: `This code is ${codeFor}’s, and this phone is signed in as ${phoneIs}, so it was not connected. ${phoneIs}: sign in at strangeramblings.com/welcome as yourself to get your own code.`,
          wrongPerson: true,
        },
        { status: 409 },
      );
    }
    previousDevice = held?.id ?? null;
  }

  const redeemed = await redeemPairingCode(code, label);
  if (!redeemed) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }
  if (!(await mayHoldDevice(redeemed.ownerEmail))) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }
  // Same person, new credential: the old one would only linger in the device list.
  if (previousDevice) await revokeDevice(redeemed.ownerEmail, previousDevice).catch(() => false);

  return json({
    token: redeemed.token,
    expiresAt: redeemed.expiresAt.toISOString(),
  });
};

/** What the mismatch sentence calls someone: their household name, else their address's first part. */
async function firstName(email: string): Promise<string> {
  const member = await memberByEmail(email).catch(() => null);
  const name = member?.displayName?.trim().split(/\s+/)[0];
  return name || email.split('@')[0];
}

/**
 * Who a redeemed code may become a device for: the owner, a member who holds
 * news, chat, games or the family circle right now — the areas the app opens
 * to members — or a registrant waiting on the owner ($lib/server/registration).
 *
 * A member's code is only ever minted by the household push, for a member who
 * held one of those when it was minted; this asks again at redemption because
 * ten minutes is long enough for the owner to take it away. A lookup that fails
 * is a refusal. (The device row is written before this runs, as it always was
 * for the owner check: an email that fails here fails `withNativeAccess` on
 * every later request too, so the token opens nothing, and it is never handed
 * over anyway.)
 */
async function mayHoldDevice(email: string): Promise<boolean> {
  if (isOwnerEmail(email)) return true;
  try {
    const member = await loadMember(email);
    if (
      member &&
      (satisfies(member.grants, 'news:self') ||
        satisfies(member.grants, 'jkai.chat:self') ||
        satisfies(member.grants, 'games:self') ||
        // The family circle pairs from the one code too: the site credential
        // is how the phone then fetches its health & location pairing.
        satisfies(member.grants, 'family:circle'))
    ) {
      return true;
    }
    // Someone who signed in from the app and is waiting for the owner (or
    // was refused): the device reaches /api/native/me and nothing else,
    // because every other route asks `loadMember`, which knows no registrant.
    return !member && (await isRegistrant(email));
  } catch (err) {
    console.error('[native] pair: member lookup failed:', err);
    return false;
  }
}
