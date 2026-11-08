import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { checkAuthorizeRequest, issueCode, withParams } from '$lib/server/oidc/provider';
import { notFound, oidcConfig, plainPage } from '$lib/server/oidc/http';

/**
 * The browser leg of sign-in with the site's login (Immich and the like).
 *
 * NOT a hook bypass: the page gate in hooks.server.ts sends a visitor with no
 * session to /login?callbackUrl=<this exact URL> and a signed-in non-owner to
 * `/`, so only an owner normally reaches this handler. It re-checks both
 * anyway. An owner with a valid request is redirected straight back with a
 * 60-second code; there is no consent screen, because the only person who can
 * get here is the person both apps belong to.
 *
 * An unknown client or an unregistered redirect_uri is refused HERE, never
 * redirected (RFC 6749 4.1.2.1): bouncing an error to an unvetted address is
 * an open redirect.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const config = oidcConfig();
  if (!config) return notFound();

  const check = checkAuthorizeRequest(config, url.searchParams);
  if (check.kind === 'fatal') return plainPage(400, 'Sign-in request refused', check.message);

  const session = await locals.auth();
  const email = session?.user?.email ?? '';
  if (!email) throw redirect(302, `/login?callbackUrl=${encodeURIComponent(url.pathname + url.search)}`);
  if (!isOwnerEmail(email)) {
    return plainPage(403, 'Not available', 'Signing in to other apps with this site is only for its owner.');
  }

  if (check.kind === 'redirect-error') {
    throw redirect(302, withParams(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: url.origin }));
  }

  const code = issueCode(config, {
    clientId: check.client.id,
    redirectUri: check.redirectUri,
    email: email.toLowerCase(),
    name: session?.user?.name?.trim() || email,
    nonce: check.nonce,
    codeChallenge: check.codeChallenge,
  });
  console.log(`[oidc] code issued to ${check.client.id} for the owner`);
  throw redirect(302, withParams(check.redirectUri, { code, state: check.state, iss: url.origin }));
};
