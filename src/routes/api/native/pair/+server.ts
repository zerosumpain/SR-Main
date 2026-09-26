import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redeemPairingCode } from '$lib/server/native-auth';
import { isOwnerEmail } from '$lib/server/native-handler';
import { loadMember } from '$lib/server/grants';
import { satisfies } from '$lib/access/catalogue';
import { rateLimit } from '$lib/server/rate-limit';

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

  let body: { code?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'That pairing code is not valid.' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const label = typeof body.label === 'string' ? body.label : null;
  if (!code) return json({ error: 'That pairing code is not valid.' }, { status: 400 });

  const redeemed = await redeemPairingCode(code, label);
  if (!redeemed) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }
  if (!(await mayHoldDevice(redeemed.ownerEmail))) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }

  return json({
    token: redeemed.token,
    expiresAt: redeemed.expiresAt.toISOString(),
  });
};

/**
 * Who a redeemed code may become a device for: the owner, or a member who holds
 * news or chat right now — the two areas the app opens to members.
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
    return !!member && (satisfies(member.grants, 'news:self') || satisfies(member.grants, 'jkai.chat:self'));
  } catch (err) {
    console.error('[native] pair: member lookup failed:', err);
    return false;
  }
}
