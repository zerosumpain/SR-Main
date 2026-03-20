import { redirect, error } from '@sveltejs/kit';
import { exchangeStravaCode } from '$lib/health/strava';
import { storeTokens } from '$lib/health/tokens';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('strava_oauth_state');

  if (!code || !state || state !== storedState) {
    throw error(400, 'Invalid OAuth callback');
  }

  cookies.delete('strava_oauth_state', { path: '/' });

  const tokens = await exchangeStravaCode(code);
  await storeTokens('strava', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    scope: 'read,activity:read_all',
  });

  throw redirect(302, '/admin?connected=strava');
};
