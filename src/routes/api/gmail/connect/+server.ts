import { redirect, type RequestHandler } from '@sveltejs/kit';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'openid',
  'email',
];

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user) throw redirect(302, '/login');

  const redirectUri = `${url.origin}/api/gmail/callback`;
  const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
  });
  throw redirect(302, authUrl);
};
