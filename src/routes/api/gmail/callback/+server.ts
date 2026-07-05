import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { encryptToken } from '$lib/workflows/gmail/crypto';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user) throw redirect(302, '/login');

  const code = url.searchParams.get('code');
  if (!code) throw redirect(302, '/admin/connections/gmail?error=no_code');

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw redirect(302, '/admin/connections/gmail?error=no_refresh_token');
  }
  oauth.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.emailAddress!;

  const existing = await db.select().from(gmailAccounts).where(eq(gmailAccounts.email, email));
  if (existing[0]) {
    await db.update(gmailAccounts).set({
      refreshTokenEnc: encryptToken(tokens.refresh_token),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(gmailAccounts.id, existing[0].id));
  } else {
    await db.insert(gmailAccounts).values({
      email,
      refreshTokenEnc: encryptToken(tokens.refresh_token),
      accessTokenEnc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? '',
      status: 'active',
    });
  }
  throw redirect(302, '/admin/connections/gmail?connected=' + encodeURIComponent(email));
};
