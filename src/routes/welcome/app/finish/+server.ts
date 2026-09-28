import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { createPairingCode } from '$lib/server/native-auth';
import { REGISTER_COOKIE, ensureAppRequest } from '$lib/server/registration';

// Where Google hands back during a registration from the iPhone app. PUBLIC
// (in $lib/auth PUBLIC_PATHS); it needs the session Google just made and the
// cookie /welcome/app set, and answers nothing without both.
//
// The person's request is recorded (once — see ensureAppRequest), a one-time
// pairing code is minted for their email, and the browser is sent to
// `srapp://registered?code=…`, which the app's sign-in sheet catches. The web
// session is then thrown away: it existed only to learn who they are, and the
// sheet is private and closes anyway.

const BACK = 'srapp://registered';

/** Auth.js's session cookie, under either name it uses (secure in production). */
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

export const GET: RequestHandler = async ({ locals, cookies }) => {
  const back = (params: Record<string, string>) => `${BACK}?${new URLSearchParams(params)}`;
  const registering = cookies.get(REGISTER_COOKIE) === '1';
  const session = await locals.auth().catch(() => null);
  const email = (session?.user?.email ?? '').trim().toLowerCase();

  cookies.delete(REGISTER_COOKIE, { path: '/' });
  for (const name of SESSION_COOKIES) cookies.delete(name, { path: '/' });

  if (!registering || !email) redirect(303, back({ error: 'The sign-in did not finish. Try again.' }));

  // The owner, or anyone already allowed, just gets their phone connected:
  // signing in from the app is also the easy way back in for a known person.
  // Someone refused still gets a code: their phone then says "not approved"
  // rather than showing a sign-in that silently went nowhere.
  if (!isOwnerEmail(email)) await ensureAppRequest({ email, name: session?.user?.name ?? null, via: 'google' });
  const { code } = await createPairingCode(email);
  redirect(303, back({ code }));
};
