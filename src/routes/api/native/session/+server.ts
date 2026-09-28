import { json } from '@sveltejs/kit';
import { identifyDevice, revokeDevice } from '$lib/server/native-auth';
import type { RequestHandler } from './$types';

// Possession suffices to revoke this credential, including after membership
// removal. An already expired/revoked token is an idempotent success.
export const DELETE: RequestHandler = async ({ request }) => {
  const identity = await identifyDevice(request);
  if (identity) await revokeDevice(identity.ownerEmail, identity.id);
  return json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
};
