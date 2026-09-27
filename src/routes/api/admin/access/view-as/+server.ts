import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';
import { VIEW_AS_COOKIE, VIEW_AS_TTL_S, signViewAs, viewerForEmail } from '$lib/server/view-as';

// Start and stop viewing the site as someone on the allow-list
// ($lib/server/view-as). Owner-only: the hook gates /api/admin/*, and it never
// applies the emulation to this path, so the owner's real session reaches here
// even while emulating — which is what lets the banner's Exit work.

/** POST { email } — view the site as this person for the next hour. */
export const POST: RequestHandler = async ({ request, locals, cookies, url }) => {
  const owner = (await locals.auth())?.user?.email ?? '';
  // The dev LAN bypass reaches here without a session; there is no owner
  // identity to bind the cookie to, so refuse rather than sign for nobody.
  if (!isOwnerEmail(owner)) return json({ error: 'Sign in as the owner to use view-as' }, { status: 403 });

  let email = '';
  try {
    const b = await request.json();
    email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const viewer = await viewerForEmail(email);
  if (!viewer) return json({ error: 'Not on the allow-list' }, { status: 404 });

  cookies.set(VIEW_AS_COOKIE, signViewAs(env.AUTH_SECRET ?? '', owner, email), {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: VIEW_AS_TTL_S,
  });
  return json({ ok: true, email, kind: viewer.kind });
};

/** DELETE — stop viewing as anyone. */
export const DELETE: RequestHandler = async ({ cookies }) => {
  cookies.delete(VIEW_AS_COOKIE, { path: '/' });
  return json({ ok: true });
};
