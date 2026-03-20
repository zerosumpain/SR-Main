import { redirect, error } from '@sveltejs/kit';
import { exchangeWhoopCode } from '$lib/health/whoop';
import { storeTokens } from '$lib/health/tokens';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('whoop_oauth_state');

  if (!code || !state || state !== storedState) {
    throw error(400, 'Invalid OAuth callback');
  }

  cookies.delete('whoop_oauth_state', { path: '/' });

  const tokens = await exchangeWhoopCode(code);
  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  await storeTokens('whoop', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || undefined,
    expiresAt,
  });

  throw redirect(302, '/admin?connected=whoop');
};
