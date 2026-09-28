import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sessionCaller, browserSessionEmail } from '$lib/server/session-introspection';
import { isOwnerEmail, isEmailAllowedToSignIn } from '$lib/server/access';
import { verifyViewAs } from '$lib/server/view-as';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const headers = { 'cache-control': 'private, no-store' };
  const audience = request.headers.get('x-sr-session-audience');
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  if (!sessionCaller(audience, bearer, env.SESSION_INTROSPECTION_KEYS)) return json({ error: 'Unauthorised' }, { status: 401, headers });
  if (!env.AUTH_SECRET) return json({ error: 'Session authority unavailable' }, { status: 503, headers });
  const cookie = request.headers.get('cookie') ?? '';
  if (cookie.length > 32768) return json({ error: 'Cookie too large' }, { status: 400, headers });
  const email = await browserSessionEmail(cookie, env.AUTH_SECRET);
  if (!email || !(await isEmailAllowedToSignIn(email))) return json({ email: null, viewingAs: null }, { headers });
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('sr_view_as='))?.slice(11);
  const candidate = isOwnerEmail(email) ? verifyViewAs(env.AUTH_SECRET, email, value) : null;
  const viewingAs = candidate && await isEmailAllowedToSignIn(candidate.email) ? candidate.email : null;
  return json({ email, viewingAs }, { headers });
};
