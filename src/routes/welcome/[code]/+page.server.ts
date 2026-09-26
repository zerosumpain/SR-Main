import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { listGroups } from '$lib/server/grants';
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE_S, maskEmail, previewInvite } from '$lib/server/invites';

// An invite link. PUBLIC (under /welcome in $lib/auth PUBLIC_PATHS).
//
// A live code goes into a short-lived httpOnly cookie here, before the visitor
// is sent to Google; the Auth.js signIn callback reads it back on the OAuth
// callback and accepts the invite once ($lib/server/invites). Nothing is spent
// by looking: only a sign-in spends a code.
//
// A dead code — unknown, used, revoked or expired — gets one sentence that
// does not say which, so a link cannot be probed for its history.

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
  const session = await locals.auth().catch(() => null);
  // Already signed in: the setup steps are on /welcome.
  if (session?.user?.email) throw redirect(303, '/welcome');

  const { state, invite } = await previewInvite(params.code);
  if (state !== 'ok' || !invite) return { valid: false as const };

  cookies.set(INVITE_COOKIE, params.code, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: INVITE_COOKIE_MAX_AGE_S,
  });

  const groups = await listGroups().catch(() => []);
  const gets = invite.groups
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((g) => ({ label: g.label, description: g.description }));

  return {
    valid: true as const,
    name: invite.name,
    forEmail: invite.email ? maskEmail(invite.email) : null,
    // The site is one person's; an owner invite is from John by name.
    inviter: invite.createdBy && isOwnerEmail(invite.createdBy) ? 'John' : 'Someone at strange ramblings',
    gets,
    expiresAt: invite.expiresAt.toISOString(),
  };
};
