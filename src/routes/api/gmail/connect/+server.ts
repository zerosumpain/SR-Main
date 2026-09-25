import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { viewerOf } from '$lib/server/viewer';
import { signConnectState } from '$lib/workflows/gmail/oauth-state';

/** The owner's mailbox is read, labelled and sent from by workflows and chat. */
const OWNER_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'openid',
  'email',
];

/**
 * A member's mailbox is only ever read into their own intel space. A family
 * member is never asked to let the site send or change mail as them.
 */
const MEMBER_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'];

export const GET: RequestHandler = async (event) => {
  const { url, locals } = event;
  const session = await locals.auth();
  if (!session?.user?.email) throw redirect(302, '/login');
  const viewer = await viewerOf(event);
  const member = viewer.kind === 'member';

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: member ? MEMBER_SCOPES : OWNER_SCOPES,
    // Merging previously granted scopes is how the owner's token keeps what it
    // had. A member's token must carry exactly the read-only grant.
    include_granted_scopes: !member,
    state: signConnectState(env.AUTH_SECRET ?? '', session.user.email),
    // The member connects the mailbox they signed in with (the callback checks).
    ...(member ? { login_hint: session.user.email } : {}),
  });
  throw redirect(302, authUrl);
};
