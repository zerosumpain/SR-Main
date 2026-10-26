import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { APP_WEB_AUDIENCES, APP_WEB_SESSION_COOKIE, signAppWebSession } from '$lib/server/app-web-session';

/**
 * POST /api/native/wildmind/web-session — a cookie that signs the app's web
 * view in to Wildmind's own pages (strangeramblings.com/wildmind) as this
 * phone's owner. Owner only; refused while "View as" is on (withDevice).
 *
 * 200 `{ url, cookie: { name, value, domain, path, expiresAt } }`: the phone
 * sets the cookie (Secure, HttpOnly) in the web view's store and loads `url`.
 * Wildmind sends it to the session authority like any cookie, and Main
 * answers for it only to the sr-wildmind audience, while the phone stays
 * paired ($lib/server/app-web-session). 503 when the site cannot sign.
 */
export const POST: RequestHandler = withDevice(async ({ url }, identity) => {
  if (!env.AUTH_SECRET) return json({ error: 'unavailable' }, { status: 503 });
  const audience = 'sr-wildmind';
  const { path } = APP_WEB_AUDIENCES[audience];
  const signed = signAppWebSession(env.AUTH_SECRET, { audience, email: identity.ownerEmail, deviceId: identity.id });
  return {
    url: `${url.origin}${path}/`,
    cookie: { name: APP_WEB_SESSION_COOKIE, value: signed.value, domain: url.hostname, path, expiresAt: new Date(signed.expiresAt).toISOString() },
  };
});
