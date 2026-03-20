import { redirect } from '@sveltejs/kit';
import { getStravaAuthUrl } from '$lib/health/strava';
import crypto from 'crypto';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  const state = crypto.randomBytes(16).toString('hex');
  cookies.set('strava_oauth_state', state, {
    path: '/',
    httpOnly: true,
    maxAge: 600,
    sameSite: 'lax',
  });
  throw redirect(302, getStravaAuthUrl(state));
};
