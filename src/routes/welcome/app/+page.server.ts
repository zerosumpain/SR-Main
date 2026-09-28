import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';
import { REGISTER_COOKIE, REGISTER_COOKIE_MAX_AGE_S, mintRegisterNonce } from '$lib/server/registration';

// The first page of registering from the iPhone app, opened in the app's
// private sign-in sheet. PUBLIC (in $lib/auth PUBLIC_PATHS).
//
// It sets a short-lived random nonce and sends the visitor to Google, asking
// Google to show its account chooser (never a silent sign-in). The Auth.js
// callbacks let an unknown, verified Google account through only while the
// nonce is set, and stamp it into that sign-in's session; /welcome/app/finish
// accepts only a session carrying the same nonce.
export const load: PageServerLoad = async ({ cookies, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  cookies.set(REGISTER_COOKIE, mintRegisterNonce(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: REGISTER_COOKIE_MAX_AGE_S,
  });
  return {};
};
