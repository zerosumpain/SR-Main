import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redeemPairingCode } from '$lib/server/native-auth';
import { isOwnerEmail } from '$lib/server/native-handler';
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
 *  * the owner allow-list is re-checked, so a code minted by an address that
 *    has since left the list buys nothing;
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
  if (!isOwnerEmail(redeemed.ownerEmail)) {
    return json({ error: 'That pairing code is not valid.' }, { status: 401 });
  }

  return json({
    token: redeemed.token,
    expiresAt: redeemed.expiresAt.toISOString(),
  });
};
