import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';
import { PAIR_CONFIRM_COOKIE, REGISTER_COOKIE, REGISTER_COOKIE_MAX_AGE_S, mintRegisterNonce } from '$lib/server/registration';
import { isPairCodeHash } from '$lib/server/pair-identity';

// The first page of registering from the iPhone app, opened in the app's
// private sign-in sheet. PUBLIC (in $lib/auth PUBLIC_PATHS).
//
// It sets a short-lived random nonce and sends the visitor to Google, asking
// Google to show its account chooser (never a silent sign-in). The Auth.js
// callbacks let an unknown, verified Google account through only while the
// nonce is set, and stamp it into that sign-in's session; /welcome/app/finish
// accepts only a session carrying the same nonce.
//
// `?confirm=<sha256 of a scanned code>` is the same sign-in asked a different
// question: not "register me" but "who is holding this phone", for a pairing
// code the app has just scanned. Finish answers with a pairing identity for
// that one code and registers nobody.
export const load: PageServerLoad = async ({ cookies, setHeaders, url }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: !dev, maxAge: REGISTER_COOKIE_MAX_AGE_S };
  cookies.set(REGISTER_COOKIE, mintRegisterNonce(), opts);
  const confirm = url.searchParams.get('confirm');
  if (isPairCodeHash(confirm)) cookies.set(PAIR_CONFIRM_COOKIE, confirm, opts);
  else cookies.delete(PAIR_CONFIRM_COOKIE, { path: '/' });
  return { confirm: isPairCodeHash(confirm) };
};
