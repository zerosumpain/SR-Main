import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sessionCaller, browserSessionEmail } from '$lib/server/session-introspection';
import { isOwnerEmail, isEmailAllowedToSignIn } from '$lib/server/access';
import { verifyViewAs } from '$lib/server/view-as';
import { DRIVE_AUDIENCE, driveClaimsFor } from '$lib/server/session-claims';
import { projectAccessFor, projectKeyForAudience } from '$lib/projects/access-claim';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const headers = { 'cache-control': 'private, no-store' };
  const audience = request.headers.get('x-sr-session-audience');
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  if (!sessionCaller(audience, bearer, env.SESSION_INTROSPECTION_KEYS)) return json({ error: 'Unauthorised' }, { status: 401, headers });
  if (!env.AUTH_SECRET) return json({ error: 'Session authority unavailable' }, { status: 503, headers });
  const cookie = request.headers.get('cookie') ?? '';
  if (cookie.length > 32768) return json({ error: 'Cookie too large' }, { status: 400, headers });
  const sessionEmail = await browserSessionEmail(cookie, env.AUTH_SECRET);
  const email = sessionEmail && (await isEmailAllowedToSignIn(sessionEmail)) ? sessionEmail : null;
  let viewingAs: string | null = null;
  if (email) {
    const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('sr_view_as='))?.slice(11);
    const candidate = isOwnerEmail(email) ? verifyViewAs(env.AUTH_SECRET, email, value) : null;
    viewingAs = candidate && await isEmailAllowedToSignIn(candidate.email) ? candidate.email : null;
  }

  // Claims about the EFFECTIVE person, which the gateway signs alongside the
  // email it signs ($lib/server/session-claims). Each goes only to the
  // audience that serves it, decided from the authenticated audience.
  const effective = viewingAs ?? email;
  const claims: Record<string, unknown> = {};
  const projectKey = projectKeyForAudience(audience as string);
  if (projectKey) {
    const fromUrl = request.headers.get('x-sr-session-share');
    try {
      claims.project = await projectAccessFor(projectKey, effective, { fromUrl: fromUrl && fromUrl.length <= 512 ? fromUrl : null, cookie });
    } catch (err) {
      // Not "none": a database outage must not read as "this project is private".
      console.warn(`[session] project access for ${projectKey} failed: ${(err as Error).message}`);
      return json({ error: 'Session authority unavailable' }, { status: 503, headers });
    }
  }
  if (audience === DRIVE_AUDIENCE && effective) {
    try {
      Object.assign(claims, await driveClaimsFor(effective));
    } catch (err) {
      // Fail closed for members only: no claim is no member. The owner's drive
      // is decided by Drive's own allow-list and is unaffected.
      console.warn(`[session] drive claims failed: ${(err as Error).message}`);
    }
  }
  return json({ email, viewingAs, claims }, { headers });
};
