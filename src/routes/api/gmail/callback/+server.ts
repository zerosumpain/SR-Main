import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { encryptToken } from '$lib/workflows/gmail/crypto';
import { verifyConnectState } from '$lib/workflows/gmail/oauth-state';
import { viewerOf } from '$lib/server/viewer';
import { OWNER_SPACE } from '$lib/jkai/intel/scope';
import { eq } from 'drizzle-orm';

/**
 * Where the mailbox lands is decided HERE, from the session — never from the
 * request. The owner's connect makes an owner mailbox; a member's makes one in
 * their own space, and only for the address they signed in with.
 *
 * An existing row is never moved between principals: re-connecting refreshes a
 * token, it does not change whose mail it is.
 */
export const GET: RequestHandler = async (event) => {
  const { url, locals } = event;
  const session = await locals.auth();
  const signedIn = session?.user?.email?.trim().toLowerCase();
  if (!signedIn) throw redirect(302, '/login');
  const viewer = await viewerOf(event);
  const member = viewer.kind === 'member';
  const principalId = viewer.kind === 'member' ? viewer.principalId : OWNER_SPACE;

  const back = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return member ? `/jkai/intel?${qs}` : `/admin/connections/gmail?${qs}`;
  };
  const fail = (code: string): never => {
    throw redirect(302, back(member ? { gmail_error: code } : { error: code }));
  };

  if (!verifyConnectState(env.AUTH_SECRET ?? '', url.searchParams.get('state'), signedIn)) fail('bad_state');

  const code = url.searchParams.get('code');
  if (!code) fail('no_code');

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await oauth.getToken(code as string);
  if (!tokens.refresh_token) fail('no_refresh_token');
  oauth.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.emailAddress!;

  // A member connects their own mailbox, full stop — not a parent's, not a
  // shared inbox. The owner may connect any address (and always could).
  if (member && email.trim().toLowerCase() !== signedIn) fail('wrong_account');

  const [existing] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.email, email));
  if (existing && existing.principalId !== principalId) fail('taken');

  if (existing) {
    await db.update(gmailAccounts).set({
      refreshTokenEnc: encryptToken(tokens.refresh_token!),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(gmailAccounts.id, existing.id));
  } else {
    await db.insert(gmailAccounts).values({
      email,
      refreshTokenEnc: encryptToken(tokens.refresh_token!),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
      principalId,
    });
  }
  throw redirect(302, member ? back({ gmail: 'connected', email }) : back({ connected: email }));
};
