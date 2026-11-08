import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import {
  OAuthRefreshError,
  reauthoriseTrueLayer,
  truelayerAuthorizationUrl,
} from '$lib/secrets/oauth-refresh';

// Reconnect TrueLayer after the bank consent lapses (invalid_grant).
//
//   GET  → { authorizationUrl }  the consent link for the stored client_id
//   POST { code } → { ok, expiresAt }  trades the one-time code for a new
//        refresh token and writes it into the truelayer-oauth vault row
//
// Both re-check the owner session, like /api/admin/apis/secrets: the homeserv
// LAN auth bypass must not let a loopback caller swap the bank credential.
// Neither returns a token — only the link and an expiry time.

async function requireOwner(locals: App.Locals): Promise<Response | null> {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email || !isOwnerEmail(email)) {
    return json({ error: 'Reconnecting TrueLayer requires a signed-in owner session.' }, { status: 403 });
  }
  return null;
}

function errResponse(err: unknown) {
  if (err instanceof OAuthRefreshError) return json({ error: err.message }, { status: 400 });
  return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;
  try {
    return json({ authorizationUrl: await truelayerAuthorizationUrl() });
  } catch (err) {
    return errResponse(err);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  try {
    const { expiresAt } = await reauthoriseTrueLayer(String(body.code ?? ''));
    return json({ ok: true, expiresAt });
  } catch (err) {
    return errResponse(err);
  }
};
