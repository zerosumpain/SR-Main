import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';
import { REGISTER_COOKIE, REGISTER_COOKIE_MAX_AGE_S } from '$lib/server/registration';

// The first page of registering from the iPhone app, opened in the app's
// private sign-in sheet. PUBLIC (in $lib/auth PUBLIC_PATHS).
//
// It sets one short-lived cookie and sends the visitor to Google. The Auth.js
// signIn callback lets an unknown Google account through only while that
// cookie is present, and /welcome/app/finish is where they land.
export const load: PageServerLoad = async ({ cookies, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  cookies.set(REGISTER_COOKIE, '1', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge: REGISTER_COOKIE_MAX_AGE_S,
  });
  return {};
};
